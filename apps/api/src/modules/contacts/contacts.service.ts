import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import {
  isContactRole,
  normalizeNameForMatch,
  orderPeople,
  type ContactPerson,
  type ContactRole,
} from "@metavchim/shared";
import { lockContact, lockContactPhone } from "../../common/locks";
import { TenantContext } from "../../common/tenant-context";
import { CryptoService } from "../../core/crypto.service";
import type { TenantTx } from "../../core/prisma.service";

export interface ContactDto {
  id: string;
  name: string;
  phone: string;
  /** אופציונלי: כרטיס שנוצר משיחה נכנסת או מטופס לא תמיד כולל אימייל */
  email?: string;
}

/**
 * אדם אמיתי אחד לכל דייר (docs/03 §3): ה-PII מוצפן בכתיבה, phone_hash
 * משמש לזיהוי כפילויות — אותו טלפון לעולם לא יוצר שני אנשים.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly crypto: CryptoService) {}

  /**
   * איתור איש קשר לפי **כל אחד** ממספריו — הראשי או אחד הנוספים.
   *
   * הפונקציה הזו היא הסיבה שטלפונים נוספים שווים משהו: בלעדיה הודעת
   * וואטסאפ מהנייד השני של אותו אדם, או מהנייד של בן/בת הזוג, הייתה
   * פותחת ליד חדש כאילו מדובר בזר. מחפשים קודם בטלפון הראשי (הנתיב
   * הנפוץ, אינדקס ייחודי), ורק במקרה של החמצה בטבלת הנוספים.
   */
  async findByAnyPhone(tx: TenantTx, phone: string): Promise<{ id: string } | null> {
    const tenantId = TenantContext.current().tenantId;
    const phoneHash = this.crypto.phoneHash(phone);

    const primary = await tx.contact.findUnique({
      where: { tenantId_phoneHash: { tenantId, phoneHash } },
      select: { id: true },
    });
    if (primary) return primary;

    const secondary = await tx.contactPhone.findUnique({
      where: { tenantId_phoneHash: { tenantId, phoneHash } },
      select: { contactId: true },
    });
    return secondary ? { id: secondary.contactId } : null;
  }

  async findOrCreateByPhone(
    tx: TenantTx,
    input: { name: string; phone: string },
  ): Promise<ContactDto> {
    const tenantId = TenantContext.current().tenantId;
    const phoneHash = this.crypto.phoneHash(input.phone);

    /*
     * נעילת המספר **לפני** החיפוש — ראו `lockContactPhone`.
     *
     * הנעילה על הכרטיס שנמצא (למטה) מגנה על מיחזור בלבד. שתי פניות
     * מקבילות מאותו מספר **חדש** אינן מוצאות דבר, ולכן שתיהן מגיעות
     * ל-`create` והאינדקס הייחודי מפיל את השנייה — בתוך טרנזקציה
     * זו אינה שגיאה שאפשר לתפוס אלא נפילה של הפנייה כולה.
     */
    await lockContactPhone(tx, tenantId, phoneHash);

    // דרך findByAnyPhone ולא מול הטלפון הראשי בלבד: מספר משני מוכר
    // חייב להחזיר את האדם הקיים, אחרת ייווצר לו כרטיס שני
    const found = await this.findByAnyPhone(tx, input.phone);
    /*
     * נעילה לפני הקריאה החוזרת: מחיקת ליד מוחקת גם כרטיס שנשאר בלי
     * שום קשר, והיא נועלת את אותו מפתח. בלי זה, הליד הנכנס הזה היה
     * יכול להצביע על כרטיס שנמחק שבריר שנייה אחריו (ביקורת Codex).
     * `findFirst` שמחזיר null אחרי הנעילה מפיל אותנו ליצירת כרטיס חדש.
     */
    if (found) await lockContact(tx, found.id);
    const existing = found
      ? await tx.contact.findFirst({
          where: { id: found.id, tenantId },
          select: { id: true, nameEncrypted: true, phoneEncrypted: true },
        })
      : null;
    if (existing) {
      return {
        id: existing.id,
        name: this.crypto.decrypt(existing.nameEncrypted),
        phone: this.crypto.decrypt(existing.phoneEncrypted),
      };
    }

    const id = ulid();
    await tx.contact.create({
      data: {
        id,
        tenantId,
        nameEncrypted: this.crypto.encrypt(input.name),
        phoneEncrypted: this.crypto.encrypt(input.phone),
        phoneHash,
        // חתימת השם נכתבת מיד — כרטיס חדש נכנס לאיתור הכפילויות
        // בלי להמתין לסריקת ההשלמה
        nameHash: this.crypto.nameHash(normalizeNameForMatch(input.name)),
      },
    });
    return { id, name: input.name, phone: input.phone };
  }

  async getById(tx: TenantTx, id: string): Promise<ContactDto | null> {
    const row = await tx.contact.findFirst({
      where: { id, tenantId: TenantContext.current().tenantId },
      select: { id: true, nameEncrypted: true, phoneEncrypted: true, emailEncrypted: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: this.crypto.decrypt(row.nameEncrypted),
      phone: this.crypto.decrypt(row.phoneEncrypted),
      // האימייל אופציונלי — כרטיס שנוצר משיחה או מטופס לא תמיד כולל אותו
      ...(row.emailEncrypted ? { email: this.crypto.decrypt(row.emailEncrypted) } : {}),
    };
  }

  /**
   * כמה אנשי קשר בשאילתה אחת — לרשימות.
   *
   * המסכים שמציגים שם ליד כל שורה קראו ל-`getById` בלולאה: עמוד של
   * חמישים קונים היה חמישים שאילתות, ומסך ההתאמות עשה את זה פעמיים.
   * הפענוח נשאר לכל שורה (הוא מקומי וזול); מה שהוסר הוא הלוך-ושוב
   * לבסיס הנתונים.
   *
   * מזהה שאינו נמצא פשוט חסר מהמפה — הקוראים כבר מדלגים על שורה בלי
   * איש קשר, וזו התנהגות שנשמרת.
   */
  async getByIds(tx: TenantTx, ids: readonly string[]): Promise<Map<string, ContactDto>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const rows = await tx.contact.findMany({
      where: { id: { in: unique }, tenantId: TenantContext.current().tenantId },
      select: { id: true, nameEncrypted: true, phoneEncrypted: true, emailEncrypted: true },
    });
    const byId = new Map<string, ContactDto>();
    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        name: this.crypto.decrypt(row.nameEncrypted),
        phone: this.crypto.decrypt(row.phoneEncrypted),
        ...(row.emailEncrypted ? { email: this.crypto.decrypt(row.emailEncrypted) } : {}),
      });
    }
    return byId;
  }

  /** האימייל של הכרטיס — מפוענח לתצוגה; undefined כשאין. */
  async emailFor(tx: TenantTx, contactId: string): Promise<string | undefined> {
    const tenantId = TenantContext.current().tenantId;
    const row = await tx.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { emailEncrypted: true },
    });
    return row?.emailEncrypted ? this.crypto.decrypt(row.emailEncrypted) : undefined;
  }

  /**
   * ‎**שינוי שם הכרטיס.**
   *
   * ‏כרטיס שנוצר משיחה נכנסת שבה לא זוהה שם נשמר עם מספר הטלפון
   * במקומו (`callerName ?? phone` בשירות הטלפוניה), וכך הוא נשאר:
   * לא היה נתיב לתקן אותו, והמתווך ראה מספר במקום שם בכל מסך —
   * בכרטיס הקונה, ברשימות, ובכל התאמה.
   *
   * ‎**וחתימת השם משתנה יחד איתו.** `nameHash` היא מה שאיתור
   * הכפילויות והחיפוש עובדים מולו, בלי לפענח. שם שהשתנה וחתימה
   * שנשארה מאחור פירושם מנוע כפילויות שמשווה שמות שכבר אינם
   * קיימים — הוא ימשיך להצביע על „כפילות” שנעלמה, ויחמיץ את זו
   * שנוצרה עכשיו. שני השדות נכתבים באותה פעולה, או ששניהם לא.
   *
   * מחזיר `true` רק כשהשם באמת השתנה: קריאה שאינה משנה דבר אינה
   * אירוע, ואינה אמורה להשאיר רשומת ביקורת שמתעדת שינוי שלא היה.
   */
  async setName(tx: TenantTx, contactId: string, name: string): Promise<boolean> {
    const tenantId = TenantContext.current().tenantId;
    const next = name.trim();
    const row = await tx.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { nameEncrypted: true, nameHash: true },
    });
    if (!row) return false;
    if (this.crypto.decrypt(row.nameEncrypted) === next) return false;

    const nextHash = this.crypto.nameHash(normalizeNameForMatch(next));
    await tx.contact.updateMany({
      where: { id: contactId, tenantId },
      data: { nameEncrypted: this.crypto.encrypt(next), nameHash: nextHash },
    });

    /*
     * ‎**„אלה אינם אותו אדם” נאמר על חברוּת מסוימת, והשם שזז שינה
     * אותה — בשתי הקבוצות** (ביקורת Codex, P2).
     *
     * הדחייה נשמרת כ„גודל הקבוצה ברגע הדחייה”, וההצעה חוזרת רק
     * כשהגודל עולה מעליו. אבל שינוי שם מזיז כרטיס **בין** קבוצות,
     * והגודל יכול לחזור לאותו מספר עם אנשים אחרים לגמרי: קבוצה
     * שנדחתה בגודל 2, כרטיס אחד יצא ממנה ואחר נכנס — שוב 2, ולכן
     * שוב מוסתרת, אף שזהו זוג שאיש מעולם לא אמר עליו שאינו אותו
     * אדם. הצעת מיזוג אמיתית נשארת נסתרת עד שהגודל ישתנה שוב.
     *
     * שתי הדחיות נמחקות — של השם הישן ושל החדש — כי בשתיהן החברוּת
     * כבר אינה זו שנדחתה. אותה הכרעה בדיוק כמו במחיקת כרטיס: המחיר
     * הוא שההצעה עשויה לחזור, וזה עדיף על הסתרה שאיש לא ביקש.
     */
    const stale = [row.nameHash, nextHash].filter((h): h is string => h !== null);
    await tx.duplicateDismissal.deleteMany({
      where: { tenantId, nameHash: { in: stale } },
    });
    return true;
  }

  /**
   * קביעת/ניקוי האימייל של הכרטיס — מוצפן כמו השם והטלפון, ולצידו
   * חתימת HMAC שמאפשרת לסנכרון ה-Gmail להתאים שולח נכנס לכרטיס.
   */
  async setEmail(tx: TenantTx, contactId: string, email: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const normalized = email.trim().toLowerCase();
    await tx.contact.updateMany({
      where: { id: contactId, tenantId },
      data:
        normalized === ""
          ? { emailEncrypted: null, emailHash: null }
          : {
              emailEncrypted: this.crypto.encrypt(email),
              emailHash: this.crypto.emailHash(normalized),
            },
    });
  }

  /**
   * ‎**הסכמה לדיוור — ושני הכיוונים שלה.**
   *
   * ‎`optedOutAt` נכתב עד כה במקום אחד בלבד — דף ההסרה הציבורי —
   * ו**מעולם לא נוקה**. דף ההסרה מבטיח ללקוח, פעמיים, ש„אפשר לחזור
   * בכל עת בפנייה למשרד התיווך”, והמשרד לא יכול היה לקיים את זה:
   * לא היה נתיב, לא היה שדה בטופס, והדרך היחידה הייתה עריכה ידנית
   * במסד (ביקורת Codex). הבטחה שהמוצר נותן ואינו יכול לקיים.
   *
   * ‎**וגם הכיוון השני נחוץ.** לקוח שמתקשר ואומר „תפסיקו לשלוח לי”
   * זכאי לכך מיד, בלי להמתין שיפתח מייל וילחץ על קישור.
   *
   * ‎**מי החליט ומתי נרשם ביומן הביקורת אצל הקורא**: זו רשומת
   * הסכמה, וההבדל בין „הלקוח ביקש” לבין „מישהו שינה” הוא כל ערכה.
   *
   * מחזיר `true` כשהמצב באמת השתנה — קריאה שאינה משנה דבר אינה
   * אירוע, ואינה אמורה לייצר רשומת ביקורת שמתעדת „הסכמה” שלא ניתנה.
   */
  async setMarketingConsent(
    tx: TenantTx,
    contactId: string,
    consent: boolean,
  ): Promise<boolean> {
    const tenantId = TenantContext.current().tenantId;
    const result = await tx.contact.updateMany({
      /*
       * התנאי על המצב הנוכחי הופך את הכתיבה לאטומית ולאידמפוטנטית,
       * בדיוק כמו בדף ההסרה: לחיצה שנייה אינה מזיזה את המועד, ושתי
       * בקשות במקביל אינן מייצרות שתי רשומות ביקורת.
       */
      where: consent
        ? { id: contactId, tenantId, optedOutAt: { not: null } }
        : { id: contactId, tenantId, optedOutAt: null },
      data: { optedOutAt: consent ? null : new Date() },
    });
    return result.count === 1;
  }

  /* ---------- טלפונים נוספים ---------- */

  /** כל הטלפונים של אדם: הראשי תחילה, ואחריו הנוספים לפי סדר ההוספה. */
  async phonesFor(
    tx: TenantTx,
    contactId: string,
  ): Promise<{ id: string | null; phone: string; label: string; primary: boolean }[]> {
    const tenantId = TenantContext.current().tenantId;
    const contact = await tx.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { phoneEncrypted: true },
    });
    if (!contact) return [];
    const extra = await tx.contactPhone.findMany({
      where: { tenantId, contactId },
      orderBy: { createdAt: "asc" },
      select: { id: true, phoneEncrypted: true, label: true },
    });
    return [
      // id ריק לראשי: הוא יושב על contacts ואי אפשר למחוק אותו
      // בלי למחוק את איש הקשר — המסך משתמש בזה כדי להסתיר "הסר"
      { id: null, phone: this.crypto.decrypt(contact.phoneEncrypted), label: "mobile", primary: true },
      ...extra.map((row) => ({
        id: row.id,
        phone: this.crypto.decrypt(row.phoneEncrypted),
        label: row.label,
        primary: false,
      })),
    ];
  }

  /**
   * הוספת טלפון. אידמפוטנטית מול המספר הראשי ומול מספר שכבר קיים
   * אצל אותו אדם; מספר ששייך לאדם *אחר* נדחה, כי הודעה נכנסת ממנו
   * לא הייתה יכולה להכריע לאיזה כרטיס היא שייכת.
   */
  async addPhone(
    tx: TenantTx,
    contactId: string,
    input: { phone: string; label: string },
  ): Promise<{ added: boolean; reason?: "taken" }> {
    const tenantId = TenantContext.current().tenantId;
    const owner = await this.findByAnyPhone(tx, input.phone);
    if (owner) return owner.id === contactId ? { added: false } : { added: false, reason: "taken" };

    await tx.contactPhone.create({
      data: {
        id: ulid(),
        tenantId,
        contactId,
        phoneEncrypted: this.crypto.encrypt(input.phone),
        phoneHash: this.crypto.phoneHash(input.phone),
        label: input.label,
      },
    });
    return { added: true };
  }

  async removePhone(tx: TenantTx, contactId: string, phoneId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await tx.contactPhone.deleteMany({ where: { id: phoneId, tenantId, contactId } });
  }

  /* ---------- אנשים נוספים על הכרטיס ---------- */

  /** איש הקשר הראשי ואחריו המקושרים אליו, עם התפקיד של כל אחד. */
  async peopleFor(tx: TenantTx, contactId: string): Promise<ContactPerson[]> {
    const tenantId = TenantContext.current().tenantId;
    const primary = await this.getById(tx, contactId);
    if (!primary) return [];

    const links = await tx.contactLink.findMany({
      where: { tenantId, contactId },
      orderBy: { createdAt: "asc" },
      select: { relatedContactId: true, role: true },
    });
    if (links.length === 0) {
      return [{ contactId: primary.id, name: primary.name, phone: primary.phone, role: null }];
    }

    // שאילתה אחת לכל המקושרים ולא אחת לכל אחד — כרטיס עם ארבעה
    // אנשים לא ישלח ארבע שאילתות
    const related = await tx.contact.findMany({
      where: { tenantId, id: { in: links.map((l) => l.relatedContactId) } },
      select: { id: true, nameEncrypted: true, phoneEncrypted: true, emailEncrypted: true },
    });
    const byId = new Map(related.map((r) => [r.id, r]));

    const people: ContactPerson[] = [
      {
        contactId: primary.id,
        name: primary.name,
        phone: primary.phone,
        ...(primary.email !== undefined ? { email: primary.email } : {}),
        role: null,
      },
    ];
    for (const link of links) {
      const row = byId.get(link.relatedContactId);
      if (!row) continue;
      people.push({
        contactId: row.id,
        name: this.crypto.decrypt(row.nameEncrypted),
        phone: this.crypto.decrypt(row.phoneEncrypted),
        // האימייל אופציונלי לכל אדם בנפרד — לבן/בת זוג יש תיבה משלהם
        ...(row.emailEncrypted ? { email: this.crypto.decrypt(row.emailEncrypted) } : {}),
        role: isContactRole(link.role) ? link.role : "other",
      });
    }
    return orderPeople(people);
  }

  /**
   * קביעת אימייל לאדם מקושר.
   *
   * הקישור נבדק לפני הכתיבה ולא רק הדיירוּת: בלי הבדיקה הזו מזהה של
   * כל איש קשר במשרד היה מתקבל בנתיב הזה, וסוכן שרואה כרטיס אחד היה
   * יכול לשנות אימייל של לקוח אחר שאינו קשור אליו.
   */
  async setPersonEmail(
    tx: TenantTx,
    contactId: string,
    relatedContactId: string,
    email: string,
  ): Promise<{ ok: boolean }> {
    const tenantId = TenantContext.current().tenantId;
    // האדם הראשי עצמו אינו מקושר לכרטיס — הוא הכרטיס
    if (relatedContactId === contactId) {
      await this.setEmail(tx, contactId, email);
      return { ok: true };
    }

    const link = await tx.contactLink.findFirst({
      where: { tenantId, contactId, relatedContactId },
      select: { id: true },
    });
    if (!link) return { ok: false };

    await this.setEmail(tx, relatedContactId, email);
    return { ok: true };
  }

  /**
   * הוספת אדם לכרטיס. אם הטלפון כבר מוכר במשרד — מקשרים את איש
   * הקשר הקיים ולא יוצרים כפילות; זה בדיוק המקרה של בן/בת זוג
   * שכבר נקלטו כליד נפרד בעבר.
   */
  async linkPerson(
    tx: TenantTx,
    contactId: string,
    input: { name: string; phone: string; role: ContactRole; email?: string },
  ): Promise<{ ok: boolean; reason?: "self" }> {
    const tenantId = TenantContext.current().tenantId;
    const person = await this.findOrCreateByPhone(tx, { name: input.name, phone: input.phone });
    if (person.id === contactId) return { ok: false, reason: "self" };

    // האימייל נכתב רק כשנמסר: קישור חוזר של אדם קיים בלי שדה אימייל
    // לא ימחק את הכתובת שכבר יש לו
    if (input.email !== undefined && input.email !== "") {
      await this.setEmail(tx, person.id, input.email);
    }

    await tx.contactLink.upsert({
      where: {
        tenantId_contactId_relatedContactId: {
          tenantId,
          contactId,
          relatedContactId: person.id,
        },
      },
      create: {
        id: ulid(),
        tenantId,
        contactId,
        relatedContactId: person.id,
        role: input.role,
      },
      // קישור חוזר מעדכן תפקיד במקום להיכשל — "הוספתי אותה כשותפה
      // ואני רוצה בת זוג" היא פעולה סבירה, לא שגיאה
      update: { role: input.role },
    });
    return { ok: true };
  }

  async unlinkPerson(tx: TenantTx, contactId: string, relatedContactId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    // הקישור מוסר; איש הקשר עצמו נשאר, כי ייתכן שהוא לקוח בזכות עצמו
    await tx.contactLink.deleteMany({ where: { tenantId, contactId, relatedContactId } });
  }
}
