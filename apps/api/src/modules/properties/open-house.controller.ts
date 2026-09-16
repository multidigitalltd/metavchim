import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  IdSchema,
  OpenHouseCreateSchema,
  OpenHouseRegisterSchema,
  OpenHouseStatusUpdateSchema,
  OpenHouseVisitorUpdateSchema,
  OpenHouseWalkInSchema,
  type OpenHouseCreate,
  type OpenHouseRegister,
  type OpenHouseStatusUpdate,
  type OpenHouseVisitorUpdate,
  type OpenHouseWalkIn,
} from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { OpenHouseService, type OpenHousesDto, type PublicOpenHouseDto } from "./open-house.service";

/**
 * ‏בית פתוח — ניהול מהכרטיס (`properties.view` / `properties.edit`),
 * ‏והרשמה מהדף הציבורי דרך טוקן דף הנחיתה (אותו טוקן, אותה מגבלת
 * ‏קצב ואותו honeypot כמו טופס הפנייה).
 */
const IdParam = new ZodValidationPipe(IdSchema);
const TokenParam = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{43}$/u));

@Controller()
export class OpenHouseController {
  constructor(private readonly openHouse: OpenHouseService) {}

  @Get("properties/:id/open-houses")
  @RequireCapability("properties.view")
  list(@Param("id", IdParam) propertyId: string): Promise<OpenHousesDto> {
    return this.openHouse.list(propertyId);
  }

  @Post("properties/:id/open-houses")
  @RequireCapability("properties.edit")
  create(
    @Param("id", IdParam) propertyId: string,
    @Body(new ZodValidationPipe(OpenHouseCreateSchema)) body: OpenHouseCreate,
  ): Promise<OpenHousesDto> {
    return this.openHouse.create(propertyId, body);
  }

  @Patch("properties/:id/open-houses/:ohId")
  @RequireCapability("properties.edit")
  setStatus(
    @Param("id", IdParam) propertyId: string,
    @Param("ohId", IdParam) openHouseId: string,
    @Body(new ZodValidationPipe(OpenHouseStatusUpdateSchema)) body: OpenHouseStatusUpdate,
  ): Promise<OpenHousesDto> {
    return this.openHouse.setStatus(propertyId, openHouseId, body.status);
  }

  @Post("properties/:id/open-houses/:ohId/visitors")
  @RequireCapability("properties.edit")
  walkIn(
    @Param("id", IdParam) propertyId: string,
    @Param("ohId", IdParam) openHouseId: string,
    @Body(new ZodValidationPipe(OpenHouseWalkInSchema)) body: OpenHouseWalkIn,
  ): Promise<OpenHousesDto> {
    return this.openHouse.walkIn(propertyId, openHouseId, body);
  }

  @Patch("properties/:id/open-houses/:ohId/visitors/:appointmentId")
  @RequireCapability("properties.edit")
  arrived(
    @Param("id", IdParam) propertyId: string,
    @Param("ohId", IdParam) openHouseId: string,
    @Param("appointmentId", IdParam) appointmentId: string,
    @Body(new ZodValidationPipe(OpenHouseVisitorUpdateSchema)) body: OpenHouseVisitorUpdate,
  ): Promise<OpenHousesDto> {
    return this.openHouse.setArrived(propertyId, openHouseId, appointmentId, body.arrived);
  }

  @Public()
  @Get("public/landing/:token/open-house")
  publicView(@Param("token", TokenParam) token: string): Promise<PublicOpenHouseDto> {
    return this.openHouse.publicView(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("public/landing/:token/open-house/:ohId/register")
  @HttpCode(200)
  async register(
    @Param("token", TokenParam) token: string,
    @Param("ohId", IdParam) openHouseId: string,
    @Body(new ZodValidationPipe(OpenHouseRegisterSchema)) body: OpenHouseRegister,
  ): Promise<{ ok: true }> {
    if (body.website?.trim()) return { ok: true }; // בוט — נבלע בשקט
    await this.openHouse.register(token, openHouseId, { name: body.name, phone: body.phone, slotAt: body.slotAt });
    return { ok: true };
  }
}
