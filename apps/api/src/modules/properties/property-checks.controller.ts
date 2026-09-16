import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  IdSchema,
  PropertyCheckKeySchema,
  PropertyCheckUpdateSchema,
  type PropertyCheckKey,
  type PropertyCheckUpdate,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { TaskDto } from "../tasks/tasks.service";
import { PropertyChecksService, type PropertyChecksDto } from "./property-checks.service";

/**
 * תיק הבדיקות של הנכס — קריאה עם `properties.view`, סימון והפיכה
 * למשימה עם `properties.edit`. המפתח נבדק מול הרשימה הסגורה בשער.
 */
const IdParam = new ZodValidationPipe(IdSchema);
const KeyParam = new ZodValidationPipe(PropertyCheckKeySchema);

@Controller("properties/:id/checks")
export class PropertyChecksController {
  constructor(private readonly checks: PropertyChecksService) {}

  @Get()
  @RequireCapability("properties.view")
  list(@Param("id", IdParam) propertyId: string): Promise<PropertyChecksDto> {
    return this.checks.list(propertyId);
  }

  @Patch(":key")
  @RequireCapability("properties.edit")
  update(
    @Param("id", IdParam) propertyId: string,
    @Param("key", KeyParam) key: PropertyCheckKey,
    @Body(new ZodValidationPipe(PropertyCheckUpdateSchema)) body: PropertyCheckUpdate,
  ): Promise<PropertyChecksDto> {
    return this.checks.update(propertyId, key, body);
  }

  @Post(":key/task")
  @RequireCapability("properties.edit")
  toTask(
    @Param("id", IdParam) propertyId: string,
    @Param("key", KeyParam) key: PropertyCheckKey,
  ): Promise<TaskDto> {
    return this.checks.toTask(propertyId, key);
  }
}
