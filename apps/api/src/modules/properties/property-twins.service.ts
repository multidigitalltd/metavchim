import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  canonicalTwinPair,
  MAX_TWINS_PER_PROPERTY,
  propertyHeadline,
  twinLimitRejectionReason,
  twinNoteRejectionReason,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { mediaRawPath } from "./media.service";

/**
 * נכסים תואמים — הקישור שמופיע בכרטיס כשהמתווך על הקו.
 *
 * ## מה הלוגיקה כאן שומרת
 *
 * 1. **סימטריה.** הזוג נשמר פעם אחת בסדר קנוני, ושני הכרטיסים
 *    קוראים את אותה שורה. סוכן שהגדיר מכרטיס א׳ רואה את הקשר גם
 *    בכרטיס ב׳, בלי להגדיר שוב.
 * 2. **רק נכסים חיים.** נכס שהועבר לארכיון אינו מוצג כתאום — אין
 *    טעם להציע ללקוח נכס שירד מהשיווק — והקשר עצמו נשאר. לכן
 *    הקריאה מסננת לפי `deletedAt`, ולא נשענת על מחיקת השורה.
 * 3. **הצד השני קיים ושייך למשרד.** בלי זה נתיב הכתיבה היה מקבל
 *    מזהה זר, נכשל רק בפוליסת RLS, ומחזיר שגיאת שרת במקום תשובה.
 */

/** נכס תאום כפי שהוא מוצג — מספיק כדי להציע אותו בטלפון. */
export interface PropertyTwinDto {
  id: string;
  headline: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  priceAgorot?: number;
  status: string;
  marketingTitle?: string;
  thumbnailUrl?: string;
  /** למה הם תואמים, בלשונו של מי שהגדיר. */
  note?: string;
  linkedAt: Date;
}

/** שורת קשר גולמית, לפני שנפתרה לנכס שבצד השני. */
interface TwinLink {
  id: string;
  otherId: string;
  note: string | null;
  createdAt: Date;
}

@Injectable()
export class PropertyTwinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(propertyId: string): Promise<PropertyTwinDto[]> {
    return this.prisma.withTenant(async (tx) => {
      await this.requireLiveProperty(tx, propertyId);
      return this.resolve(tx, await this.linksOf(tx, propertyId));
    });
  }

  /**
   * סימון תאום — **אידמפוטנטי**.
   *
   * לחיצה שנייה על נכס שכבר מסומן אינה שגיאה אלא אישור: הבורר כבר
   * מסתיר את מי שמסומן, ולכן הדרך היחידה להגיע לכאן פעמיים היא
   * לחיצה כפולה או שני מסכים פתוחים. `409` שם היה בלבול, לא מידע.
   * הערה חדשה מחליפה את הקודמת — זה מה שמי שכתב אותה התכוון.
   */
  async add(
    propertyId: string,
    twinId: string,
    note?: string,
  ): Promise<PropertyTwinDto> {
    const pair = canonicalTwinPair(propertyId, twinId);
    if (pair === null) {
      throw new BadRequestException("נכס אינו יכול להיות תאום של עצמו");
    }
    const trimmed = note?.trim() ?? "";
    const noteReason = twinNoteRejectionReason(trimmed);
    if (noteReason !== null) throw new BadRequestException(noteReason);

    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      await this.requireLiveProperty(tx, propertyId);
      await this.requireLiveProperty(tx, twinId, "הנכס שנבחר לא נמצא");

      /*
       * שני הנכסים ננעלים לפני הספירה — אחרת התקרה אינה תקרה.
       *
       * תחת `READ COMMITTED` שתי בקשות שמוסיפות **נכסים תואמים שונים**
       * לאותו נכס רואות שתיהן את אותן 11 שורות, שתיהן עוברות את
       * הבדיקה, ושתיהן מכניסות זוג אחר — שאינו מתנגש באינדקס
       * הייחודי, כי הוא באמת זוג אחר. התוצאה היא 13 קישורים על נכס
       * שהמסך מרשה עליו 12. הנעילה מסדרת את הבקשות בתור, וכל אחת
       * סופרת אחרי שקודמתה נכתבה.
       *
       * `ORDER BY id` ולא בסדר הארגומנטים: „הוסף את ב׳ לא׳” ו„הוסף
       * את א׳ לב׳” שרצות במקביל היו נועלות בסדר הפוך זו מזו, וזה
       * קיפאון. סדר קבוע על אותה קבוצת שורות אינו יכול להיתקע.
       */
      await tx.$queryRaw`
        SELECT id FROM properties
         WHERE id IN (${pair.first}, ${pair.second})
           AND tenant_id = ${ctx.tenantId}
         ORDER BY id
           FOR UPDATE`;

      /*
       * התקרה נבדקת על הקשרים **הפעילים** בלבד, ולכן על התוצאה
       * שהמסך מציג. ספירת שורות גולמית הייתה חוסמת סוכן בגלל
       * קשרים לנכסים בארכיון — קשרים שאינו רואה ואינו יכול להסיר.
       */
      const live = await this.resolve(tx, await this.linksOf(tx, propertyId));
      const alreadyLinked = live.some((twin) => twin.id === twinId);
      if (!alreadyLinked) {
        const mine = twinLimitRejectionReason(live.length);
        if (mine !== null) throw new BadRequestException(mine);
        /*
         * **גם הצד השני.** הקשר סימטרי, ולכן הוא נספר בשני
         * הכרטיסים; בדיקה של צד אחד בלבד הייתה מאפשרת לעקוף את
         * התקרה פשוט על ידי הוספה מהכרטיס הריק — ומשאירה את הנכס
         * השני עם יותר קישורים ממה שהמסך שלו מרשה להוסיף.
         */
        const theirs = await this.resolve(tx, await this.linksOf(tx, twinId));
        if (twinLimitRejectionReason(theirs.length) !== null) {
          throw new BadRequestException(
            `לנכס שנבחר כבר יש ${MAX_TWINS_PER_PROPERTY} נכסים תואמים — המקסימום. בחרו נכס אחר.`,
          );
        }
      }

      /*
       * `ON CONFLICT DO UPDATE` — משפט **אחד**, ולכן אידמפוטנטי גם
       * במרוץ אמיתי.
       *
       * שתי החלופות המתבקשות שבורות כאן, ושתיהן נבדקו מול Postgres
       * ולא הונחו:
       *
       * - **`upsert` של Prisma** אינו אטומי: הוא קורא ואז כותב, ושני
       *   מסלולים מקבילים שקראו „אין שורה” מנסים שניהם ליצור.
       * - **`create` בתוך `try/catch` על P2002** גרוע יותר: החריגה
       *   נתפסת בקוד, אבל ב-Postgres המשפט שנכשל **מבטל את
       *   הטרנזקציה כולה**, וכל פקודה שאחריו נופלת על `25P02`
       *   („current transaction is aborted”). כלומר התיקון עצמו היה
       *   מייצר 500 בדיוק במקרה שהוא נכתב בשבילו.
       *
       * המזהה של השורה הקיימת נשמר — רק ההערה מתעדכנת.
       */
      await tx.$executeRaw`
        INSERT INTO property_twins
               (id, tenant_id, property_a_id, property_b_id, note, created_by, created_at)
        VALUES (${ulid()}, ${ctx.tenantId}, ${pair.first}, ${pair.second},
                ${trimmed === "" ? null : trimmed}, ${ctx.userId}, now())
        ON CONFLICT (tenant_id, property_a_id, property_b_id)
        DO UPDATE SET note = EXCLUDED.note`;

      await this.audit.record(tx, {
        action: "property.twin.add",
        entityType: "property",
        entityId: propertyId,
        metadata: { twinId },
      });

      const added = (await this.resolve(tx, await this.linksOf(tx, propertyId))).find(
        (twin) => twin.id === twinId,
      );
      /*
       * שני הצדדים נבדקו כחיים בתוך אותה טרנזקציה, ולכן היעדר
       * התוצאה כאן הוא סתירה ולא מצב אפשרי. זריקה מפורשת ולא `!`:
       * אם המצב הזה בכל זאת יגיע, עדיף שייראה כשגיאה מזוהה.
       */
      if (added === undefined) {
        throw new NotFoundException("הקישור נשמר אך לא נמצא — נסו לרענן");
      }
      return added;
    });
  }

  /**
   * הסרה — **מהצד שממנו לחצו, ומהצד השני יחד**. זו שורה אחת, ולכן
   * זה אותו קשר. סוכן שמסיר תאום מכרטיס א׳ אינו מצפה שהוא יישאר
   * מוצג בכרטיס ב׳.
   */
  async remove(propertyId: string, twinId: string): Promise<void> {
    const pair = canonicalTwinPair(propertyId, twinId);
    if (pair === null) {
      throw new BadRequestException("נכס אינו יכול להיות תאום של עצמו");
    }
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      await this.requireLiveProperty(tx, propertyId);
      const removed = await tx.propertyTwin.deleteMany({
        where: {
          tenantId: ctx.tenantId,
          propertyAId: pair.first,
          propertyBId: pair.second,
        },
      });
      if (removed.count === 0) throw new NotFoundException("הקישור לא נמצא");
      await this.audit.record(tx, {
        action: "property.twin.remove",
        entityType: "property",
        entityId: propertyId,
        metadata: { twinId },
      });
    });
  }

  /**
   * ניקוי בעת מחיקה לצמיתות.
   *
   * נקרא מתוך `purge` **בתוך אותה טרנזקציה**: קשר שמצביע על נכס
   * שאיננו הוא שורה שאיש לא יראה ואיש לא יסיר, והיא גם מונה
   * לתקרה בכרטיס שבצד השני.
   */
  async purgeFor(tx: TenantTx, propertyId: string): Promise<number> {
    const removed = await tx.propertyTwin.deleteMany({
      where: {
        tenantId: TenantContext.current().tenantId,
        OR: [{ propertyAId: propertyId }, { propertyBId: propertyId }],
      },
    });
    return removed.count;
  }

  /* ------------------------------------------------------------------ */

  /** הנכס קיים, שייך למשרד ואינו בארכיון. `404` אחיד לשלושתם. */
  private async requireLiveProperty(
    tx: TenantTx,
    id: string,
    message = "נכס לא נמצא",
  ): Promise<void> {
    const row = await tx.property.findFirst({
      where: {
        id,
        tenantId: TenantContext.current().tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (row === null) throw new NotFoundException(message);
  }

  /** שורות הקשר של הנכס משני הצדדים, כשהצד השני כבר מחולץ. */
  private async linksOf(tx: TenantTx, propertyId: string): Promise<TwinLink[]> {
    const rows = await tx.propertyTwin.findMany({
      where: {
        tenantId: TenantContext.current().tenantId,
        OR: [{ propertyAId: propertyId }, { propertyBId: propertyId }],
      },
      select: {
        id: true,
        propertyAId: true,
        propertyBId: true,
        note: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      otherId: row.propertyAId === propertyId ? row.propertyBId : row.propertyAId,
      note: row.note,
      createdAt: row.createdAt,
    }));
  }

  /**
   * מהקשרים לנכסים המוצגים.
   *
   * שלוש שאילתות קבועות ולא שאילתה לכל קשר: הנכסים בשאילתה אחת,
   * התמונות באחת, וכל השאר בזיכרון.
   */
  private async resolve(
    tx: TenantTx,
    links: TwinLink[],
  ): Promise<PropertyTwinDto[]> {
    if (links.length === 0) return [];
    const tenantId = TenantContext.current().tenantId;
    const ids = links.map((link) => link.otherId);

    const rows = await tx.property.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        city: true,
        neighborhood: true,
        street: true,
        houseNumber: true,
        propertyType: true,
        dealType: true,
        rooms: true,
        areaSqm: true,
        floor: true,
        priceAgorot: true,
        status: true,
        marketingTitle: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const media = await tx.propertyMedia.findMany({
      where: { tenantId, propertyId: { in: rows.map((r) => r.id) } },
      orderBy: { sortOrder: "asc" },
      select: { propertyId: true, id: true },
    });
    const primaryByProperty = new Map<string, string>();
    for (const item of media) {
      if (!primaryByProperty.has(item.propertyId)) {
        primaryByProperty.set(item.propertyId, item.id);
      }
    }

    return links
      .flatMap((link) => {
        const row = byId.get(link.otherId);
        // נכס בארכיון — הקשר נשאר במסד ואינו מוצג. ראו למעלה.
        if (row === undefined) return [];
        const rooms = row.rooms === null ? undefined : Number(row.rooms);
        const primaryId = primaryByProperty.get(row.id);
        return [
          {
            id: row.id,
            headline: propertyHeadline({
              street: row.street ?? undefined,
              houseNumber: row.houseNumber ?? undefined,
              neighborhood: row.neighborhood ?? undefined,
              city: row.city ?? undefined,
              rooms,
            }),
            ...(row.city !== null ? { city: row.city } : {}),
            ...(row.neighborhood !== null
              ? { neighborhood: row.neighborhood }
              : {}),
            ...(row.street !== null ? { street: row.street } : {}),
            ...(row.houseNumber !== null
              ? { houseNumber: row.houseNumber }
              : {}),
            ...(row.propertyType !== null
              ? { propertyType: row.propertyType }
              : {}),
            ...(row.dealType !== null ? { dealType: row.dealType } : {}),
            ...(rooms !== undefined ? { rooms } : {}),
            ...(row.areaSqm !== null ? { areaSqm: row.areaSqm } : {}),
            ...(row.floor !== null ? { floor: row.floor } : {}),
            ...(row.priceAgorot !== null
              ? { priceAgorot: Number(row.priceAgorot) }
              : {}),
            status: row.status,
            ...(row.marketingTitle !== null
              ? { marketingTitle: row.marketingTitle }
              : {}),
            ...(primaryId !== undefined
              ? { thumbnailUrl: mediaRawPath(row.id, primaryId) }
              : {}),
            ...(link.note !== null ? { note: link.note } : {}),
            linkedAt: link.createdAt,
          } satisfies PropertyTwinDto,
        ];
      })
      /* החדש ראשון — התאום שהוגדר לאחרונה הוא זה שנמצא בראש */
      .sort((a, b) => b.linkedAt.getTime() - a.linkedAt.getTime());
  }
}
