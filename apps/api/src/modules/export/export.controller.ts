import { Controller, Get, Header } from "@nestjs/common";
import {
  agorotToShekelString,
  DEAL_TYPE_LABELS_HE,
  FINANCING_LABELS_HE,
  MATURITY_LABELS_HE,
  PROPERTY_TYPE_LABELS_HE,
  toCsv,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { rowToFields } from "../properties/property.mapper";

/**
 * ייצוא נתונים (docs/08 — הנתונים שייכים למשרד): CSV עם כותרות עבריות
 * התואמות לייבוא (Round-trip). data.export בלבד (בעלים/אדמין), וכל
 * ייצוא נרשם ב-Audit — הוצאת PII היא פעולה רגישה.
 */

const EXPORT_CAP = 5000;

@Controller("export")
export class ExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  @Get("properties.csv")
  @RequireCapability("data.export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="properties.csv"')
  async properties(): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant(async (tx) => {
      const items = await tx.property.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: EXPORT_CAP,
      });
      await this.audit.record(tx, {
        action: "data.export_properties",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { count: items.length },
      });
      return items;
    });

    return toCsv(
      ["עיר", "שכונה", "רחוב", "חדרים", "שטח", "קומה", "מחיר", "סוג", "כותרת", "סטטוס"],
      rows.map((row) => {
        const f = rowToFields(row);
        return [
          f.city,
          f.neighborhood,
          f.street,
          f.rooms,
          f.areaSqm,
          f.floor,
          agorotToShekelString(f.priceAgorot),
          f.propertyType ? PROPERTY_TYPE_LABELS_HE[f.propertyType] : undefined,
          row.marketingTitle ?? undefined,
          row.status,
        ];
      }),
    );
  }

  @Get("buyers.csv")
  @RequireCapability("data.export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="buyers.csv"')
  async buyers(): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const { buyers, contacts } = await this.prisma.withTenant(async (tx) => {
      const buyerRows = await tx.buyer.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: EXPORT_CAP,
      });
      const contactRows = await tx.contact.findMany({
        where: { tenantId, id: { in: [...new Set(buyerRows.map((b) => b.contactId))] } },
        select: { id: true, nameEncrypted: true, phoneEncrypted: true },
      });
      await this.audit.record(tx, {
        action: "data.export_buyers",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { count: buyerRows.length },
      });
      return { buyers: buyerRows, contacts: contactRows };
    });

    const contactById = new Map(
      contacts.map((c) => [
        c.id,
        { name: this.crypto.decrypt(c.nameEncrypted), phone: this.crypto.decrypt(c.phoneEncrypted) },
      ]),
    );

    return toCsv(
      [
        "שם", "טלפון", "ערים", "סוג עסקה", "תקציב", "תקציב מינימלי",
        "חדרים מינימום", "חדרים מקסימום", "בשלות", "מימון", "הערות",
      ],
      buyers.map((b) => {
        const contact = contactById.get(b.contactId);
        return [
          contact?.name,
          contact?.phone,
          b.cities.join("; "),
          DEAL_TYPE_LABELS_HE[b.dealType as "sale" | "rent"] ?? b.dealType,
          agorotToShekelString(b.budgetMaxAgorot === null ? undefined : Number(b.budgetMaxAgorot)),
          agorotToShekelString(b.budgetMinAgorot === null ? undefined : Number(b.budgetMinAgorot)),
          b.roomsMin === null ? undefined : Number(b.roomsMin),
          b.roomsMax === null ? undefined : Number(b.roomsMax),
          MATURITY_LABELS_HE[b.maturity as keyof typeof MATURITY_LABELS_HE] ?? b.maturity,
          FINANCING_LABELS_HE[b.financing as keyof typeof FINANCING_LABELS_HE] ?? b.financing,
          b.agentNotes ?? undefined,
        ];
      }),
    );
  }
}
