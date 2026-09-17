import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  FORUM_ANON_LABEL,
  FORUM_PAGE_SIZE,
  forumPseudonyms,
  forumSearchTsquery,
  parseForumPrefs,
  ratingAverage,
  type ForumKind,
  type ForumListingInput,
  type ForumListingList,
  type ForumModeration,
  type ForumPrefs,
  type ForumRatingInput,
  type ForumReplyInput,
  type ForumReportInput,
  type ForumThreadEdit,
  type ForumThreadInput,
  type ForumThreadList,
  type ForumTopic,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { ForumNotifyService } from "./forum-notify.service";

/**
 * הפורום המקצועי (docs/16) — השירות.
 *
 * ## למה `this.prisma` ישירות, ולא `withTenant`
 *
 * הטבלאות של הפורום הן של הפלטפורמה, לא של דייר: אין עליהן RLS
 * ואין בהן `tenant_id` (ראו כותרת המיגרציה `20260915090000_forum`).
 * ‎`withTenant` היה מגדיר הקשר דייר שאיש אינו קורא, ומסתיר את
 * העובדה שכל שאילתה כאן היא חוצת-משרדים בכוונה. מה שכן נאכף —
 * במקום RLS — הוא **בעלות**: כל כתיבה על שורה קיימת עוברת
 * ‎`assertOwner`, שמשווה את חתם המחבר לחתם של המשתמש הנוכחי.
 *
 * ## הכלל על זהות
 *
 * הזהות של מחבר נכנסת ל-DTO במקום **אחד** — `authorOf` — ורק משם.
 * שורה אנונימית אינה נושאת מזהה, ולכן אין מה להדליף; אבל שורה
 * מזוהה נושאת שם ומשרד, וזה מה שהפונקציה הזו מחליטה להציג. פיזור
 * ההחלטה הזו על פני עשר שאילתות הוא בדיוק איך תגובה אנונימית
 * הייתה יום אחד מקבלת שם.
 *
 * ## ומה כן נשמר על מחבר אנונימי
 *
 * ‎`author_ref` — `tenantId:userId` מוצפן במפתח הנתונים (AES-GCM, כמו
 * טלפון בכרטיס לקוח). הוא נקרא במקום **אחד** — `ForumNotifyService`,
 * כדי לשלוח לשואל את התשובות — ולעולם לא נכנס ל-DTO. הוא מחליף
 * את שורת המעקב: שורת `forum_follows` שנוצרת באותה שנייה עם שרשור
 * אנונימי הייתה מצביעה על המחבר לכל מי שרואה את הטבלה (ביקורת
 * Codex). מאותה סיבה יומן הביקורת של פעולה אנונימית אינו נושא את
 * מזהה השרשור: „המשתמש הזה פעל בפורום” — כן; „על השרשור הזה” — לא.
 */

const DELETED_USER = "משתמש שנמחק";

export interface ForumAuthorDto {
  /** השם המוצג, או הכינוי האנונימי */
  label: string;
  /** שם המשרד — רק למחבר מזוהה */
  office: string | null;
  anonymous: boolean;
}

export interface ForumThreadSummaryDto {
  id: string;
  kind: ForumKind;
  topic: ForumTopic;
  title: string;
  snippet: string;
  author: ForumAuthorDto;
  replyCount: number;
  score: number;
  answered: boolean;
  pinned: boolean;
  locked: boolean;
  /** שלי — כולל האנונימיים שלי, שרק אני יודע/ת שהם שלי */
  mine: boolean;
  following: boolean;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface ForumPostDto {
  id: string;
  body: string;
  author: ForumAuthorDto;
  score: number;
  voted: boolean;
  mine: boolean;
  accepted: boolean;
  hidden: boolean;
  createdAt: Date;
  editedAt: Date | null;
}

export interface ForumThreadDto extends ForumThreadSummaryDto {
  body: string;
  voted: boolean;
  hidden: boolean;
  canModerate: boolean;
  editedAt: Date | null;
  posts: ForumPostDto[];
}

export interface ForumListingDto {
  id: string;
  kind: "tool" | "pro";
  category: string;
  name: string;
  description: string;
  url: string | null;
  contact: string | null;
  area: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  myRating: { score: number; comment: string | null } | null;
  mine: boolean;
  createdAt: Date;
}

export interface ForumRatingDto {
  id: string;
  score: number;
  comment: string | null;
  author: ForumAuthorDto;
  createdAt: Date;
}

export interface ForumReportDto {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  note: string | null;
  /** לאן לקפוץ — שרשור, או השרשור של התגובה */
  threadId: string | null;
  excerpt: string;
  createdAt: Date;
}

export interface ForumSummaryDto {
  threads: number;
  answered: number;
  repliesThisWeek: number;
  following: number;
  prefs: ForumPrefs;
}

const threadInclude = {
  author: { select: { name: true } },
  authorTenant: { select: { name: true } },
} satisfies Prisma.ForumThreadInclude;

type ThreadRow = Prisma.ForumThreadGetPayload<{ include: typeof threadInclude }>;
type PostRow = Prisma.ForumPostGetPayload<{ include: typeof threadInclude }>;

function snippet(body: string): string {
  const flat = body.replace(/\s+/gu, " ").trim();
  return flat.length <= 160 ? flat : `${flat.slice(0, 160).trimEnd()}…`;
}

@Injectable()
export class ForumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly notify: ForumNotifyService,
  ) {}

  /* ==================== זהות ==================== */

  private me(): { userId: string; tenantId: string; key: string } {
    const { userId, tenantId } = TenantContext.current();
    return { userId, tenantId, key: this.crypto.forumAuthorKey(userId) };
  }

  /** מנהל הפלטפורמה — אותה רשימה כמו `PlatformAdminGuard`, לתצוגה ולסינון. */
  private async isPlatformAdmin(): Promise<boolean> {
    const admins = loadEnv().PLATFORM_ADMIN_EMAILS;
    if (admins.length === 0) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: TenantContext.current().userId },
      select: { email: true },
    });
    return user !== null && admins.includes(user.email.toLowerCase());
  }

  /**
   * המחבר כפי שהוא מוצג — **המקום היחיד** שמחליט מה נחשף.
   *
   * אנונימי: הכינוי מהמפה (או „מתווך/ת אנונימי/ת” מחוץ לשרשור), בלי
   * משרד. מזוהה: השם והמשרד; מחבר שנמחק — „משתמש שנמחק”.
   */
  private static authorOf(
    row: { anonymous: boolean; authorKey: string; author: { name: string } | null; authorTenant: { name: string } | null },
    pseudonyms: ReadonlyMap<string, string> = new Map(),
  ): ForumAuthorDto {
    if (row.anonymous) {
      return { label: pseudonyms.get(row.authorKey) ?? FORUM_ANON_LABEL, office: null, anonymous: true };
    }
    return {
      label: row.author?.name ?? DELETED_USER,
      office: row.authorTenant?.name ?? null,
      anonymous: false,
    };
  }

  private static summary(row: ThreadRow, key: string, following: boolean): ForumThreadSummaryDto {
    return {
      id: row.id,
      kind: row.kind as ForumKind,
      topic: row.topic as ForumTopic,
      title: row.title,
      snippet: snippet(row.body),
      author: ForumService.authorOf(row),
      replyCount: row.replyCount,
      score: row.score,
      answered: row.acceptedPostId !== null,
      pinned: row.pinned,
      locked: row.locked,
      mine: row.authorKey === key,
      following,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
    };
  }

  /* ==================== שרשורים ==================== */

  async summary(): Promise<ForumSummaryDto> {
    const { userId, key } = this.me();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [threads, answered, repliesThisWeek, following, user] = await Promise.all([
      this.prisma.forumThread.count({ where: { hiddenAt: null } }),
      this.prisma.forumThread.count({ where: { hiddenAt: null, acceptedPostId: { not: null } } }),
      this.prisma.forumPost.count({ where: { hiddenAt: null, createdAt: { gte: weekAgo } } }),
      this.prisma.forumThread.count({ where: { hiddenAt: null, ...ForumService.followingWhere(userId, key) } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }),
    ]);
    return { threads, answered, repliesThisWeek, following, prefs: parseForumPrefs(user?.preferences) };
  }

  /**
   * רשימת השרשורים — עמוד אחד, עם סמן להמשך.
   *
   * חיפוש טקסט עובר דרך אינדקסי ה-GIN (אותם ביטויים בדיוק כמו
   * במיגרציה) — בכותרת ובגוף השרשור **ובתגובות**, כי התשובה לשאלה
   * יושבת בתגובה — עם דירוג לפי `ts_rank`, ובנוסף התאמה חופשית
   * בכותרת: עברית אינה נגזרת, ו„בלעדיות” לא תמצא „הבלעדיות” בלי זה.
   * הסינונים (נושא, סוג, שלי, במעקב…) נכנסים **לתוך** השאילתה, לפני
   * ה-LIMIT: אחרת שישים התוצאות הראשונות היו נחתכות לפני הסינון,
   * וחיפוש „בלעדיות” בנושא צר היה מחזיר ריק כשיש תוצאות (ביקורת
   * Codex). עם חיפוש אין סמן: תוצאות מדורגות אינן רצף שאפשר להמשיך
   * ממנו.
   */
  async listThreads(
    query: ForumThreadList,
  ): Promise<{ items: ForumThreadSummaryDto[]; nextCursor: string | null }> {
    const { userId, key } = this.me();
    const where: Prisma.ForumThreadWhereInput = { hiddenAt: null };
    if (query.topic !== undefined) where.topic = query.topic;
    if (query.kind !== undefined) where.kind = query.kind;
    if (query.anonymous !== undefined) where.anonymous = true;
    if (query.mine !== undefined) where.authorKey = key;
    if (query.unanswered !== undefined) {
      where.kind = "question";
      where.acceptedPostId = null;
    }
    if (query.following !== undefined) Object.assign(where, ForumService.followingWhere(userId, key));

    const q = query.q?.trim() ?? "";
    let rankedIds: string[] | null = null;
    if (q !== "") {
      /*
       * ‎`forumSearchTsquery` מפרק את הקלט לאותיות וספרות בלבד ובונה
       * ממנו ביטוי עם תחיליות עבריות והתאמת תחילית — ולכן
       * ‎`to_tsquery` ולא `websearch_to_tsquery`, שאינה תומכת ב-`:*`.
       * הטקסט הגולמי נשאר רק ב-ILIKE, כפרמטר. כל התנאים פרמטרים —
       * ‎`Prisma.sql` מרכיב, המסד מקבל placeholders.
       */
      const tsquery = forumSearchTsquery(q) ?? "";
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT t.id FROM forum_threads t
         WHERE ${ForumService.searchFilters(query, userId, key)}
           AND ((${tsquery} <> ''
                 AND (to_tsvector('simple', t.title || ' ' || t.body) @@ to_tsquery('simple', ${tsquery})
                      OR EXISTS (SELECT 1 FROM forum_posts p
                                  WHERE p.thread_id = t.id AND p.hidden_at IS NULL
                                    AND to_tsvector('simple', p.body) @@ to_tsquery('simple', ${tsquery}))))
                OR t.title ILIKE ${`%${q}%`})
         ORDER BY CASE WHEN ${tsquery} <> ''
                       THEN ts_rank(to_tsvector('simple', t.title || ' ' || t.body), to_tsquery('simple', ${tsquery}))
                          + COALESCE((SELECT MAX(ts_rank(to_tsvector('simple', p.body), to_tsquery('simple', ${tsquery})))
                                        FROM forum_posts p WHERE p.thread_id = t.id AND p.hidden_at IS NULL), 0)
                       ELSE 0 END DESC,
                  t.last_activity_at DESC
         LIMIT 60`;
      rankedIds = rows.map((row) => row.id);
      if (rankedIds.length === 0) return { items: [], nextCursor: null };
      where.id = { in: rankedIds };
    }

    const orderBy: Prisma.ForumThreadOrderByWithRelationInput[] =
      query.sort === "newest"
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : query.sort === "top"
          ? [{ score: "desc" }, { replyCount: "desc" }, { id: "desc" }]
          : [{ pinned: "desc" }, { lastActivityAt: "desc" }, { id: "desc" }];

    const rows = await this.prisma.forumThread.findMany({
      where,
      orderBy,
      include: threadInclude,
      take: FORUM_PAGE_SIZE + 1,
      ...(query.cursor !== undefined && rankedIds === null
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
    });
    const page = rows.slice(0, FORUM_PAGE_SIZE);
    if (rankedIds !== null) {
      const rank = new Map(rankedIds.map((id, i) => [id, i]));
      page.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
    const followed = await this.followedAmong(page.map((row) => row.id), userId, key);
    return {
      items: page.map((row) => ForumService.summary(row, key, followed.has(row.id) || ForumService.ownAnonymousNotify(row, key))),
      nextCursor:
        rows.length > FORUM_PAGE_SIZE && rankedIds === null ? page[page.length - 1]!.id : null,
    };
  }

  async getThread(id: string): Promise<ForumThreadDto> {
    const { userId, key } = this.me();
    const admin = await this.isPlatformAdmin();
    const row = await this.prisma.forumThread.findUnique({ where: { id }, include: threadInclude });
    // מוסתר נראה רק לניהול — לכל השאר הוא פשוט איננו (404, לא 403)
    if (row === null || (row.hiddenAt !== null && !admin)) throw new NotFoundException("השרשור לא נמצא");

    const [posts, votes, follow] = await Promise.all([
      this.prisma.forumPost.findMany({
        where: { threadId: id, ...(admin ? {} : { hiddenAt: null }) },
        orderBy: { createdAt: "asc" },
        include: threadInclude,
      }),
      this.prisma.forumVote.findMany({ where: { userId }, select: { targetType: true, targetId: true } }),
      this.followedAmong([id], userId, key),
    ]);
    const voted = new Set(votes.map((vote) => `${vote.targetType}:${vote.targetId}`));
    const pseudonyms = forumPseudonyms(row.authorKey, row.anonymous, posts);
    const toPost = (post: PostRow): ForumPostDto => ({
      id: post.id,
      body: post.body,
      author: ForumService.authorOf(post, pseudonyms),
      score: post.score,
      voted: voted.has(`post:${post.id}`),
      mine: post.authorKey === key,
      accepted: row.acceptedPostId === post.id,
      hidden: post.hiddenAt !== null,
      createdAt: post.createdAt,
      editedAt: post.editedAt,
    });
    // התשובה המקובלת ראשונה, השאר כרונולוגי
    const ordered = [
      ...posts.filter((post) => post.id === row.acceptedPostId),
      ...posts.filter((post) => post.id !== row.acceptedPostId),
    ];
    return {
      ...ForumService.summary(row, key, follow.has(id) || ForumService.ownAnonymousNotify(row, key)),
      body: row.body,
      voted: voted.has(`thread:${id}`),
      hidden: row.hiddenAt !== null,
      canModerate: admin,
      editedAt: row.editedAt,
      posts: ordered.map(toPost),
    };
  }

  async createThread(input: ForumThreadInput): Promise<ForumThreadDto> {
    const { userId, tenantId, key } = this.me();
    const id = ulid();
    await this.prisma.$transaction(async (tx) => {
      await tx.forumThread.create({
        data: {
          id,
          kind: input.kind,
          topic: input.topic,
          title: input.title,
          body: input.body,
          anonymous: input.anonymous,
          authorKey: key,
          // אנונימי = בלי זהות בשורה, נקודה. לא „מוסתר במסך”.
          authorUserId: input.anonymous ? null : userId,
          authorTenantId: input.anonymous ? null : tenantId,
          // הדרך היחידה חזרה לשואל אנונימי — מוצפנת, ורק להתראות
          authorRef: input.anonymous ? this.authorRef(tenantId, userId) : null,
        },
      });
      // מי ששאל בשמו עוקב אחרי התשובות; לאנונימי `author_notify` הוא המעקב
      if (!input.anonymous) await tx.forumFollow.create({ data: { id: ulid(), threadId: id, userId } });
    });
    await this.recordAudit("forum.thread_create", "forum_thread", input.anonymous ? null : id, { anonymous: input.anonymous });
    const thread = await this.getThread(id);
    this.notify.newThread(thread, userId);
    return thread;
  }

  async editThread(id: string, input: ForumThreadEdit): Promise<ForumThreadDto> {
    const { key } = this.me();
    const row = await this.prisma.forumThread.findUnique({ where: { id }, select: { authorKey: true, locked: true, hiddenAt: true } });
    ForumService.assertOwner(row, key);
    if (row.locked) throw new ConflictException("השרשור נעול לעריכה");
    await this.prisma.forumThread.update({
      where: { id },
      data: {
        ...(input.topic === undefined ? {} : { topic: input.topic }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        editedAt: new Date(),
      },
    });
    return this.getThread(id);
  }

  /**
   * מחיקת שרשור — רק בלי תגובות. שרשור שכבר ענו עליו הוא ידע של
   * הקהילה; מי שרוצה להסיר אותו מדווח, וניהול הפלטפורמה מכריע.
   */
  async deleteThread(id: string): Promise<void> {
    const { key } = this.me();
    const row = await this.prisma.forumThread.findUnique({
      where: { id },
      select: { authorKey: true, anonymous: true, replyCount: true, hiddenAt: true },
    });
    ForumService.assertOwner(row, key);
    if (row.replyCount > 0) {
      throw new ConflictException("כבר יש תגובות — אפשר לבקש הסרה דרך „דיווח”");
    }
    await this.prisma.forumThread.delete({ where: { id } });
    await this.recordAudit("forum.thread_delete", "forum_thread", row.anonymous ? null : id, { anonymous: row.anonymous });
  }

  /* ==================== תגובות ==================== */

  async reply(threadId: string, input: ForumReplyInput): Promise<ForumPostDto> {
    const { userId, tenantId, key } = this.me();
    const thread = await this.prisma.forumThread.findUnique({
      where: { id: threadId },
      select: { id: true, title: true, locked: true, hiddenAt: true, authorKey: true, anonymous: true },
    });
    if (thread === null || thread.hiddenAt !== null) throw new NotFoundException("השרשור לא נמצא");
    if (thread.locked) throw new ConflictException("השרשור נעול — אי אפשר להוסיף תגובות");

    const id = ulid();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.forumPost.create({
        data: {
          id,
          threadId,
          body: input.body,
          anonymous: input.anonymous,
          authorKey: key,
          authorUserId: input.anonymous ? null : userId,
          authorTenantId: input.anonymous ? null : tenantId,
          authorRef: input.anonymous ? this.authorRef(tenantId, userId) : null,
        },
      });
      await tx.forumThread.update({
        where: { id: threadId },
        data: { replyCount: { increment: 1 }, lastActivityAt: now },
      });
      // מי שענה בשמו רוצה לדעת מה ענו לו — מעקב אוטומטי, שאפשר להסיר;
      // מי שענה בעילום שם נשמע דרך `author_notify`, בלי שורה שמצביעה עליו
      if (!input.anonymous) {
        await tx.forumFollow.upsert({
          where: { threadId_userId: { threadId, userId } },
          create: { id: ulid(), threadId, userId },
          update: {},
        });
      }
    });
    await this.recordAudit(
      "forum.reply",
      "forum_post",
      input.anonymous ? null : id,
      input.anonymous ? { anonymous: true } : { threadId, anonymous: false },
    );

    const full = await this.getThread(threadId);
    const post = full.posts.find((candidate) => candidate.id === id);
    if (post === undefined) throw new NotFoundException("התגובה לא נמצאה");
    this.notify.newReply(full, post, userId);
    return post;
  }

  async editPost(id: string, body: string): Promise<ForumPostDto> {
    const { key } = this.me();
    const row = await this.prisma.forumPost.findUnique({ where: { id }, select: { authorKey: true, threadId: true, hiddenAt: true } });
    ForumService.assertOwner(row, key);
    await this.prisma.forumPost.update({ where: { id }, data: { body, editedAt: new Date() } });
    const thread = await this.getThread(row.threadId);
    return thread.posts.find((post) => post.id === id)!;
  }

  async deletePost(id: string): Promise<void> {
    const { key } = this.me();
    const row = await this.prisma.forumPost.findUnique({
      where: { id },
      select: { authorKey: true, anonymous: true, threadId: true, hiddenAt: true },
    });
    ForumService.assertOwner(row, key);
    await this.prisma.$transaction(async (tx) => {
      await tx.forumPost.delete({ where: { id } });
      await tx.forumThread.updateMany({
        where: { id: row.threadId, acceptedPostId: id },
        data: { acceptedPostId: null },
      });
      await tx.forumThread.update({ where: { id: row.threadId }, data: { replyCount: { decrement: 1 } } });
    });
    await this.recordAudit(
      "forum.reply_delete",
      "forum_post",
      row.anonymous ? null : id,
      row.anonymous ? { anonymous: true } : { threadId: row.threadId, anonymous: false },
    );
  }

  /** „זו התשובה” — רק השואל/ת. פעם שנייה על אותה תגובה = ביטול הסימון. */
  async accept(threadId: string, postId: string): Promise<ForumThreadDto> {
    const { key } = this.me();
    const thread = await this.prisma.forumThread.findUnique({
      where: { id: threadId },
      select: { authorKey: true, acceptedPostId: true, title: true, hiddenAt: true },
    });
    ForumService.assertOwner(thread, key);
    const post = await this.prisma.forumPost.findFirst({
      where: { id: postId, threadId, hiddenAt: null },
      select: { id: true, authorUserId: true, authorRef: true, authorNotify: true, authorKey: true },
    });
    if (post === null) throw new NotFoundException("התגובה לא נמצאה");
    const clearing = thread.acceptedPostId === postId;
    await this.prisma.forumThread.update({
      where: { id: threadId },
      data: { acceptedPostId: clearing ? null : postId },
    });
    // מי שענה מקבל את הרגע הקטן הזה — גם בעילום שם, דרך ההפניה המוצפנת
    if (!clearing && post.authorKey !== key) {
      this.notify.accepted(threadId, thread.title, postId, post);
    }
    return this.getThread(threadId);
  }

  /* ==================== „מועיל” ==================== */

  async vote(targetType: "thread" | "post", targetId: string): Promise<{ score: number; voted: boolean }> {
    const { userId } = this.me();
    // פריט שאינו קיים או מוסתר — 404, לא שגיאת מסד
    const exists =
      targetType === "thread"
        ? await this.prisma.forumThread.count({ where: { id: targetId, hiddenAt: null } })
        : await this.prisma.forumPost.count({ where: { id: targetId, hiddenAt: null } });
    if (exists === 0) throw new NotFoundException("לא נמצא");
    const existing = await this.prisma.forumVote.findUnique({
      where: { targetType_targetId_userId: { targetType, targetId, userId } },
    });
    const delta = existing === null ? 1 : -1;
    const score = await this.prisma.$transaction(async (tx) => {
      if (existing === null) {
        await tx.forumVote.create({ data: { id: ulid(), targetType, targetId, userId } });
      } else {
        await tx.forumVote.delete({ where: { id: existing.id } });
      }
      const updated =
        targetType === "thread"
          ? await tx.forumThread.update({ where: { id: targetId }, data: { score: { increment: delta } }, select: { score: true } })
          : await tx.forumPost.update({ where: { id: targetId }, data: { score: { increment: delta } }, select: { score: true } });
      return updated.score;
    });
    return { score, voted: existing === null };
  }

  /* ==================== מעקב ==================== */

  /**
   * מעקב — שורת מעקב למי שנוכח בשרשור בשמו; למי שכתב בו בעילום שם
   * זה `author_notify` על השורות שלו, ולא שורה שמצביעה עליו. „לא
   * לעקוב” מכבה את שניהם, כדי שהתשובה תהיה אחת: לא יגיע עוד דבר.
   */
  async follow(threadId: string, following: boolean): Promise<{ following: boolean }> {
    const { userId, key } = this.me();
    const thread = await this.prisma.forumThread.findFirst({
      where: { id: threadId, hiddenAt: null },
      select: { anonymous: true, authorKey: true },
    });
    if (thread === null) throw new NotFoundException("השרשור לא נמצא");
    const ownAnonymousThread = thread.anonymous && thread.authorKey === key;
    await this.prisma.$transaction(async (tx) => {
      if (ownAnonymousThread) {
        await tx.forumThread.update({ where: { id: threadId }, data: { authorNotify: following } });
      }
      const anonymousPosts = await tx.forumPost.updateMany({
        where: { threadId, anonymous: true, authorKey: key },
        data: { authorNotify: following },
      });
      if (!following) {
        await tx.forumFollow.deleteMany({ where: { threadId, userId } });
      } else if (!ownAnonymousThread && anonymousPosts.count === 0) {
        await tx.forumFollow.upsert({
          where: { threadId_userId: { threadId, userId } },
          create: { id: ulid(), threadId, userId },
          update: {},
        });
      }
    });
    return { following };
  }

  /** השרשור לפי מזהה — לוואטסאפ, שהכפתור שלו נושא את המזהה. `null` = אין. */
  async threadTitle(id: string): Promise<{ id: string; title: string } | null> {
    return this.prisma.forumThread.findFirst({ where: { id, hiddenAt: null }, select: { id: true, title: true } });
  }

  /**
   * השרשור של ההתראה האחרונה מהפורום — מה ש„להשיב בפורום” ו„להפסיק
   * לעקוב” בוואטסאפ מתייחסים אליו. תחת הדייר: ההתראות הן טבלת דייר.
   */
  async lastNotifiedThread(): Promise<{ id: string; title: string } | null> {
    const { userId, tenantId } = this.me();
    const notification = await this.prisma.withTenant((tx) =>
      tx.notification.findFirst({
        where: { tenantId, userId, type: { startsWith: "forum_" }, entityId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { entityId: true },
      }),
    );
    if (notification?.entityId === null || notification === null) return null;
    const thread = await this.prisma.forumThread.findFirst({
      where: { id: notification.entityId, hiddenAt: null },
      select: { id: true, title: true },
    });
    return thread;
  }

  /** שרשור לפי מילים מהכותרת — לסוכן. `null` = לא נמצא. */
  async findByPhrase(phrase: string): Promise<{ id: string; title: string } | null> {
    const { items } = await this.listThreads({ q: phrase, sort: "active" });
    const first = items[0];
    return first === undefined ? null : { id: first.id, title: first.title };
  }

  /* ==================== המדריך: כלים ובעלי מקצוע ==================== */

  async listListings(query: ForumListingList): Promise<{ items: ForumListingDto[] }> {
    const { key } = this.me();
    const q = query.q?.trim();
    const rows = await this.prisma.forumListing.findMany({
      where: {
        kind: query.kind,
        hiddenAt: null,
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(q === undefined || q === ""
          ? {}
          : {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { area: { contains: q, mode: "insensitive" } },
              ],
            }),
      },
      orderBy: [{ ratingCount: "desc" }, { ratingSum: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { ratings: { where: { raterKey: key }, select: { score: true, comment: true } } },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind as "tool" | "pro",
        category: row.category,
        name: row.name,
        description: row.description,
        url: row.url,
        contact: row.contact,
        area: row.area,
        ratingAverage: ratingAverage(row.ratingSum, row.ratingCount),
        ratingCount: row.ratingCount,
        myRating: row.ratings[0] ?? null,
        mine: row.createdByUserId === TenantContext.current().userId,
        createdAt: row.createdAt,
      })),
    };
  }

  async createListing(input: ForumListingInput): Promise<{ id: string }> {
    const { userId, tenantId } = this.me();
    const id = ulid();
    await this.prisma.forumListing.create({
      data: {
        id,
        kind: input.kind,
        category: input.category,
        name: input.name,
        description: input.description,
        url: input.url ?? null,
        contact: input.contact ?? null,
        area: input.area ?? null,
        createdByUserId: userId,
        createdByTenantId: tenantId,
      },
    });
    await this.recordAudit("forum.listing_create", "forum_listing", id, { kind: input.kind });
    return { id };
  }

  /** דירוג — אחד לכל מדרג; דירוג חוזר מחליף את הקודם ומתקן את המונים. */
  async rate(listingId: string, input: ForumRatingInput): Promise<{ ratingAverage: number | null; ratingCount: number }> {
    const { userId, tenantId, key } = this.me();
    const listing = await this.prisma.forumListing.findFirst({ where: { id: listingId, hiddenAt: null }, select: { id: true } });
    if (listing === null) throw new NotFoundException("הרשומה לא נמצאה");
    const updated = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.forumRating.findUnique({
        where: { listingId_raterKey: { listingId, raterKey: key } },
        select: { id: true, score: true },
      });
      /*
       * ‎**השם והמשרד נכתבים תמיד.** אין כאן ענף אנונימי ואין עמודה
       * כזו: מי שמדרג עסק של אחר עומד מאחורי מה שכתב. `tenantId`
       * נשמר בנפרד כדי שמחיקת משתמש לא תמחק גם את המשרד.
       */
      const data = { score: input.score, comment: input.comment ?? null, userId, raterTenantId: tenantId };
      if (previous === null) {
        await tx.forumRating.create({ data: { id: ulid(), listingId, raterKey: key, ...data } });
      } else {
        await tx.forumRating.update({ where: { id: previous.id }, data });
      }
      return tx.forumListing.update({
        where: { id: listingId },
        data: {
          ratingSum: { increment: input.score - (previous?.score ?? 0) },
          ...(previous === null ? { ratingCount: { increment: 1 } } : {}),
        },
        select: { ratingSum: true, ratingCount: true },
      });
    });
    return { ratingAverage: ratingAverage(updated.ratingSum, updated.ratingCount), ratingCount: updated.ratingCount };
  }

  async listRatings(listingId: string): Promise<{ items: ForumRatingDto[] }> {
    const rows = await this.prisma.forumRating.findMany({
      where: { listingId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { name: true } }, raterTenant: { select: { name: true } } },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        score: row.score,
        comment: row.comment,
        /*
         * ‎**שם ומשרד, תמיד.** אין ענף אנונימי — ראו `ForumRating`
         * בסכימה. משתמש שנמחק משאיר „משתמש שנמחק”, אבל המשרד נשאר
         * בשורה, כך שלחוות הדעת יש מולה עדיין עם מי לדבר.
         */
        author: {
          label: row.user?.name ?? DELETED_USER,
          office: row.raterTenant?.name ?? null,
          anonymous: false,
        },
        createdAt: row.createdAt,
      })),
    };
  }

  /* ==================== דיווח וניהול ==================== */

  async report(targetType: "thread" | "post" | "listing" | "rating", targetId: string, input: ForumReportInput): Promise<{ reported: true }> {
    const { userId } = this.me();
    await this.prisma.forumReport.upsert({
      where: { targetType_targetId_reporterUserId: { targetType, targetId, reporterUserId: userId } },
      create: { id: ulid(), targetType, targetId, reporterUserId: userId, reason: input.reason, note: input.note ?? null },
      update: { reason: input.reason, note: input.note ?? null, resolvedAt: null },
    });
    return { reported: true };
  }

  async openReports(): Promise<{ items: ForumReportDto[] }> {
    const rows = await this.prisma.forumReport.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items: ForumReportDto[] = [];
    for (const row of rows) {
      let threadId: string | null = null;
      let excerpt = "";
      if (row.targetType === "thread") {
        const thread = await this.prisma.forumThread.findUnique({ where: { id: row.targetId }, select: { title: true } });
        threadId = thread === null ? null : row.targetId;
        excerpt = thread?.title ?? "(נמחק)";
      } else if (row.targetType === "post") {
        const post = await this.prisma.forumPost.findUnique({ where: { id: row.targetId }, select: { threadId: true, body: true } });
        threadId = post?.threadId ?? null;
        excerpt = post === null ? "(נמחק)" : snippet(post.body);
      } else if (row.targetType === "listing") {
        const listing = await this.prisma.forumListing.findUnique({ where: { id: row.targetId }, select: { name: true } });
        excerpt = listing?.name ?? "(נמחק)";
      } else {
        const rating = await this.prisma.forumRating.findUnique({ where: { id: row.targetId }, select: { comment: true } });
        excerpt = rating?.comment ?? "(נמחק)";
      }
      items.push({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        note: row.note,
        threadId,
        excerpt,
        createdAt: row.createdAt,
      });
    }
    return { items };
  }

  async resolveReport(id: string): Promise<void> {
    await this.prisma.forumReport.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date() } });
  }

  /** הסתרה, נעיצה ונעילה — ניהול הפלטפורמה. הסתרה סוגרת גם את הדיווחים. */
  async moderate(
    targetType: "thread" | "post" | "listing" | "rating",
    targetId: string,
    input: ForumModeration,
  ): Promise<void> {
    const hiddenAt = input.hidden === undefined ? undefined : input.hidden ? new Date() : null;
    if (targetType === "thread") {
      await this.prisma.forumThread.update({
        where: { id: targetId },
        data: {
          ...(hiddenAt === undefined ? {} : { hiddenAt }),
          ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
          ...(input.locked === undefined ? {} : { locked: input.locked }),
        },
      });
    } else if (targetType === "post") {
      if (hiddenAt !== undefined) {
        // תגובה מוסתרת אינה „התשובה” — השרשור חוזר להיות פתוח באותה טרנזקציה
        await this.prisma.$transaction(async (tx) => {
          const post = await tx.forumPost.update({ where: { id: targetId }, data: { hiddenAt }, select: { threadId: true } });
          if (hiddenAt !== null) {
            await tx.forumThread.updateMany({ where: { id: post.threadId, acceptedPostId: targetId }, data: { acceptedPostId: null } });
          }
        });
      }
    } else if (targetType === "listing") {
      if (hiddenAt !== undefined) await this.prisma.forumListing.update({ where: { id: targetId }, data: { hiddenAt } });
    } else if (input.hidden === true) {
      // לדירוג אין „מוסתר” — הסרה מוחקת אותו ומתקנת את המונים
      await this.prisma.$transaction(async (tx) => {
        const rating = await tx.forumRating.findUnique({ where: { id: targetId }, select: { listingId: true, score: true } });
        if (rating === null) return;
        await tx.forumRating.delete({ where: { id: targetId } });
        await tx.forumListing.update({
          where: { id: rating.listingId },
          data: { ratingSum: { decrement: rating.score }, ratingCount: { decrement: 1 } },
        });
      });
    }
    if (input.hidden === true) {
      await this.prisma.forumReport.updateMany({ where: { targetType, targetId, resolvedAt: null }, data: { resolvedAt: new Date() } });
    }
    await this.recordAudit("forum.moderate", `forum_${targetType}`, targetId, { ...input });
  }

  /* ==================== עזר ==================== */

  /**
   * בעלות לפי החתם — 404 ולא 403: תשובה שונה לשורה קיימת-אך-לא-שלי
   * מסגירה את קיומה, ובפורום אנונימי „קיים אבל לא שלך” הוא כבר מידע.
   */
  private static assertOwner<T extends { authorKey: string; hiddenAt: Date | null }>(
    row: T | null,
    key: string,
  ): asserts row is T {
    if (row === null || row.hiddenAt !== null || row.authorKey !== key) {
      throw new NotFoundException("לא נמצא");
    }
  }

  /** „במעקב” — שורת מעקב, או תוכן אנונימי שלי בשרשור עם `author_notify`. */
  private static followingWhere(userId: string, key: string): Prisma.ForumThreadWhereInput {
    return {
      OR: [
        { follows: { some: { userId } } },
        { anonymous: true, authorKey: key, authorNotify: true },
        { posts: { some: { anonymous: true, authorKey: key, authorNotify: true } } },
      ],
    };
  }

  /** אותו „במעקב” כ-SQL — לשאילתת החיפוש, יחד עם שאר הסינונים. */
  private static searchFilters(query: ForumThreadList, userId: string, key: string): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`t.hidden_at IS NULL`];
    if (query.topic !== undefined) conditions.push(Prisma.sql`t.topic = ${query.topic}`);
    if (query.kind !== undefined) conditions.push(Prisma.sql`t.kind = ${query.kind}`);
    if (query.anonymous !== undefined) conditions.push(Prisma.sql`t.anonymous = true`);
    if (query.mine !== undefined) conditions.push(Prisma.sql`t.author_key = ${key}`);
    if (query.unanswered !== undefined) conditions.push(Prisma.sql`t.kind = 'question' AND t.accepted_post_id IS NULL`);
    if (query.following !== undefined) {
      conditions.push(Prisma.sql`(EXISTS (SELECT 1 FROM forum_follows f WHERE f.thread_id = t.id AND f.user_id = ${userId})
        OR (t.anonymous AND t.author_key = ${key} AND t.author_notify)
        OR EXISTS (SELECT 1 FROM forum_posts p WHERE p.thread_id = t.id AND p.anonymous AND p.author_key = ${key} AND p.author_notify))`);
    }
    return Prisma.join(conditions, " AND ");
  }

  /** אילו מהשרשורים במעקב — שורת מעקב או תגובה אנונימית שלי שמאזינה. */
  private async followedAmong(threadIds: string[], userId: string, key: string): Promise<Set<string>> {
    if (threadIds.length === 0) return new Set();
    const [follows, anonymousPosts] = await Promise.all([
      this.prisma.forumFollow.findMany({ where: { userId, threadId: { in: threadIds } }, select: { threadId: true } }),
      this.prisma.forumPost.findMany({
        where: { threadId: { in: threadIds }, anonymous: true, authorKey: key, authorNotify: true },
        select: { threadId: true },
        distinct: ["threadId"],
      }),
    ]);
    return new Set([...follows, ...anonymousPosts].map((row) => row.threadId));
  }

  private static ownAnonymousNotify(row: { anonymous: boolean; authorKey: string; authorNotify: boolean }, key: string): boolean {
    return row.anonymous && row.authorKey === key && row.authorNotify;
  }

  /** ההפניה המוצפנת למחבר אנונימי — נפתחת רק ב-`ForumNotifyService`. */
  private authorRef(tenantId: string, userId: string): string {
    return this.crypto.encrypt(`${tenantId}:${userId}`);
  }

  /**
   * יומן הביקורת נכתב **תחת המשרד של הפועל**: הפעולה היא שלו, גם
   * כשהתוכן הוא של הקהילה. פעולה אנונימית נרשמת **בלי מזהה** — לא
   * השרשור, לא התגובה, לא בשדה ולא במטא-נתונים: היומן של המשרד
   * נושא את שם המשתמש, ומזהה לצדו היה הופך אותו לרשימה מזוהה של מה
   * שנכתב בעילום שם (ביקורת Codex). „פעל בפורום בעילום שם” הוא כל מה
   * שהמשרד יודע.
   */
  private async recordAudit(
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action,
        entityType,
        ...(entityId === null ? {} : { entityId }),
        ...(metadata === undefined ? {} : { metadata }),
      }),
    );
  }
}
