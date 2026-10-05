import { Injectable, Logger } from "@nestjs/common";
import { normalizeValidPhone } from "@metavchim/shared";
import { lockContactPhone } from "../../common/locks";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { Sweep } from "../../core/sweeps";
import { OPEN_HOUSE_SOURCE } from "./open-house.service";

/** ‏הראשון — מיד אחרי העלייה; ריצה שנכשלה חוזרת אחרי שעה */
const TICK_MS = 60 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 15 * 1000;

/**
 * ‎**טלפוני מבקרי הבית הפתוח — המרה חד-פעמית לכתיב האחיד.**
 *
 * ‏עד שהטופס הציבורי נרמל את הטלפון, מבקר נשמר בכתיב שהקליד
 * ‏(„050-123-4567”) והחתימה שלו (`phoneHash`) הייתה של הכתיב הזה. הקליטה
 * ‏מחפשת לפי החתימה של הכתיב האחיד, ולכן הרשמה חוזרת — לאותו אירוע או
 * ‏לאחר — הייתה פותחת כרטיס שני, ובאותו אירוע גם תופסת מקום שני (ביקורת
 * ‏Codex).
 *
 * ‏ההמרה עוברת פעם אחת על כל מי שהגיע מבית פתוח — דרך ליד שמקורו בבית
 * ‏פתוח, או דרך סיור באירוע (מבקר שהיה לו כבר ליד פתוח ממקור אחר צורף
 * ‏אליו בלי לשנות את המקור) — ומעבירה את הכרטיס לכתיב האחיד. כשהמספר כבר
 * ‏של כרטיס אחר, שני הכרטיסים נשארים כמו שהם: זו כפילות שהייתה קיימת לפני
 * ‏השינוי, ומסך הכפילויות ממזג אותה.
 *
 * ‏סבב חד-פעמי (`once`): בסיום הוא נרשם כגמור, ואינו רץ שוב. ההרשמה עצמה
 * ‏אינה סורקת דבר.
 */
@Injectable()
export class OpenHousePhoneBackfillService {
  private readonly logger = new Logger(OpenHousePhoneBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  @Sweep({ name: "open-house-phone-backfill", everyMs: TICK_MS, firstDelayMs: FIRST_TICK_DELAY_MS, once: true })
  async tick(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let moved = 0;
    for (const { id: tenantId } of tenants) {
      const visitors = await this.prisma.withExplicitTenant(tenantId, (tx) => this.visitors(tx, tenantId));
      for (const visitor of visitors) {
        const phone = normalizeValidPhone(this.crypto.decrypt(visitor.phoneEncrypted));
        if (phone === undefined) continue;
        const phoneHash = this.crypto.phoneHash(phone);
        if (phoneHash === visitor.phoneHash) continue;
        /* ‏כרטיס אחד בטרנזקציה קצרה משלו — היסטוריה ארוכה אינה חורגת מזמן הטרנזקציה */
        const done = await this.prisma.withExplicitTenant(tenantId, (tx) =>
          this.moveToCanonical(tx, tenantId, visitor, phone, phoneHash),
        );
        if (done) moved += 1;
      }
    }
    this.logger.log(`טלפוני מבקרי בית פתוח הומרו לכתיב האחיד: ${moved} כרטיסים`);
  }

  /** ‏כל מי שהגיע מבית פתוח — דרך ליד שמקורו בבית פתוח, או דרך סיור באירוע. */
  async visitors(
    tx: TenantTx,
    tenantId: string,
  ): Promise<{ id: string; phoneEncrypted: string; phoneHash: string }[]> {
    const visits = await tx.appointment.findMany({
      where: { tenantId, openHouseId: { not: null }, leadId: { not: null } },
      select: { leadId: true },
    });
    const visitLeads = visits.flatMap((visit) => (visit.leadId === null ? [] : [visit.leadId]));
    const leads = await tx.lead.findMany({
      where: { tenantId, OR: [{ source: OPEN_HOUSE_SOURCE }, { id: { in: visitLeads } }] },
      select: { contactId: true },
      distinct: ["contactId"],
    });
    if (leads.length === 0) return [];
    return tx.contact.findMany({
      where: { tenantId, id: { in: leads.map((lead) => lead.contactId) } },
      select: { id: true, phoneEncrypted: true, phoneHash: true },
    });
  }

  /**
   * ‏העברת כרטיס אחד לכתיב האחיד; `false` כשהמספר כבר של כרטיס אחר. כשהוא
   * ‏טלפון נוסף של המבקר עצמו, הוא עולה לראשי — הקליטה מחפשת רק בראשי.
   *
   * ‏„של כרטיס אחר” — כטלפון ראשי **או נוסף**, כמו בכל נתיב שמשנה מספר:
   * ‏`findByAnyPhone` מחפש קודם בראשי, ולכן העברה על מספר נוסף של אחר
   * ‏הייתה מנתבת אליו שיחות ולידים של בעל המספר (ביקורת Codex, P1).
   * ‏העדכון מותנה בחתימה הישנה — כרטיס שנערך בינתיים אינו נדרס.
   */
  async moveToCanonical(
    tx: TenantTx,
    tenantId: string,
    visitor: { id: string; phoneHash: string },
    phone: string,
    phoneHash: string,
  ): Promise<boolean> {
    /* ‏אותה נעילת מספר שהקליטה נוטלת — כרטיס שנוצר במקביל אינו מתנגש */
    await lockContactPhone(tx, tenantId, phoneHash);
    const primary = await tx.contact.findUnique({
      where: { tenantId_phoneHash: { tenantId, phoneHash } },
      select: { id: true },
    });
    if (primary !== null) return false;
    const secondary = await tx.contactPhone.findUnique({
      where: { tenantId_phoneHash: { tenantId, phoneHash } },
      select: { id: true, contactId: true },
    });
    if (secondary !== null && secondary.contactId !== visitor.id) return false;
    const { count } = await tx.contact.updateMany({
      where: { id: visitor.id, tenantId, phoneHash: visitor.phoneHash },
      data: { phoneHash, phoneEncrypted: this.crypto.encrypt(phone) },
    });
    /* ‏המספר האחיד היה טלפון נוסף של המבקר עצמו — עכשיו הוא הראשי, והנוסף מיותר */
    if (count === 1 && secondary !== null) await tx.contactPhone.deleteMany({ where: { id: secondary.id, tenantId } });
    return count === 1;
  }
}
