import { BadRequestException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  AGREEMENT_KIND_LABELS,
  defaultAgreementTemplate,
  renderAgreement,
  type AgreementKind,
  type AgreementValues,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

/**
 * הסכמים לחתימה דיגיטלית.
 *
 * מודל הראיות (בעקבות comsign): מה נחתם, בידי מי, מתי, ומאיזה
 * IP/דפדפן. הנוסח נשמר כצילום ברגע השליחה — לא כהפניה לתבנית — כדי
 * ששינוי מאוחר בנוסח המשרד לא ישנה הסכם שכבר נחתם. גיבוב הנוסח
 * מאפשר להוכיח בדיעבד שהטקסט לא הוחלף.
 */

const TOKEN_TTL_DAYS = 30;

export interface AgreementSummary {
  id: string;
  kind: AgreementKind;
  kindLabel: string;
  status: string;
  contactId: string;
  propertyId?: string;
  signedAt?: Date;
  url: string;
  createdAt: Date;
}

export interface PublicAgreementView {
  kind: AgreementKind;
  kindLabel: string;
  officeName: string;
  body: string;
  status: string;
  signedAt?: Date;
  signerName?: string;
  bodyHash: string;
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
  ) {}

  private publicUrl(token: string): string {
    return `${loadEnv().WEB_ORIGIN}/sign/${token}`;
  }

  static hashBody(body: string): string {
    return createHash("sha256").update(body, "utf8").digest("hex");
  }

  /** הנוסח של המשרד, או ברירת המחדל כשלא הותאם. */
  private async templateFor(tx: TenantTx, kind: AgreementKind): Promise<string> {
    const row = await tx.agreementTemplate.findFirst({
      where: { tenantId: TenantContext.current().tenantId, kind },
    });
    return row?.body ?? defaultAgreementTemplate(kind);
  }

  /**
   * האם ללקוח יש הסכם חתום מסוג נתון. זו הבדיקה ששולטת בשער
   * ההצעות — הצעה לא נחשפת ללקוח שטרם חתם על הזמנה בכתב.
   */
  async hasSigned(tx: TenantTx, contactId: string, kind: AgreementKind): Promise<boolean> {
    const signed = await tx.agreement.findFirst({
      where: {
        tenantId: TenantContext.current().tenantId,
        contactId,
        kind,
        status: "signed",
      },
      select: { id: true },
    });
    return signed !== null;
  }

  /** הסכם ממתין קיים — כדי לא להציף את הלקוח בקישורים כפולים. */
  async pendingFor(
    tx: TenantTx,
    contactId: string,
    kind: AgreementKind,
  ): Promise<{ id: string; publicToken: string } | null> {
    return tx.agreement.findFirst({
      where: {
        tenantId: TenantContext.current().tenantId,
        contactId,
        kind,
        status: { in: ["pending", "viewed"] },
        tokenExpires: { gt: new Date() },
      },
      select: { id: true, publicToken: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * יצירת הסכם ושליחתו. מחזיר הסכם ממתין קיים אם יש — שליחה חוזרת
   * לא מייצרת שני מסמכים שונים לאותו לקוח.
   */
  async create(
    tx: TenantTx,
    input: { kind: AgreementKind; contactId: string; propertyId?: string; values?: Partial<AgreementValues> },
  ): Promise<{ id: string; url: string; unfilled: string[]; reused: boolean }> {
    const { tenantId, userId } = TenantContext.current();

    const existing = await this.pendingFor(tx, input.contactId, input.kind);
    if (existing) {
      return { id: existing.id, url: this.publicUrl(existing.publicToken), unfilled: [], reused: true };
    }

    const contact = await this.contacts.getById(tx, input.contactId);
    if (!contact) throw new NotFoundException("איש הקשר לא נמצא");

    const values = await this.collectValues(tx, contact, input);
    const template = await this.templateFor(tx, input.kind);
    const { text, unfilled } = renderAgreement(template, values);

    const token = randomBytes(32).toString("base64url");
    const row = await tx.agreement.create({
      data: {
        id: ulid(),
        tenantId,
        kind: input.kind,
        contactId: input.contactId,
        propertyId: input.propertyId ?? null,
        renderedBody: text,
        bodyHash: AgreementsService.hashBody(text),
        publicToken: token,
        tokenExpires: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
        createdBy: userId,
      },
    });

    await this.audit.record(tx, {
      action: "agreement.send",
      entityType: "agreement",
      entityId: row.id,
      metadata: { kind: input.kind, contactId: input.contactId },
    });

    return { id: row.id, url: this.publicUrl(token), unfilled, reused: false };
  }

  /** איסוף הערכים שממלאים את הנוסח — משרד, לקוח ונכס. */
  private async collectValues(
    tx: TenantTx,
    contact: { name: string; phone: string },
    input: { propertyId?: string; values?: Partial<AgreementValues> },
  ): Promise<Partial<AgreementValues>> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const asText = (key: string): string =>
      typeof settings[key] === "string" ? (settings[key] as string) : "";

    let propertyText = "";
    let priceText = "";
    if (input.propertyId !== undefined) {
      const property = await tx.property.findFirst({
        where: { id: input.propertyId, tenantId },
        select: { street: true, neighborhood: true, city: true, rooms: true, priceAgorot: true },
      });
      if (property) {
        propertyText = [
          property.rooms !== null ? `דירת ${property.rooms} חדרים` : null,
          [property.street, property.neighborhood, property.city].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(", ");
        if (property.priceAgorot !== null) {
          // priceAgorot הוא bigint בסכמה — המרה מפורשת לפני חישוב
          priceText = `${Math.round(Number(property.priceAgorot) / 100).toLocaleString("he-IL")} ₪`;
        }
      }
    }

    return {
      שם_המשרד: tenant?.name ?? "",
      מספר_רישיון_תיווך: asText("licenseNumber"),
      כתובת_המשרד: asText("officeAddress"),
      טלפון_המשרד: asText("officePhone"),
      שם_הלקוח: contact.name,
      טלפון_הלקוח: contact.phone,
      תיאור_הנכס: propertyText,
      מחיר_משוער: priceText,
      תאריך: new Date().toLocaleDateString("he-IL"),
      ...input.values,
    };
  }

  /** תצוגת ההסכם ללקוח החותם — בלי הקשר דייר. */
  async publicView(token: string): Promise<PublicAgreementView> {
    return this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { publicToken: token } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      if (row.tokenExpires < new Date()) throw new GoneException("תוקף הקישור פג — בקשו מהמתווך קישור חדש");

      if (row.status === "pending") {
        await tx.agreement.updateMany({
          where: { id: row.id, status: "pending" },
          data: { status: "viewed", viewedAt: new Date() },
        });
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: row.tenantId },
        select: { name: true },
      });

      return {
        kind: row.kind as AgreementKind,
        kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind],
        officeName: tenant?.name ?? "",
        body: row.renderedBody,
        status: row.status,
        signedAt: row.signedAt ?? undefined,
        signerName: row.signerName ?? undefined,
        bodyHash: row.bodyHash,
      };
    });
  }

  /**
   * חתימה. הראיות נלכדות ברגע החתימה, והעדכון מותנה בסטטוס הנוכחי
   * כדי ששתי לחיצות מקבילות לא ייצרו שתי חתימות שונות.
   */
  async sign(
    token: string,
    input: { signerName: string; signerIdNumber: string; ip?: string; userAgent?: string },
  ): Promise<{ signedAt: Date }> {
    return this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { publicToken: token } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      if (row.tokenExpires < new Date()) throw new GoneException("תוקף הקישור פג");
      if (row.status === "signed") throw new BadRequestException("ההסכם כבר נחתם");
      if (row.status === "declined") throw new BadRequestException("ההסכם נדחה");

      const signedAt = new Date();
      const updated = await tx.agreement.updateMany({
        where: { id: row.id, status: { in: ["pending", "viewed"] } },
        data: {
          status: "signed",
          signerName: input.signerName,
          signerIdNumber: input.signerIdNumber,
          signedAt,
          signedIp: input.ip ?? null,
          signedUserAgent: input.userAgent?.slice(0, 300) ?? null,
        },
      });
      if (updated.count === 0) throw new BadRequestException("ההסכם כבר טופל");

      return { signedAt };
    });
  }

  async decline(token: string): Promise<void> {
    await this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { publicToken: token } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      await tx.agreement.updateMany({
        where: { id: row.id, status: { in: ["pending", "viewed"] } },
        data: { status: "declined", declinedAt: new Date() },
      });
    });
  }

  async listForContact(tx: TenantTx, contactId: string): Promise<AgreementSummary[]> {
    const rows = await tx.agreement.findMany({
      where: { tenantId: TenantContext.current().tenantId, contactId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as AgreementKind,
      kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind],
      status: row.status,
      contactId: row.contactId,
      propertyId: row.propertyId ?? undefined,
      signedAt: row.signedAt ?? undefined,
      url: this.publicUrl(row.publicToken),
      createdAt: row.createdAt,
    }));
  }
}
