import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  groupDuplicates,
  normalizeNameForMatch,
  type DuplicateGroup,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * כרטיסים כפולים: איתור ומיזוג.
 *
 * למה זה קורה: אותו אדם נכנס פעם מטופס האתר עם הנייד, פעם כשהמתווך
 * הקליד אותו ידנית עם טלפון הבית, ופעם מייבוא אקסל ישן. ה-phone_hash
 * מונע כפילות על אותו מספר, אבל אדם עם שני מספרים מקבל שני כרטיסים —
 * ומאותו רגע חצי מההיסטוריה שלו בכרטיס אחד וחצי בשני.
 */

/** תקרת קבוצות שנבדקות בסריקה אחת — הדשבורד מציג, לא מנתח מאגר. */
const SCAN_LIMIT = 400;

@Injectable()
export class DuplicatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * השלמת חתימות שם חסרות.
   *
   * המיגרציה לא יכולה למלא את העמודה — ההצפנה יושבת בשכבת האפליקציה.
   * לכן ההשלמה נעשית כאן, בקבוצות, ונקראת לפני כל סריקה: משרד קיים
   * מקבל איתור כפילויות בלי צעד ידני, ומשרד חדש כבר נכתב עם חתימה.
   */
  async backfillNameHashes(tx: TenantTx, tenantId: string, limit = 500): Promise<number> {
    const rows = await tx.contact.findMany({
      where: { tenantId, nameHash: null },
      take: limit,
      select: { id: true, nameEncrypted: true },
    });
    for (const row of rows) {
      const name = this.crypto.decrypt(row.nameEncrypted);
      await tx.contact.update({
        where: { id: row.id },
        data: { nameHash: this.crypto.nameHash(normalizeNameForMatch(name)) },
      });
    }
    return rows.length;
  }

  /** קבוצות של כרטיסים שנראים כאותו אדם. */
  async findDuplicates(): Promise<DuplicateGroup[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await this.backfillNameHashes(tx, tenantId);

      // רק חתימות שחוזרות יותר מפעם אחת — הקיבוץ נעשה במסד ולא
      // בזיכרון, כדי לא לשלוף את כל אנשי הקשר של המשרד
      const repeated = await tx.contact.groupBy({
        by: ["nameHash"],
        where: { tenantId, nameHash: { not: null } },
        having: { nameHash: { _count: { gt: 1 } } },
        _count: { nameHash: true },
        // Prisma דורש orderBy יחד עם take; המיון לפי גודל הקבוצה גם
        // מבטיח שהתקרה חותכת את הזנב ולא את הכפילויות הגדולות
        orderBy: { _count: { nameHash: "desc" } },
        take: SCAN_LIMIT,
      });
      const hashes = repeated.map((r) => r.nameHash).filter((h): h is string => h !== null);
      if (hashes.length === 0) return [];

      const contacts = await tx.contact.findMany({
        where: { tenantId, nameHash: { in: hashes } },
        select: {
          id: true,
          nameEncrypted: true,
          phoneEncrypted: true,
          nameHash: true,
          createdAt: true,
        },
      });
      const ids = contacts.map((c) => c.id);

      // מדד הפעילות בחמש שאילתות מקובצות ולא אחת לכל כרטיס — משרד
      // עם חמישים כפילויות לא ישלח מאתיים וחמישים שאילתות
      const [buyers, leads, properties, occupied, calls, messages] = await Promise.all([
        // מחוקים אינם פעילות. הציון הזה קובע איזה כרטיס נשאר הראשי
        // במיזוג — ניפוח שלו בגלל רשומות מחוקות בוחר את הכרטיס הלא נכון.
        tx.buyer.groupBy({ by: ["contactId"], where: { tenantId, deletedAt: null, contactId: { in: ids } }, _count: { _all: true } }),
        tx.lead.groupBy({ by: ["contactId"], where: { tenantId, contactId: { in: ids } }, _count: { _all: true } }),
        tx.property.groupBy({ by: ["ownerContactId"], where: { tenantId, deletedAt: null, ownerContactId: { in: ids } }, _count: { _all: true } }),
        // גם „גר בנכס” הוא קשר. המיזוג כבר מעביר אותו, והספירה
        // שקובעת מי הכרטיס הראשי הייתה מתעלמת ממנו — שתי הכרעות על
        // אותו נתון שאינן מסכימות
        tx.property.groupBy({ by: ["occupantContactId"], where: { tenantId, deletedAt: null, occupantContactId: { in: ids } }, _count: { _all: true } }),
        tx.call.groupBy({ by: ["contactId"], where: { tenantId, contactId: { in: ids } }, _count: { _all: true } }),
        tx.message.groupBy({ by: ["contactId"], where: { tenantId, contactId: { in: ids } }, _count: { _all: true } }),
      ]);
      const activity = new Map<string, number>();
      const add = (id: string | null, n: number) => {
        if (id) activity.set(id, (activity.get(id) ?? 0) + n);
      };
      for (const r of buyers) add(r.contactId, r._count._all);
      for (const r of leads) add(r.contactId, r._count._all);
      for (const r of properties) add(r.ownerContactId, r._count._all);
      for (const r of occupied) add(r.occupantContactId, r._count._all);
      for (const r of calls) add(r.contactId, r._count._all);
      for (const r of messages) add(r.contactId, r._count._all);

      const groups = groupDuplicates(
        contacts.map((c) => ({
          contactId: c.id,
          name: this.crypto.decrypt(c.nameEncrypted),
          phone: this.crypto.decrypt(c.phoneEncrypted),
          activity: activity.get(c.id) ?? 0,
          createdAt: c.createdAt,
          nameKey: c.nameHash ?? "",
        })),
      );

      /*
       * קבוצה שנדחתה ("אלה לא אותו אדם") מוסתרת — אבל רק כל עוד היא
       * באותו גודל. כרטיס נוסף שנוצר מאז עם אותו שם הוא שאלה חדשה,
       * וההצעה חוזרת.
       */
      const dismissals = await tx.duplicateDismissal.findMany({
        where: { tenantId, nameHash: { in: hashes } },
        select: { nameHash: true, contactCount: true },
      });
      const dismissedAtCount = new Map(dismissals.map((d) => [d.nameHash, d.contactCount]));
      return groups.filter(
        (g) => (dismissedAtCount.get(g.key) ?? 0) < g.duplicates.length + 1,
      );
    });
  }

  /**
   * דחיית הצעת מיזוג — הקבוצה לא תוצג שוב כל עוד לא נוסף לה כרטיס.
   * גודל הקבוצה נמדד כאן, ברגע הדחייה, ולא נלקח מהלקוח.
   */
  async dismiss(nameKey: string): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const count = await tx.contact.count({ where: { tenantId, nameHash: nameKey } });
      if (count < 2) throw new NotFoundException("קבוצת הכפילות לא נמצאה");
      await tx.duplicateDismissal.upsert({
        where: { tenantId_nameHash: { tenantId, nameHash: nameKey } },
        create: { id: ulid(), tenantId, nameHash: nameKey, contactCount: count },
        update: { contactCount: count },
      });
      /*
       * חתימת השם (64 תווים) לא נכנסת ל-entityId — העמודה היא
       * CHAR(26) והכתיבה הפילה את כל הדחייה. היא נשמרת ב-metadata.
       */
      await this.audit.record(tx, {
        action: "contact.duplicate_dismiss",
        entityType: "contact",
        metadata: { nameHash: nameKey, contactCount: count, byUserId: userId },
      });
      return { ok: true };
    });
  }

  /**
   * מיזוג כרטיס כפול לתוך השורד.
   *
   * הסדר חשוב: כל ההפניות מועברות **לפני** מחיקת הכפול, והכול
   * בטרנזקציה אחת — מיזוג שנקטע באמצע היה משאיר ליד שמצביע על איש
   * קשר שכבר לא קיים.
   *
   * המספר של הכפול לא נזרק אלא הופך למספר נוסף של השורד: זה בדיוק
   * המספר שבגללו נוצרה הכפילות, והוא זה שהלקוח ישתמש בו בפעם הבאה.
   */
  async merge(survivorId: string, duplicateId: string): Promise<{ moved: number }> {
    const { tenantId, userId } = TenantContext.current();
    if (survivorId === duplicateId) {
      throw new BadRequestException("אי אפשר למזג כרטיס לתוך עצמו");
    }

    return this.prisma.withTenant(async (tx) => {
      const [survivor, duplicate] = await Promise.all([
        tx.contact.findFirst({ where: { id: survivorId, tenantId }, select: { id: true } }),
        tx.contact.findFirst({
          where: { id: duplicateId, tenantId },
          select: { id: true, phoneEncrypted: true, phoneHash: true },
        }),
      ]);
      if (!survivor || !duplicate) throw new NotFoundException("כרטיס לא נמצא");

      // הטלפון הראשי של הכפול הופך למספר נוסף של השורד. אם הוא כבר
      // רשום שם (מרוץ, או מיזוג חוזר) — מדלגים בשקט ולא נכשלים.
      const taken = await tx.contactPhone.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash: duplicate.phoneHash } },
        select: { id: true },
      });
      if (!taken) {
        await tx.contactPhone.create({
          data: {
            id: ulid(),
            tenantId,
            contactId: survivorId,
            phoneEncrypted: duplicate.phoneEncrypted,
            phoneHash: duplicate.phoneHash,
            label: "other",
          },
        });
      }

      const results = await Promise.all([
        tx.buyer.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
        tx.lead.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
        tx.property.updateMany({ where: { tenantId, ownerContactId: duplicateId }, data: { ownerContactId: survivorId } }),
        // גם „מי גר בנכס”: מיזוג שמשאיר אותו על הכפיל מנתק את הדייר
        tx.property.updateMany({ where: { tenantId, occupantContactId: duplicateId }, data: { occupantContactId: survivorId } }),
        tx.call.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
        tx.message.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
        // תיבת המייל: ההודעות עוברות לשורד, והטוקן ממשיך לפעול —
        // כתובת ה-Reply-To שכבר יושבת בתיבת הלקוח חייבת להמשיך להגיע
        tx.emailMessage.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
        tx.emailReplyToken.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
        tx.contactPhone.updateMany({ where: { tenantId, contactId: duplicateId }, data: { contactId: survivorId } }),
      ]);
      const moved = results.reduce((sum, r) => sum + r.count, 0);

      /*
       * קישורי האנשים מועברים ידנית ולא ב-updateMany: יש עליהם
       * ייחודיות על הזוג, ושורה שהייתה מתנגשת עם קישור קיים של
       * השורד הייתה מפילה את כל המיזוג. מדלגים על התנגשות.
       */
      const links = await tx.contactLink.findMany({
        where: { tenantId, OR: [{ contactId: duplicateId }, { relatedContactId: duplicateId }] },
        select: { id: true, contactId: true, relatedContactId: true, role: true },
      });
      for (const link of links) {
        const nextContactId = link.contactId === duplicateId ? survivorId : link.contactId;
        const nextRelatedId =
          link.relatedContactId === duplicateId ? survivorId : link.relatedContactId;
        // קישור שהפך לעצמי אחרי המיזוג פשוט נמחק
        if (nextContactId !== nextRelatedId) {
          const exists = await tx.contactLink.findUnique({
            where: {
              tenantId_contactId_relatedContactId: {
                tenantId,
                contactId: nextContactId,
                relatedContactId: nextRelatedId,
              },
            },
            select: { id: true },
          });
          if (!exists) {
            await tx.contactLink.create({
              data: {
                id: ulid(),
                tenantId,
                contactId: nextContactId,
                relatedContactId: nextRelatedId,
                role: link.role,
              },
            });
          }
        }
        await tx.contactLink.delete({ where: { id: link.id } });
      }

      await tx.contact.delete({ where: { id: duplicateId } });

      await this.audit.record(tx, {
        action: "contact.merge",
        entityType: "contact",
        entityId: survivorId,
        // המזהה שנעלם נרשם: אחרי המחיקה זו הראיה היחידה מה קרה כאן
        metadata: { mergedFrom: duplicateId, movedRows: moved, byUserId: userId },
      });

      return { moved };
    });
  }
}
