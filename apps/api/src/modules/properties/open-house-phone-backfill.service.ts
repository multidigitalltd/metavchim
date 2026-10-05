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
 * ‏אליו בלי לשנות את המקור) — ומעבירה את הכרטיס לכתיב האחיד. כשכבר יש
 * ‏כרטיס בכתיב האחיד, שני הכרטיסים נשארים כמו שהם: זו כפילות שהייתה
 * ‏קיימת לפני השינוי, ומסך הכפילויות ממזג אותה.
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
    for (const { id } of tenants) {
      moved += await this.prisma.withExplicitTenant(id, (tx) => this.backfillTenant(tx, id));
    }
    this.logger.log(`טלפוני מבקרי בית פתוח הומרו לכתיב האחיד: ${moved} כרטיסים`);
  }

  /** ‏כמה כרטיסים הועברו לכתיב האחיד במשרד אחד. */
  async backfillTenant(tx: TenantTx, tenantId: string): Promise<number> {
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
    if (leads.length === 0) return 0;
    const contacts = await tx.contact.findMany({
      where: { tenantId, id: { in: leads.map((lead) => lead.contactId) } },
      select: { id: true, phoneEncrypted: true, phoneHash: true },
    });
    let moved = 0;
    for (const contact of contacts) {
      const phone = normalizeValidPhone(this.crypto.decrypt(contact.phoneEncrypted));
      if (phone === undefined) continue;
      const phoneHash = this.crypto.phoneHash(phone);
      if (phoneHash === contact.phoneHash) continue;
      /* ‏אותה נעילת מספר שהקליטה נוטלת — כרטיס שנוצר במקביל אינו מתנגש */
      await lockContactPhone(tx, tenantId, phoneHash);
      const taken = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true },
      });
      if (taken !== null) continue;
      await tx.contact.update({
        where: { id: contact.id },
        data: { phoneHash, phoneEncrypted: this.crypto.encrypt(phone) },
      });
      moved += 1;
    }
    return moved;
  }
}
