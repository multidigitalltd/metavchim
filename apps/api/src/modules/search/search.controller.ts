import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SearchService, type SearchResults } from "./search.service";

/**
 * חיפוש גלובלי — פתוח לכל משתמש מאומת; כל קבוצת תוצאות נאכפת בנפרד
 * לפי יכולות ובעלות בתוך ה-Service (docs/04 §3).
 */
const QuerySchema = z
  .object({ q: z.string().trim().min(2).max(80) })
  .strict();

@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async run(
    @Query(new ZodValidationPipe(QuerySchema)) query: z.infer<typeof QuerySchema>,
  ): Promise<SearchResults> {
    return this.search.search(query.q);
  }
}
