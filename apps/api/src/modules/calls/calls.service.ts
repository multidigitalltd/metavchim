import type { Readable } from "node:stream";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  assertContactAccess,
  isOrphanContact,
  seesAllContacts,
  visibleCallsCondition,
  visibleContactIds,
} from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import {
  UNANSWERED_OUTCOMES,
  parseCallHighlights,
  RECORDING_BLOCKED_REASON,
  recordingStateOf,
  type CallHighlights,
  type RecordingStatus,
} from "@metavchim/shared";
import { ContactsService, type ContactDto } from "../contacts/contacts.service";
import { TranscriptionService } from "../voice-intake/transcription.service";

/**
 * יומן שיחות.
 *
 * כרגע השיחות מתועדות ידנית בידי המתווך. הטבלה בנויה כך שכשייכנס
 * חיבור לספק טלפוניה, שיחות אוטומטיות ייכנסו לאותו מסך עם
 * source="provider" — בלי מיגרציה ובלי מסך שני.
 */

export interface CallDto {
  id: string;
  direction: "inbound" | "outbound";
  source: string;
  contactId?: string;
  contactName?: string;
  leadId?: string;
  phone?: string;
  occurredAt: Date;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
  /** pending | running | done | failed | unavailable — null = לא הועלתה הקלטה. */
  transcriptionStatus?: string;
  transcript?: string;
  /**
   * הפרטים שחולצו מהשיחה — תקציב, חדרים, אזור ומועד חזרה.
   *
   * מוחזר תמיד, גם ריק: `{}` פירושו „לא זוהה דבר”, וזה מצב תקין
   * ושכיח. השמטת השדה הייתה מחייבת כל מסך להבחין בין „אין” לבין
   * „גרסה ישנה של ה-API”, ואלה שתי שאלות שונות.
   */
  highlights: CallHighlights;
  /**
   * יש קובץ להשמעה.
   *
   * שדה נפרד מ-`transcriptionStatus` ולא נגזר ממנו: שירות תמלול
   * כבוי משאיר את הסטטוס `unavailable` על הקלטה שקיימת לגמרי,
   * והשמעה אינה תלויה בתמלול. גזירה מהסטטוס הייתה מסתירה את הנגן
   * בדיוק מהמשרדים שאין להם תמלול — כלומר מי שההקלטה היא כל מה
   * שיש לו.
   */
  hasRecording: boolean;
  /**
   * **למה אין הקלטה** — ולא רק „אין”.
   *
   * `hasRecording` נשאר בוליאני, כי הצרכנים שלו (כרטיס הוואטסאפ,
   * הסוכן, סינון „עם הקלטה בלבד”) שואלים שאלה אחת: אפשר לנגן?
   * אבל למסך זו הייתה תשובה מטעה: „לא צורפה הקלטה” הוצג באותה
   * מילה עצמה לשיחה שלא הוקלטה, לשיחה שההקלטה שלה בדרך, ולשיחה
   * שהמשיכה שלה נכשלת — ולפעמים בשקט מוחלט.
   */
  recording: RecordingStatus;
  /** פירוט טכני מצונזר של תשובת הספק — רק ל-`settings.manage`. */
  recordingDetail?: string;
  createdAt: Date;
}

export interface CreateCallInput {
  direction: "inbound" | "outbound";
  contactId?: string;
  leadId?: string;
  phone?: string;
  occurredAt: Date;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
  /** manual (ברירת מחדל) | meeting — הקלטה של פגישה מהיומן. */
  source?: string;
  /** הפגישה שההקלטה מתעדת, כשהמקור הוא `meeting`. */
  appointmentId?: string;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly transcription: TranscriptionService,
  ) {}

  async create(input: CreateCallInput): Promise<CallDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      // ליד שהוזן — משמש גם למילוי איש הקשר, כדי שהשיחה תיקשר לכרטיס
      let contactId = input.contactId;
      /*
       * הנכס נקרא מהליד **ברגע היצירה** ונשמר כצילום.
       *
       * ‎`leads.property_id` אינו קבוע — ליד כללי מקבל שיוך לנכס
       * מאוחר יותר, ואז שיחות ישנות שלו היו נספרות בדוח של אותו נכס
       * (ביקורת Codex). הצילום נלקח פעם אחת ואינו משתנה איתו.
       */
      let propertyId: string | null = null;
      if (input.leadId !== undefined) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId },
          select: { contactId: true, propertyId: true },
        });
        contactId = contactId ?? lead?.contactId;
        propertyId = lead?.propertyId ?? null;
      }

      const row = await tx.call.create({
        data: {
          id: ulid(),
          tenantId,
          direction: input.direction,
          source: input.source ?? "manual",
          appointmentId: input.appointmentId ?? null,
          propertyId,
          contactId: contactId ?? null,
          leadId: input.leadId ?? null,
          phoneEncrypted: input.phone ? this.crypto.encrypt(input.phone) : null,
          phoneHash: input.phone ? this.crypto.phoneHash(input.phone) : null,
          occurredAt: input.occurredAt,
          durationMinutes: input.durationMinutes ?? null,
          outcome: input.outcome,
          summary: input.summary ?? null,
          createdBy: userId,
        },
      });

      /*
       * שיחה **שנענתה** עם הליד היא מענה. עד עכשיו `first_response_at`
       * נחתם רק בשינוי סטטוס, ולכן מתווך שהתקשר תוך חמש דקות ושינה
       * סטטוס בערב נמדד כ„ענה בערב”. השיחה קובעת — ורק כשעדיין לא
       * נחתם, ורק כשדיברו: „אין מענה”, „לא נענתה” ו„תא קולי” אינם
       * שיחה, וחתימה עליהם הייתה משתיקה גם את תזכורת ה-SLA של ליד
       * שאיש עוד לא דיבר איתו (ביקורת Codex).
       */
      if (input.leadId !== undefined && input.outcome === "answered") {
        await tx.lead.updateMany({
          where: { id: input.leadId, tenantId, firstResponseAt: null },
          data: { firstResponseAt: input.occurredAt },
        });
      }

      await this.audit.record(tx, {
        action: "call.log",
        entityType: "call",
        entityId: row.id,
        metadata: { direction: input.direction, outcome: input.outcome },
      });

      return this.toDto(tx, row);
    });
  }

  /**
   * יומן השיחות — **מסונן לפי בעלות, כמו כל שאר המערכת.**
   *
   * עד כה הוא החזיר את כל שיחות המשרד לכל סוכן: הסיכום, מספר
   * הטלפון והתמלול המלא של שיחות של עמיתים. זה חרג משאר המודולים —
   * סוכן עם `leads.view_own` אינו רואה את הליד של עמיתו, אבל כן ראה
   * את תמלול השיחה איתו.
   *
   * ## הכלל: הלקוח שלי, **או** שאני רשמתי
   *
   * החלק הראשון הוא `assertContactAccess` בצורתו הקבוצתית. החלק
   * השני אינו נוחות אלא נדרש: לקוח יכול להישאר בלי אף כרטיס
   * שמצביע עליו — מחיקת ליד משאירה את איש הקשר בחיים כל עוד יש
   * שיחות שמצביעות עליו (`deleteContactIfOrphan`) — ואז הוא אינו
   * שייך לאיש, והשיחה הייתה נעלמת גם מהסוכן שרשם אותה (ביקורת
   * Codex). „אני רשמתי” מכסה גם את זה וגם שיחה שנרשמה בלי לקוח.
   *
   * מה שנשאר מחוץ לכלל בכוונה: שיחה שהמרכזייה קלטה (`createdBy`
   * ריק) שהלקוח שלה נמחק. אין ממי לגזור בעלות, והיא נשארת גלויה
   * למנהל בלבד — מחיקת ליד היא פעולה ניהולית ומכוונת.
   */
  async list(query: {
    outcome?: string;
    leadId?: string;
    /**
     * שיחות של איש קשר אחד.
     *
     * הסינון חייב להיות **בשאילתה** ולא אחריה: מי שיש לו יותר
     * שיחות חדשות מהתקרה עם לקוחות אחרים היה מקבל רשימה שהלקוח
     * המבוקש כלל אינו בה, והכרטיס היה מציג „אין שיחות” על לקוח
     * שדיברו איתו אתמול (ביקורת Codex).
     */
    contactId?: string;
    /**
     * רק שיחות שיש להן הקלטה.
     *
     * אותו היגיון כמו `contactId`, ומאותה סיבה: „ההקלטה האחרונה”
     * היא ההקלטה האחרונה, לא „השיחה האחרונה אם במקרה הוקלטה”. לקוח
     * עם עשר שיחות חדשות בלי הקלטה היה מקבל „אין הקלטה זמינה” בזמן
     * שההקלטה קיימת, שורה אחת מתחת לתקרה (ביקורת Codex).
     */
    recordedOnly?: boolean;
    /** שיחה אחת לפי מזהה — עדיין דרך סינון הבעלות של הרשימה. */
    id?: string;
    /**
     * רק שיחות מאז המועד הזה.
     *
     * החלון חייב להיות **בתוך השאילתה** ולא סינון אחריה: תקרה
     * גלובלית של „החדשות ביותר” מסירה שיחות ותיקות מהחלון עוד לפני
     * שהמסנן רואה אותן, ואי אפשר להחזיר שורה שכבר נחתכה (ביקורת
     * Codex). כך התקרה חלה על החלון בלבד.
     */
    since?: Date;
    limit: number;
  }): Promise<CallDto[]> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const visible = await visibleContactIds(tx, tenantId);
      const narrow = {
        ...(query.outcome ? { outcome: query.outcome } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(query.recordedOnly ? { recordingKey: { not: null } } : {}),
        ...(query.id ? { id: query.id } : {}),
        ...(query.since ? { occurredAt: { gte: query.since } } : {}),
      };
      /*
       * „אני רשמתי” חל רק על שיחה **בלי בעלים** — בלי איש קשר, או
       * עם לקוח שאינו שייך עוד לאיש. לקוח חי שהמודול שלו נחסם אינו
       * חוזר דרך הענף הזה, אחרת שיחה שנרשמה כשהמודול היה פתוח הייתה
       * שורדת את חסימתו (ביקורת Codex).
       *
       * ## למה SQL גולמי דווקא כאן
       *
       * תנאי הראות חייבים להיות **בשאילתה אחת עם ה-LIMIT**:
       * סינון אחרי החיתוך מקצר את העמוד, וחישוב היתמות מראש דורש
       * לשלוף את כל אנשי הקשר שהמשתמש רשם עליהם — קבוצה שגדלה עם
       * ההיסטוריה וממילא נכנסת ל-`IN` (שתי ביקורות Codex, שתי
       * גרסאות שלי).
       *
       * `NOT EXISTS` עונה על שתיהן: המסד מכריע יתמות לשורה בזמן
       * הסריקה, ועוצר ב-`LIMIT`. אין רשימת מזהים בזיכרון ואין
       * פרמטרים שגדלים עם המשרד.
       *
       * זה **לא** מעקף RLS: `withTenant` פתחה טרנזקציה והזריקה
       * `app.tenant_id` לאותו חיבור, והשאילתה הזו רצה בתוכה —
       * הפוליסות חלות עליה כמו על כל `tx.*`. זהו אותו דפוס
       * שב-`exclusivity.service.ts`: SQL גולמי בוחר מזהים לפי סדר,
       * ו-Prisma שולפת את השורות עצמן.
       */
      let allowedIds: string[] | null = null;
      if (visible !== null) {
        const ordered = await tx.$queryRaw<{ id: string }[]>`
          SELECT c.id
            FROM calls c
           WHERE ${visibleCallsCondition(tenantId, userId, visible)}
             AND (${query.outcome ?? null}::text IS NULL OR c.outcome = ${query.outcome ?? null})
             AND (${query.leadId ?? null}::char(26) IS NULL OR c.lead_id = ${query.leadId ?? null})
             AND (${query.contactId ?? null}::char(26) IS NULL OR c.contact_id = ${query.contactId ?? null})
             AND (${query.id ?? null}::char(26) IS NULL OR c.id = ${query.id ?? null})
             AND (${query.recordedOnly === true} = false OR c.recording_key IS NOT NULL)
             AND (${query.since ?? null}::timestamptz IS NULL OR c.occurred_at >= ${query.since ?? null})
           ORDER BY c.occurred_at DESC
           LIMIT ${query.limit}
        `;
        allowedIds = ordered.map((row) => row.id);
        if (allowedIds.length === 0) return [];
      }

      const allowed = await tx.call.findMany({
        where:
          allowedIds === null
            ? { tenantId, ...narrow }
            : // הסינון כבר הוכרע למעלה; כאן רק שליפת השורות לפי מזהה
              { tenantId, id: { in: allowedIds } },
        orderBy: { occurredAt: "desc" },
        take: query.limit,
      });

      /*
       * שאילתה אחת לכל אנשי הקשר בעמוד. `Promise.all` על `toDto`
       * נראה מקבילי, אבל כל קריאה בתוכו הייתה שאילתה נפרדת על אותו
       * חיבור — כלומר עמוד של חמישים שיחות היה חמישים הלוך-ושוב.
       */
      const contactsById = await this.contacts.getByIds(
        tx,
        allowed.map((row) => row.contactId).filter((id): id is string => id !== null),
      );
      return Promise.all(allowed.map((row) => this.toDto(tx, row, contactsById)));
    });
  }

  /**
   * השיחה **האחרונה** של כל איש קשר בחלון — לרשימת „למי לחזור”.
   *
   * ## למה שאילתה משלה ולא `list` עם תקרה
   *
   * „למי לחזור” מוכרעת לפי מה שקרה אחרון עם כל אדם, ולכן כל מה
   * שנחוץ הוא שורה אחת לאיש קשר. גרסה קודמת שלפה את 500 השיחות
   * החדשות בחלון וסיננה אחריהן — ומשרד עמוס חצה את התקרה, כך שלקוח
   * שהתקשר לפני עשרה ימים ומאז שקט נפל מהרשימה בשקט. תקרה גדולה
   * יותר הייתה דוחה את אותו באג, לא מתקנת אותו (ביקורת Codex).
   *
   * `DISTINCT ON` מכריע את „האחרונה” במסד. הגודל חסום מטבעו —
   * מספר אנשי הקשר שדיברו איתם בחלון — ולכן אין כאן תקרה שתחתוך
   * שוב את הצד הלא-נכון.
   *
   * ## מה נשאר זהה
   *
   * תנאי הראות הם **אותו נוסח** של `list`, כולל ענפי „אני רשמתי”:
   * שתי דרכים לשאול על אותה שיחה חייבות לראות אותה אותו דבר.
   * שיחות בלי איש קשר אינן כאן — לא כי אינן נראות, אלא כי „חזרה”
   * מחייבת אדם.
   */
  async latestPerContactSince(since: Date): Promise<CallDto[]> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const visible = await visibleContactIds(tx, tenantId);
      const latest = await tx.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT ON (c.contact_id) c.id
          FROM calls c
         WHERE ${visibleCallsCondition(tenantId, userId, visible)}
           AND c.contact_id IS NOT NULL
           AND c.occurred_at >= ${since}
         ORDER BY c.contact_id, c.occurred_at DESC
      `;
      const ids = latest.map((row) => row.id);
      if (ids.length === 0) return [];

      const rows = await tx.call.findMany({
        where: { tenantId, id: { in: ids } },
        orderBy: { occurredAt: "desc" },
      });
      const contactsById = await this.contacts.getByIds(
        tx,
        rows.map((row) => row.contactId).filter((id): id is string => id !== null),
      );
      return Promise.all(rows.map((row) => this.toDto(tx, row, contactsById)));
    });
  }

  /**
   * שער השיחה הבודדת — **אותו כלל כמו ברשימה, בצורת רשומה אחת.**
   *
   * „הלקוח שלי **או** אני רשמתי **או** שאיש אינו בעליה”, ומנהל
   * שרואה גם קונים וגם לידים רואה הכול — בדיוק ארבעת התנאים
   * שהרשימה בונה, כדי ששני המסלולים לא ייתנו תשובות שונות על
   * אותה שיחה.
   *
   * הסדר מכוון: „אני רשמתי” נבדק ראשון כי הוא זול ואינו נוגע במסד
   * שוב, והוא גם הענף שמכסה שיחה שהלקוח שלה נמחק ואינו שייך עוד
   * לאיש.
   *
   * תמיד 404 ובאותו נוסח: תשובה שונה על „קיימת אך לא שלך” הייתה
   * מסגירה את קיומה, ואת זה אין למשתמש הזה הרשאה לדעת.
   */
  private async assertCallAccess(tx: TenantTx, id: string): Promise<void> {
    const { tenantId, userId } = TenantContext.current();
    const row = await tx.call.findFirst({
      where: { id, tenantId },
      select: { contactId: true, createdBy: true },
    });
    if (!row) throw new NotFoundException("שיחה לא נמצאה");

    // אותו ניסוח בדיוק כמו ברשימה — לא עותק שלו
    if (seesAllContacts()) return;
    /*
     * „אני רשמתי” — רק על שיחה בלי בעלים, כמו ברשימה. שיחה בלי
     * איש קשר, או עם לקוח שאינו כרטיס של איש.
     */
    if (row.createdBy === userId && row.contactId === null) return;
    /*
     * שיחה שאיש אינו בעליה — שיחה ממרכזייה שלא נענתה ממספר לא
     * מוכר: אין משתמש שכתב אותה ואין ליד שנפתח. הענף הרביעי
     * ברשימה, ובלעדיו כאן היא נראית ברשימה ומחזירה 404 בפתיחה.
     */
    if (row.createdBy === null && row.contactId === null) return;
    if (row.contactId === null) throw new NotFoundException("שיחה לא נמצאה");
    if (row.createdBy === userId && (await isOrphanContact(tx, tenantId, row.contactId))) return;

    // ההודעה מאוחדת: „איש קשר לא נמצא” היה מסגיר שהשיחה עצמה קיימת
    await assertContactAccess(tx, tenantId, row.contactId).catch(() => {
      throw new NotFoundException("שיחה לא נמצאה");
    });
  }

  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      // מחיקה היא פעולה על השיחה, ולכן היא עוברת את אותו שער כמו
      // הצפייה בה — אחרת סוכן היה יכול למחוק שיחה שאינו רשאי לראות
      await this.assertCallAccess(tx, id);
      const result = await tx.call.deleteMany({ where: { id, tenantId } });
      if (result.count === 0) throw new NotFoundException("שיחה לא נמצאה");
      await this.audit.record(tx, { action: "call.delete", entityType: "call", entityId: id });
    });
  }


  /**
   * צירוף הקלטה לשיחה קיימת.
   *
   * ההקלטה נשמרת ב-S3 והתמלול מתבצע ברקע — לא בבקשה. תמלול של שיחה
   * בת עשר דקות אורך דקות על CPU, ובקשת HTTP שממתינה לו נופלת על
   * timeout ומשאירה את המתווך בלי מושג מה קרה.
   *
   * הסטטוס נכתב מיד ל-pending, כך שהמסך אומר "ממתין לתמלול" ולא
   * נראה כאילו ההעלאה לא קרתה.
   */
  async attachRecording(
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ status: string }> {
    const tenantId = TenantContext.current().tenantId;
    const available = (await this.transcription.status()).available;

    /*
     * השער **לפני** ההעלאה, ולא אחריה. שני נימוקים, ושניהם אמיתיים:
     * צירוף הקלטה לשיחה שאינה שלי הוא כתיבה לכרטיס של עמית, ובקשה
     * שנדחית אחרי ההעלאה משאירה אובייקט ב-S3 שאף שורה אינה מצביעה
     * עליו — כלומר מסלולי המחיקה לא ימצאו אותו לעולם.
     */
    await this.prisma.withTenant((tx) => this.assertCallAccess(tx, id));

    const key = `calls/${tenantId}/${id}/${ulid()}`;
    await this.storage.put(key, file.buffer, file.mimetype || "audio/webm", tenantId);

    await this.prisma.withTenant(async (tx) => {
      const updated = await tx.call.updateMany({
        where: { id, tenantId },
        data: {
          recordingKey: key,
          // שירות תמלול כבוי אינו כשל אלא תצורה — המסך אומר זאת אחרת,
          // והעובד לא יאסוף את השיחה לסריקה אינסופית
          transcriptionStatus: available ? "pending" : "unavailable",
          transcript: null,
          transcribedAt: null,
        },
      });
      if (updated.count === 0) throw new NotFoundException("שיחה לא נמצאה");
      await this.audit.record(tx, {
        action: "call.recording_attached",
        entityType: "call",
        entityId: id,
      });
    });

    return { status: available ? "pending" : "unavailable" };
  }

  /**
   * הפעלת תמלול מחדש — להקלטה שהתמלול שלה נכשל.
   *
   * הכשל השכיח הוא זמני (שירות התמלול היה עמוס או לא זמין), וההקלטה
   * עצמה שמורה — אבל עד עכשיו לא הייתה שום דרך לבקש ניסיון נוסף
   * חוץ מהעלאת הקובץ מחדש (בקשת המשתמש). האיפוס ל-pending מחזיר את
   * השיחה לתור של עובד התמלול, בדיוק כמו אחרי העלאה.
   *
   * מותר רק מ-failed: תמלול שהצליח אינו נדרס בלחיצה, ו-pending או
   * running כבר בתור. אותו שער בעלות כמו בצירוף הקלטה.
   */
  async retryTranscription(id: string): Promise<{ status: string }> {
    const tenantId = TenantContext.current().tenantId;
    const available = (await this.transcription.status()).available;
    if (!available) {
      throw new BadRequestException(
        "שירות התמלול אינו מופעל בשרת — ראו docs/10",
      );
    }
    await this.prisma.withTenant(async (tx) => {
      await this.assertCallAccess(tx, id);
      const updated = await tx.call.updateMany({
        where: {
          id,
          tenantId,
          transcriptionStatus: "failed",
          recordingKey: { not: null },
        },
        data: { transcriptionStatus: "pending", transcript: null, transcribedAt: null },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          "אין כאן תמלול שנכשל — אולי הוא כבר רץ או הצליח",
        );
      }
      await this.audit.record(tx, {
        action: "call.transcription_retried",
        entityType: "call",
        entityId: id,
      });
    });
    return { status: "pending" };
  }

  /**
   * ההקלטה להשמעה — הזרמה דרך ה-API ולא קישור לאחסון.
   *
   * MinIO יושב ברשת פנימית בלי כתובת ציבורית, וכתובת חתומה הייתה
   * הופכת הקלטה של לקוח לקישור שאפשר להעביר הלאה. כאן כל בקשה
   * עוברת את אותו שער של שאר המערכת.
   *
   * ## למה RLS לבדו אינו מספיק כאן
   *
   * ‎`FORCE ROW LEVEL SECURITY`‎ מבודד **משרד ממשרד**, לא סוכן
   * מסוכן. שליפה לפי `{ id, tenantId }` בלבד הייתה מאפשרת לסוכן עם
   * `leads.view_own` להשמיע את שיחת הלקוח של סוכן אחר — ידיעת מזהה
   * אינה הרשאה, וזה בדיוק ה-IDOR הפנימי ש-`ownership.ts` נבנה נגדו
   * (ביקורת Codex).
   *
   * הבעלות נגזרת מאיש הקשר, כמו בכל שאר הישויות שאין להן בעלים
   * משלהן: `assertContactAccess` בודק אם הלקוח מופיע ככרטיס קונה,
   * כליד או כבעל נכס שהמשתמש רשאי לראות. שיחה שנרשמה ידנית בלי
   * איש קשר שייכת למי שרשם אותה.
   *
   * ## למה 404 ולמה בסדר הזה
   *
   * בדיקת הבעלות קודמת לבדיקת קיום ההקלטה, ושתיהן מחזירות 404
   * זהה. אחרת ההבדל בין „אין הקלטה” לבין „לא שלך” היה מסגיר לסוכן
   * אילו משיחות העמיתים שלו מוקלטות.
   */
  async recording(
    id: string,
  ): Promise<{ body: Readable; contentType: string; contentLength?: number }> {
    const key = await this.prisma.withTenant(async (tx) => {
      await this.assertCallAccess(tx, id);
      const row = await tx.call.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId },
        select: { recordingKey: true },
      });
      /*
       * שיחה בלי הקלטה אינה שגיאת שרת אלא מצב רגיל — רוב השיחות
       * אינן מוקלטות, והמסך צריך לדעת להבדיל בין "אין" ל"נכשל".
       */
      if (!row?.recordingKey) throw new NotFoundException("לשיחה אין הקלטה");
      return row.recordingKey;
    });

    const object = await this.storage.getObject(key);
    return {
      body: object.body as Readable,
      contentType: object.contentType ?? "audio/wav",
      ...(object.contentLength === undefined ? {} : { contentLength: object.contentLength }),
    };
  }

  /**
   * „נסו למשוך שוב” — מאפס את ההמתנה כדי שהסבב הבא ייקח את השיחה.
   *
   * הפעולה אינה מושכת בעצמה. משיכה סינכרונית הייתה מחזיקה את
   * הבקשה עד דקה שלמה מול שרת חיצוני, ובכשל היא גם לא הייתה
   * מספרת יותר ממה שכבר רשום. איפוס החותמת עולה מיליוניות שנייה
   * ומחזיר את השיחה לראש התור, כי המיון הוא „מי שטרם נוסה קודם”.
   *
   * מותנה ב-`recordingKey: null` ובקיום נתיב: אין טעם לתור על
   * שיחה שכבר יש לה הקלטה, ואין לאן לפנות בלי נתיב.
   *
   * ‎`assertCallAccess` קודם לעדכון, ולא רק סינון לפי דייר.
   *
   * בידוד הדייר אינו הגבול היחיד כאן: שיחה שייכת גם לסוכן, ו-`list`,
   * ‎`recording`, `attachRecording` ו-`retryTranscription` כולם אוכפים
   * את הבעלות הזו. בלי אותה אכיפה, סוכן שמנחש מזהה של שיחה של עמית
   * היה יכול לאפס לה את מצב המשיכה — ובעיקר ללמוד מהתשובה `queued`
   * שלשיחה ההיא **יש** נתיב הקלטה אצל הספק (ביקורת Codex).
   */
  async retryRecording(id: string): Promise<{ queued: boolean }> {
    return this.prisma.withTenant(async (tx) => {
      await this.assertCallAccess(tx, id);
      const tenantId = TenantContext.current().tenantId;
      const done = await tx.call.updateMany({
        where: {
          id,
          tenantId,
          recordingKey: null,
          providerRecordingPath: { not: null },
          /*
           * שיחה שמסומנת „אין חיבור” אינה נכנסת לתור.
           *
           * הסבב חוזר ריק לפני שהוא בוחר ולו שיחה אחת כשאין
           * אינטגרציה פעילה, ולכן `queued: true` כאן היה הצהרה
           * שקרית: הסבב הבא היה מחזיר את אותה סיבה בדיוק. הסימון
           * עצמו הוא הבדיקה — אין צורך לשאול את טבלת האינטגרציות,
           * ומשרד שהפעיל את החיבור מחדש נאסף ממילא בסבב הבא, כי
           * חותמת הניסיון שלו ריקה (ביקורת Codex).
           */
          NOT: { providerRecordingError: RECORDING_BLOCKED_REASON },
          /*
           * ומאותו נימוק בדיוק — שיחה שלא נענתה אינה נכנסת לתור.
           * הסבב מסנן אותה החוצה, ולכן `queued: true` כאן היה הבטחה
           * שלא תתקיים. ראו `recordingWorthPulling`.
           */
          outcome: { notIn: [...UNANSWERED_OUTCOMES] },
        },
        data: { providerRecordingAttemptAt: null, providerRecordingError: null },
      });
      if (done.count === 0) return { queued: false };
      await this.audit.record(tx, {
        action: "call.recording.retry",
        entityType: "call",
        entityId: id,
      });
      return { queued: true };
    });
  }

  private async toDto(
    tx: TenantTx,
    row: {
      id: string;
      direction: string;
      source: string;
      contactId: string | null;
      leadId: string | null;
      phoneEncrypted: string | null;
      occurredAt: Date;
      durationMinutes: number | null;
      outcome: string;
      summary: string | null;
      transcriptionStatus?: string | null;
      transcript?: string | null;
      highlights?: unknown;
      recordingKey?: string | null;
      providerRecordingPath?: string | null;
      providerRecordingAttemptAt?: Date | null;
      providerRecordingError?: string | null;
      providerRecordingDetail?: string | null;
      createdAt: Date;
    },
    /**
     * אנשי הקשר של העמוד, כשהקורא כבר שלף אותם. חסר ⇒ שליפה בודדת,
     * וזה הנתיב של יצירה או של כרטיס יחיד.
     */
    contactsById?: Map<string, ContactDto>,
  ): Promise<CallDto> {
    const contact =
      row.contactId === null
        ? null
        : (contactsById?.get(row.contactId) ?? (await this.contacts.getById(tx, row.contactId)));
    return {
      id: row.id,
      direction: row.direction as "inbound" | "outbound",
      source: row.source,
      ...(row.contactId ? { contactId: row.contactId } : {}),
      ...(contact ? { contactName: contact.name } : {}),
      ...(row.leadId ? { leadId: row.leadId } : {}),
      // הטלפון של איש הקשר מנצח — הוא המקור המעודכן
      ...(contact?.phone
        ? { phone: contact.phone }
        : row.phoneEncrypted
          ? { phone: this.crypto.decrypt(row.phoneEncrypted) }
          : {}),
      occurredAt: row.occurredAt,
      hasRecording: (row.recordingKey ?? null) !== null,
      recording: recordingStateOf(row),
      /*
       * הפירוט הטכני — **רק למי שיכול לתקן את החיבור.**
       *
       * הקוד לבדו („התשובה מהמרכזייה לא נקראה”) אמר למתווך שמשהו
       * נכשל ולא נתן לו דבר לעשות איתו — בדיוק הדיווח שחזר מהשטח.
       * הפירוט עונה על „למה”, אבל הוא מדבר בשמות מפתחות של הספק:
       * הוא מיועד למי שמחזיק את מסך ההגדרות, ורק מבלבל את מי שרצה
       * לשמוע את השיחה.
       */
      ...(row.providerRecordingDetail !== null &&
      row.providerRecordingDetail !== undefined &&
      TenantContext.current().capabilities.has("settings.manage")
        ? { recordingDetail: row.providerRecordingDetail }
        : {}),
      ...(row.durationMinutes !== null ? { durationMinutes: row.durationMinutes } : {}),
      outcome: row.outcome,
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.transcriptionStatus ? { transcriptionStatus: row.transcriptionStatus } : {}),
      ...(row.transcript ? { transcript: row.transcript } : {}),
      highlights: parseCallHighlights(row.highlights),
      createdAt: row.createdAt,
    };
  }
}
