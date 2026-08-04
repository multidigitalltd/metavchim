import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import {
  AgreementsService,
  type AgreementSummary,
  type PublicAgreementView,
} from "./agreements.service";

const CreateSchema = z
  .object({
    kind: z.enum(["brokerage", "exclusivity"]),
    contactId: IdSchema,
    propertyId: IdSchema.optional(),
    /** ערכים שהמתווך משלים ידנית — דמי תיווך, מועד תשלום, תקופת בלעדיות */
    values: z.record(z.string(), z.string().max(500)).optional(),
  })
  .strict();

/** ת"ז ישראלית — 9 ספרות; הבדיקה כאן מבנית בלבד. */
const SignSchema = z
  .object({
    signerName: z.string().min(2).max(120),
    signerIdNumber: z.string().regex(/^\d{5,9}$/u, 'מספר תעודת זהות אינו תקין'),
    confirmed: z.literal(true),
  })
  .strict();

@Controller()
export class AgreementsController {
  constructor(
    private readonly agreements: AgreementsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("agreements")
  @RequireCapability("offers.send")
  async create(
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<{ id: string; url: string; unfilled: string[]; reused: boolean }> {
    return this.prisma.withTenant((tx) => this.agreements.create(tx, body));
  }

  @Get("agreements/contact/:contactId")
  @RequireCapability("buyers.view_own")
  async listForContact(
    @Param("contactId", new ZodValidationPipe(IdSchema)) contactId: string,
  ): Promise<AgreementSummary[]> {
    return this.prisma.withTenant((tx) => this.agreements.listForContact(tx, contactId));
  }

  /** ---------- הלקוח החותם: ללא התחברות, הטוקן שבקישור הוא המפתח ---------- */

  @Public()
  @Get("public/agreements/:token")
  async publicView(@Param("token") token: string): Promise<PublicAgreementView> {
    return this.agreements.publicView(token);
  }

  @Public()
  @Post("public/agreements/:token/sign")
  @HttpCode(200)
  async sign(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(SignSchema)) body: z.infer<typeof SignSchema>,
    @Req() req: Request,
  ): Promise<{ signedAt: Date }> {
    return this.agreements.sign(token, {
      signerName: body.signerName,
      signerIdNumber: body.signerIdNumber,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Public()
  @Post("public/agreements/:token/decline")
  @HttpCode(200)
  async decline(@Param("token") token: string): Promise<{ ok: true }> {
    await this.agreements.decline(token);
    return { ok: true };
  }
}
