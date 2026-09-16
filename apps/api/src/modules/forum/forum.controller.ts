import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  ForumListingInputSchema,
  ForumListingListSchema,
  ForumModerationSchema,
  ForumRatingInputSchema,
  ForumReplyEditSchema,
  ForumReplyInputSchema,
  ForumReportInputSchema,
  ForumThreadEditSchema,
  ForumThreadInputSchema,
  ForumThreadListSchema,
  IdSchema,
  type ForumListingInput,
  type ForumListingList,
  type ForumModeration,
  type ForumRatingInput,
  type ForumReplyInput,
  type ForumReportInput,
  type ForumThreadEdit,
  type ForumThreadInput,
  type ForumThreadList,
} from "@metavchim/shared";
import { AnyAuthenticated, PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  ForumService,
  type ForumListingDto,
  type ForumPostDto,
  type ForumRatingDto,
  type ForumReportDto,
  type ForumSummaryDto,
  type ForumThreadDto,
  type ForumThreadSummaryDto,
} from "./forum.service";

/**
 * הפורום המקצועי (docs/16).
 *
 * ‎`AnyAuthenticated` ולא יכולת: הפורום פתוח לכל מי שמחובר, בכל
 * תפקיד ובכל מסלול — הוא קהילה, לא מודול של המשרד. מה שכן נאכף
 * הוא בעלות (בשירות, לפי חתם המחבר) וקצב (כאן): פרסום הוא הפעולה
 * היחידה במערכת שמגיעה לעיני כל המשרדים, ולכן יש לה תקרה לשעה.
 * הניהול — הסתרה, נעיצה, דיווחים — של הפלטפורמה בלבד.
 */
const IdParam = new ZodValidationPipe(IdSchema);
const TargetParam = new ZodValidationPipe(z.enum(["thread", "post", "listing", "rating"]));
const VoteTargetParam = new ZodValidationPipe(z.enum(["thread", "post"]));
const FollowSchema = z.object({ following: z.boolean() }).strict();

@Controller("forum")
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  @Get("summary")
  @AnyAuthenticated()
  summary(): Promise<ForumSummaryDto> {
    return this.forum.summary();
  }

  @Get("threads")
  @AnyAuthenticated()
  threads(
    @Query(new ZodValidationPipe(ForumThreadListSchema)) query: ForumThreadList,
  ): Promise<{ items: ForumThreadSummaryDto[]; nextCursor: string | null }> {
    return this.forum.listThreads(query);
  }

  @Post("threads")
  @AnyAuthenticated()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  createThread(
    @Body(new ZodValidationPipe(ForumThreadInputSchema)) body: ForumThreadInput,
  ): Promise<ForumThreadDto> {
    return this.forum.createThread(body);
  }

  @Get("threads/:id")
  @AnyAuthenticated()
  thread(@Param("id", IdParam) id: string): Promise<ForumThreadDto> {
    return this.forum.getThread(id);
  }

  @Patch("threads/:id")
  @AnyAuthenticated()
  editThread(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ForumThreadEditSchema)) body: ForumThreadEdit,
  ): Promise<ForumThreadDto> {
    return this.forum.editThread(id, body);
  }

  @Delete("threads/:id")
  @AnyAuthenticated()
  deleteThread(@Param("id", IdParam) id: string): Promise<void> {
    return this.forum.deleteThread(id);
  }

  @Post("threads/:id/replies")
  @AnyAuthenticated()
  @Throttle({ default: { ttl: 3_600_000, limit: 40 } })
  reply(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ForumReplyInputSchema)) body: ForumReplyInput,
  ): Promise<ForumPostDto> {
    return this.forum.reply(id, body);
  }

  @Patch("posts/:id")
  @AnyAuthenticated()
  editPost(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ForumReplyEditSchema)) body: { body: string },
  ): Promise<ForumPostDto> {
    return this.forum.editPost(id, body.body);
  }

  @Delete("posts/:id")
  @AnyAuthenticated()
  deletePost(@Param("id", IdParam) id: string): Promise<void> {
    return this.forum.deletePost(id);
  }

  @Post("threads/:id/accept/:postId")
  @AnyAuthenticated()
  @HttpCode(200)
  accept(
    @Param("id", IdParam) id: string,
    @Param("postId", IdParam) postId: string,
  ): Promise<ForumThreadDto> {
    return this.forum.accept(id, postId);
  }

  @Post("votes/:target/:id")
  @AnyAuthenticated()
  @HttpCode(200)
  vote(
    @Param("target", VoteTargetParam) target: "thread" | "post",
    @Param("id", IdParam) id: string,
  ): Promise<{ score: number; voted: boolean }> {
    return this.forum.vote(target, id);
  }

  @Post("threads/:id/follow")
  @AnyAuthenticated()
  @HttpCode(200)
  follow(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(FollowSchema)) body: z.infer<typeof FollowSchema>,
  ): Promise<{ following: boolean }> {
    return this.forum.follow(id, body.following);
  }

  /* ---------- המדריך: כלים ובעלי מקצוע ---------- */

  @Get("listings")
  @AnyAuthenticated()
  listings(
    @Query(new ZodValidationPipe(ForumListingListSchema)) query: ForumListingList,
  ): Promise<{ items: ForumListingDto[] }> {
    return this.forum.listListings(query);
  }

  @Post("listings")
  @AnyAuthenticated()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  createListing(
    @Body(new ZodValidationPipe(ForumListingInputSchema)) body: ForumListingInput,
  ): Promise<{ id: string }> {
    return this.forum.createListing(body);
  }

  @Get("listings/:id/ratings")
  @AnyAuthenticated()
  ratings(@Param("id", IdParam) id: string): Promise<{ items: ForumRatingDto[] }> {
    return this.forum.listRatings(id);
  }

  @Post("listings/:id/ratings")
  @AnyAuthenticated()
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 30 } })
  rate(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ForumRatingInputSchema)) body: ForumRatingInput,
  ): Promise<{ ratingAverage: number | null; ratingCount: number }> {
    return this.forum.rate(id, body);
  }

  /* ---------- דיווח וניהול ---------- */

  @Post("reports/:target/:id")
  @AnyAuthenticated()
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  report(
    @Param("target", TargetParam) target: "thread" | "post" | "listing" | "rating",
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ForumReportInputSchema)) body: ForumReportInput,
  ): Promise<{ reported: true }> {
    return this.forum.report(target, id, body);
  }

  @Get("reports")
  @PlatformAdmin()
  @UseGuards(PlatformAdminGuard)
  reports(): Promise<{ items: ForumReportDto[] }> {
    return this.forum.openReports();
  }

  @Post("reports/:id/resolve")
  @PlatformAdmin()
  @UseGuards(PlatformAdminGuard)
  @HttpCode(204)
  resolveReport(@Param("id", IdParam) id: string): Promise<void> {
    return this.forum.resolveReport(id);
  }

  @Patch("moderate/:target/:id")
  @PlatformAdmin()
  @UseGuards(PlatformAdminGuard)
  @HttpCode(204)
  moderate(
    @Param("target", TargetParam) target: "thread" | "post" | "listing" | "rating",
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ForumModerationSchema)) body: ForumModeration,
  ): Promise<void> {
    return this.forum.moderate(target, id, body);
  }
}
