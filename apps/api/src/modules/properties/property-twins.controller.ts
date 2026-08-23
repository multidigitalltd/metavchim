import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { IdSchema, TWIN_NOTE_MAX } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  PropertyTwinsService,
  type PropertyTwinDto,
} from "./property-twins.service";

/**
 * נכסים תאומים — קריאה תחת `properties.view`, כתיבה תחת
 * `properties.edit`.
 *
 * הקישור הוא הצהרה מקצועית על המאגר, ולא מידע אישי: מי שמורשה
 * לראות נכסים רואה אותו, ומי שמורשה לערוך נכס מגדיר אותו. יכולת
 * נפרדת הייתה מוסיפה מתג שאיש לא ידע מתי להדליק.
 *
 * הנתיבים בבקר משלהם ולא ב-`PropertiesController`: הם עומדים על
 * שירות משלהם, ומודול שנקרא לפי מה שהוא עושה קל יותר להסיר או
 * להחליף מאשר עוד שלושה נתיבים בקובץ של מאתיים שורות. `:id/twins`
 * אינו מתנגש ב-`:id` — נתיב בעל שני מקטעים אינו נבלע בנתיב של אחד.
 */

const AddTwinSchema = z
  .object({
    twinId: IdSchema,
    note: z.string().max(TWIN_NOTE_MAX).optional(),
  })
  .strict();

@Controller("properties")
export class PropertyTwinsController {
  constructor(private readonly twins: PropertyTwinsService) {}

  @Get(":id/twins")
  @RequireCapability("properties.view")
  async list(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<PropertyTwinDto[]> {
    return this.twins.list(id);
  }

  @Post(":id/twins")
  @RequireCapability("properties.edit")
  @HttpCode(200)
  async add(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(AddTwinSchema))
    body: z.infer<typeof AddTwinSchema>,
  ): Promise<PropertyTwinDto> {
    return this.twins.add(id, body.twinId, body.note);
  }

  @Delete(":id/twins/:twinId")
  @RequireCapability("properties.edit")
  @HttpCode(204)
  async remove(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Param("twinId", new ZodValidationPipe(IdSchema)) twinId: string,
  ): Promise<void> {
    await this.twins.remove(id, twinId);
  }
}
