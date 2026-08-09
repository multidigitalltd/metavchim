import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import {
  isContactRole,
  normalizeNameForMatch,
  orderPeople,
  type ContactPerson,
  type ContactRole,
} from "@metavchim/shared";
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

    // דרך findByAnyPhone ולא מול הטלפון הראשי בלבד: מספר משני מוכר
    // חייב להחזיר את האדם הקיים, אחרת ייווצר לו כרטיס שני
    const found = await this.findByAnyPhone(tx, input.phone);
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
      select: { id: true, nameEncrypted: true, phoneEncrypted: true },
    });
    const byId = new Map(related.map((r) => [r.id, r]));

    const people: ContactPerson[] = [
      { contactId: primary.id, name: primary.name, phone: primary.phone, role: null },
    ];
    for (const link of links) {
      const row = byId.get(link.relatedContactId);
      if (!row) continue;
      people.push({
        contactId: row.id,
        name: this.crypto.decrypt(row.nameEncrypted),
        phone: this.crypto.decrypt(row.phoneEncrypted),
        role: isContactRole(link.role) ? link.role : "other",
      });
    }
    return orderPeople(people);
  }

  /**
   * הוספת אדם לכרטיס. אם הטלפון כבר מוכר במשרד — מקשרים את איש
   * הקשר הקיים ולא יוצרים כפילות; זה בדיוק המקרה של בן/בת זוג
   * שכבר נקלטו כליד נפרד בעבר.
   */
  async linkPerson(
    tx: TenantTx,
    contactId: string,
    input: { name: string; phone: string; role: ContactRole },
  ): Promise<{ ok: boolean; reason?: "self" }> {
    const tenantId = TenantContext.current().tenantId;
    const person = await this.findOrCreateByPhone(tx, { name: input.name, phone: input.phone });
    if (person.id === contactId) return { ok: false, reason: "self" };

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
