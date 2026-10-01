import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  Injectable,
  Logger,
  SetMetadata,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { PrismaService } from "./prisma.service";

/**
 * ‎**סבבים מחזוריים — מנגנון אחד.**
 *
 * ‏עשרים ואחד שירותים ב-API רצים כל כמה דקות או שעות: תזכורות, חידושים,
 * ‏סנכרונים, מיילים. כל אחד החזיק עותק משלו של אותו קוד — שני טיימרים,
 * ‏דגל „רץ עכשיו”, ניקוי בכיבוי — ואף אחד לא ידע על מופע API שני: כשיהיו
 * ‏שניים, כל מייל ייצא פעמיים וכל חיוב ינוסה פעמיים.
 *
 * ‏עכשיו שירות מסמן את הסבב שלו ב-`@Sweep`, והמתזמן כאן מוצא אותו בעלייה
 * ‏ומריץ אותו:
 * ‏- **בלי חפיפה בתהליך** — סבב שעוד רץ אינו מתחיל שוב.
 * ‏- **בלי כפילות בין מופעים** — חכירה בטבלת `sweep_leases`: מי שתפס את
 * ‏  הסבב מחזיק אותו לתקופה אחת, ומופע אחר שמתעורר באמצע מדלג. השעון
 * ‏  הוא של Postgres, כך ששעונים שונים במכונות לא משנים דבר.
 *
 * ‏הסבב עצמו (`tick`) נשאר מתודה רגילה של השירות, ובדיקות קוראות לה
 * ‏ישירות — המתזמן הוא רק „מתי ומי”.
 */

export interface SweepOptions {
  /** ‏שם יציב — מפתח החכירה. שינוי שלו פותח חכירה חדשה, וזה הכול. */
  name: string;
  everyMs: number;
  /** ‏השהיה עד הסבב הראשון אחרי עלייה. בלי — הראשון אחרי `everyMs`. */
  firstDelayMs?: number;
  /**
   * ‏סבב של המופע עצמו ולא של המערכת — כל מופע מריץ את שלו, בלי חכירה
   * ‏(למשל כתיבת מה שנצבר בזיכרון של התהליך).
   */
  perInstance?: boolean;
}

const SWEEP_METADATA = "metavchim:sweep";

/** ‏מסמן מתודה כסבב מחזורי — ראו למעלה. */
export const Sweep = (options: SweepOptions): MethodDecorator =>
  SetMetadata(SWEEP_METADATA, options);

/**
 * ‏כמה זמן החכירה מחזיקה: כמעט תקופה שלמה. המרווח מכסה סטייה של
 * ‏הטיימר, כך שהמחזיק עצמו לעולם אינו מדלג על הסבב הבא שלו.
 */
export function sweepLeaseMs(everyMs: number): number {
  return Math.max(everyMs - Math.min(everyMs / 10, 60_000), 1_000);
}

interface DiscoveredSweep {
  options: SweepOptions;
  run: () => Promise<unknown>;
}

@Injectable()
export class SweepScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Sweeps");
  /** ‏מי מחזיק את החכירה — מספיק כדי להבדיל בין מופעים וריצות. */
  private readonly holder = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  /** ‏ניסיון חוזר אחד לכל סבב שדילג — ראו `retryAtExpiry`. */
  private readonly retries = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    const sweeps = this.discover();
    for (const sweep of sweeps) this.schedule(sweep);
    this.logger.log(`${sweeps.length} סבבים מתוזמנים`);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    for (const timer of this.retries.values()) clearTimeout(timer);
  }

  /** ‏כל המתודות שסומנו ב-`@Sweep`, בכל הספקים. ציבורי לבדיקות. */
  discover(): DiscoveredSweep[] {
    const found: DiscoveredSweep[] = [];
    const names = new Set<string>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (instance === null || typeof instance !== "object") continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown> | null;
      if (prototype === null) continue;
      for (const key of this.scanner.getAllMethodNames(prototype)) {
        const method = prototype[key];
        if (typeof method !== "function") continue;
        const options = this.reflector.get<SweepOptions | undefined>(SWEEP_METADATA, method);
        if (options === undefined) continue;
        /* ‏שני סבבים באותו שם היו חולקים חכירה — אחד מהם לא היה רץ לעולם */
        if (names.has(options.name)) throw new Error(`שני סבבים בשם ${options.name}`);
        names.add(options.name);
        found.push({
          options,
          run: () => (method as () => Promise<unknown>).call(instance),
        });
      }
    }
    return found;
  }

  private schedule({ options, run }: DiscoveredSweep): void {
    const every = (): void => {
      const timer = setInterval(() => void this.runOnce(options, run), options.everyMs);
      timer.unref();
      this.timers.push(timer);
    };
    if (options.firstDelayMs === undefined) {
      every();
      return;
    }
    const first = setTimeout(() => {
      void this.runOnce(options, run);
      every();
    }, options.firstDelayMs);
    first.unref();
    this.timers.push(first);
  }

  /**
   * ‏סבב אחד: `true` אם רץ, `false` אם דילג (עוד רץ כאן, או שמופע אחר
   * ‏מחזיק אותו). לעולם אינו זורק — סבב שנכשל נרשם ביומן, והבא ינסה שוב.
   */
  async runOnce(options: SweepOptions, run: () => Promise<unknown>): Promise<boolean> {
    if (this.running.has(options.name)) return false;
    this.running.add(options.name);
    const leaseMs = sweepLeaseMs(options.everyMs);
    let heartbeat: NodeJS.Timeout | null = null;
    try {
      if (options.perInstance !== true) {
        const claim = await this.claim(options.name, leaseMs);
        if (!claim.claimed) {
          this.retryAtExpiry(options, run, claim.expiresInMs);
          return false;
        }
        /*
         * ‏סבב שנמשך יותר מהחכירה מאריך אותה — אחרת מופע שני היה מתחיל
         * ‏את אותו סבב בזמן שהראשון עוד באמצעו.
         */
        heartbeat = setInterval(() => void this.extend(options.name, leaseMs), leaseMs / 2);
        heartbeat.unref();
      }
      await run();
      return true;
    } catch (error: unknown) {
      this.logger.error(`הסבב ${options.name} נכשל: ${String(error)}`);
      return true;
    } finally {
      if (heartbeat !== null) clearInterval(heartbeat);
      this.running.delete(options.name);
    }
  }

  /**
   * ‎**מי שדילג מנסה שוב כשהחכירה פגה, ולא בעוד תקופה שלמה** (ביקורת
   * ‏Codex, P2).
   *
   * ‏בלי זה, מחזיק שנעלם רגע אחרי שמופע אחר דילג היה משאיר את הסבב בלי
   * ‏איש עד הטיק הבא של המדלג — עד כמעט שתי תקופות, וזה בדיוק מה שפריסה
   * ‏מדורגת עושה. מחזיק חי תופס שוב לפני כן או מיד אחרי, ואז הניסיון רק
   * ‏מדלג פעם נוספת. ניסיון שהיה נוחת אחרי הטיק הרגיל מיותר ואינו נקבע.
   */
  private retryAtExpiry(
    options: SweepOptions,
    run: () => Promise<unknown>,
    expiresInMs: number | null,
  ): void {
    if (expiresInMs === null || this.retries.has(options.name)) return;
    const delay = Math.max(expiresInMs, 0) + 1_000;
    if (delay >= options.everyMs) return;
    const timer = setTimeout(() => {
      this.retries.delete(options.name);
      void this.runOnce(options, run);
    }, delay);
    timer.unref();
    this.retries.set(options.name, timer);
  }

  /**
   * ‏תפיסת הסבב לתקופה. מצליחה אם אין חכירה, אם פגה, או אם היא כבר
   * ‏שלנו (סבב קודם שלנו שהתארך).
   *
   * ‏**מסד שאינו עונה אינו עוצר את הסבב.** החכירה מגינה מפני כפילות,
   * ‏והיא אינה תנאי לעבודה: עד היום כל סבב רץ בלי לשאול איש, ותקלה כאן
   * ‏לא צריכה לעצור תזכורות. הסבב עצמו ייתקל באותה תקלה וידווח עליה.
   */
  private async claim(
    name: string,
    leaseMs: number,
  ): Promise<{ claimed: true } | { claimed: false; expiresInMs: number | null }> {
    try {
      const rows = await this.prisma.$queryRaw<{ holder: string }[]>`
        INSERT INTO sweep_leases (name, holder, until)
        VALUES (${name}, ${this.holder}, now() + make_interval(secs => ${leaseMs / 1000}::double precision))
        ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, until = EXCLUDED.until
        WHERE sweep_leases.until <= now() OR sweep_leases.holder = EXCLUDED.holder
        RETURNING holder`;
      if (rows.length > 0) return { claimed: true };
      /* ‏מתי היא פגה — בשעון של המסד, כמו התפיסה עצמה */
      const [lease] = await this.prisma.$queryRaw<{ ms: number }[]>`
        SELECT (EXTRACT(EPOCH FROM (until - now())) * 1000)::float8 AS ms
        FROM sweep_leases WHERE name = ${name}`;
      return { claimed: false, expiresInMs: lease === undefined ? null : Number(lease.ms) };
    } catch (error: unknown) {
      this.logger.warn(`חכירת הסבב ${name} לא נבדקה — רץ בלעדיה: ${String(error)}`);
      return { claimed: true };
    }
  }

  private async extend(name: string, leaseMs: number): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE sweep_leases
        SET until = now() + make_interval(secs => ${leaseMs / 1000}::double precision)
        WHERE name = ${name} AND holder = ${this.holder}`;
    } catch (error: unknown) {
      this.logger.warn(`הארכת החכירה של ${name} נכשלה: ${String(error)}`);
    }
  }
}
