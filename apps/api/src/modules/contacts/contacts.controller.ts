import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { IdSchema } from "@metavchim/shared";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";

/**
 * תיק לקוח מאוחד (docs/03 §contacts): אדם אחד = contact אחד, וקונה,
 * מוכר וליד מפנים אליו. ה-endpoint מציג את כל הישויות של אותו אדם —
 * ליד חוזר לא נראה כמו זר, וסוכן שפותח קונה רואה שהוא גם בעל נכס.
 *
 * כל תת-רשימה מסוננת בפילטר הבעלות של המודול שלה: סוכן view_own רואה
 * רק את הישויות שבבעלותו — הקישור לא עוקף הרשאות.
 */

export interface RelatedEntitiesDto {
  buyer: { id: string; maturity: string } | null;
  leads: { id: string; status: string; intent: string; createdAt: Date }[];
  ownedProperties: { id: string; title: string; status: string }[];
}

@Controller("contacts")
export class ContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id/related")
  async related(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<RelatedEntitiesDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");

      const [buyer, leads, properties] = await Promise.all([
        tx.buyer.findFirst({
          where: {
            tenantId,
            contactId: id,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
          select: { id: true, maturity: true },
        }),
        tx.lead.findMany({
          where: {
            tenantId,
            contactId: id,
            ...ownershipFilter("leads.view_all", "assignedToUserId"),
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, status: true, intent: true, createdAt: true },
        }),
        // נכסים גלויים לכל המשרד — אין פילטר בעלות במודול הנכסים
        tx.property.findMany({
          where: { tenantId, ownerContactId: id, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, marketingTitle: true, city: true, status: true },
        }),
      ]);

      return {
        buyer,
        leads,
        ownedProperties: properties.map((p) => ({
          id: p.id,
          title: p.marketingTitle ?? [p.city, "נכס"].filter(Boolean).join(" — "),
          status: p.status,
        })),
      };
    });
  }
}
