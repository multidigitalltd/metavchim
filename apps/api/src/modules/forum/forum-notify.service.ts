import { Injectable, Logger } from "@nestjs/common";
import {
  FORUM_NOTIFICATION_TYPES,
  FORUM_THREAD_ENTITY,
  forumAcceptedNotice,
  forumReplyNotice,
  forumThreadNotice,
  parseForumPrefs,
  type ForumNoticeText,
} from "@metavchim/shared";
import { notifyOnce } from "../../common/notify-once";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import type { ForumPostDto, ForumThreadDto } from "./forum.service";

/**
 * הפורום ⟵ ההתראות — **שורה אחת ב-`notifications`, ושלושה ערוצים.**
 *
 * הפעמון, הפוש בדפדפן, הוואטסאפ והמייל כולם קוראים מאותה טבלה:
 * הסורקים בוורקר מרימים את מה שטרם נדחף, וסורק המייל של הפורום
 * (`forum-mail.service.ts`) מרים את מה שטרם נשלח. לכן כל מה שהשירות
 * הזה עושה הוא לכתוב את השורה הנכונה לנמען הנכון — פעם אחת
 * (`dedupeKey`), תחת **המשרד של הנמען** (`withExplicitTenant`), כי
 * ההתראות הן טבלת דייר והנמענים הם ממשרדים שונים.
 *
 * ## למה אחרי הטרנזקציה, ובלי `await`
 *
 * שרשור עם מאה עוקבים הוא מאה כתיבות בעשרות משרדים. זה אינו שייך
 * לזמן התגובה של „פרסם”: התגובה כבר נשמרה, והמתווך רואה אותה. הפצה
 * שנכשלה נרשמת ביומן ואינה מפילה את הפרסום — ו-`dedupeKey` מבטיח
 * שסבב חוזר לא ישלח פעמיים.
 *
 * ## הנמענים האנונימיים
 *
 * מי ששאל או ענה בעילום שם אינו „עוקב” — אין לו שורת מעקב, כי שורה
 * כזו הייתה מצביעה עליו. הוא נמען דרך `author_ref`: ההפניה המוצפנת
 * שבשורה שלו, שנפתחת **כאן בלבד**, לרגע אחד, כדי לדעת למי לכתוב את
 * ההתראה. ההתראה עצמה יושבת ב-`notifications` של המשרד שלו — כמו
 * כל התראה אחרת שלו — ואינה אומרת דבר על מה שכתב.
 */

/** מקסימום נמענים להפצה אחת — מעבר לזה זו כבר רשימת תפוצה, לא פורום. */
const MAX_RECIPIENTS = 2000;

interface Recipient {
  userId: string;
  tenantId: string;
}

/** מה שהשירות צריך לדעת על מחבר כדי לכתוב לו — מזוהה, או דרך ההפניה. */
export interface ForumAuthorRef {
  authorUserId: string | null;
  authorRef: string | null;
  authorNotify: boolean;
}

/** צורת מזהה — שמירה מפני הפניה פגומה, לא אימות ULID מלא (`char(26)` במסד). */
const ID_SHAPE = /^[0-9A-Z]{26}$/u;

@Injectable()
export class ForumNotifyService {
  private readonly logger = new Logger(ForumNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** תגובה חדשה — לעוקבי השרשור ולמי שכתב בו בעילום שם, חוץ ממי שכתב אותה. */
  newReply(thread: ForumThreadDto, post: ForumPostDto, authorUserId: string): void {
    const notice = forumReplyNotice({
      threadTitle: thread.title,
      authorLabel: post.author.label,
      reply: post.body,
    });
    void this.run(async () => {
      const [followers, anonymousThread, anonymousPosts] = await Promise.all([
        this.prisma.forumFollow.findMany({
          where: { threadId: thread.id, userId: { not: authorUserId }, user: { isActive: true } },
          select: { user: { select: { id: true, tenantId: true } } },
          take: MAX_RECIPIENTS,
        }),
        this.prisma.forumThread.findUnique({
          where: { id: thread.id },
          select: { anonymous: true, authorRef: true, authorNotify: true },
        }),
        this.prisma.forumPost.findMany({
          where: { threadId: thread.id, anonymous: true, authorNotify: true, authorRef: { not: null }, hiddenAt: null },
          select: { authorRef: true },
          take: MAX_RECIPIENTS,
        }),
      ]);
      const refs = [
        ...(anonymousThread?.anonymous && anonymousThread.authorNotify ? [anonymousThread.authorRef] : []),
        ...anonymousPosts.map((row) => row.authorRef),
      ];
      const anonymous = await this.recipientsOf(refs);
      await this.fanOut(
        [
          ...followers.map((row) => ({ userId: row.user.id, tenantId: row.user.tenantId })),
          ...anonymous.filter((recipient) => recipient.userId !== authorUserId),
        ],
        FORUM_NOTIFICATION_TYPES.reply,
        `forum_reply:${post.id}`,
        notice,
        thread.id,
      );
    });
  }

  /** שרשור חדש — למי שביקש לעקוב אחרי כל הפורום. */
  newThread(thread: ForumThreadDto, authorUserId: string): void {
    const notice = forumThreadNotice({
      kind: thread.kind,
      title: thread.title,
      authorLabel: thread.author.label,
      body: thread.snippet,
    });
    void this.run(async () => {
      /*
       * הסינון על ה-JSON במסד ולא בזיכרון: „כל המשתמשים הפעילים”
       * הוא הרשימה הגדולה ביותר במערכת, ורק חלקם ביקשו את זה.
       * ‎`parseForumPrefs` רץ שוב על מה שחזר — המסד סינן, הקוד מכריע.
       */
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          id: { not: authorUserId },
          preferences: { path: ["forum", "followAll"], equals: true },
        },
        select: { id: true, tenantId: true, preferences: true },
        take: MAX_RECIPIENTS,
      });
      await this.fanOut(
        users
          .filter((user) => parseForumPrefs(user.preferences).followAll)
          .map((user) => ({ userId: user.id, tenantId: user.tenantId })),
        FORUM_NOTIFICATION_TYPES.thread,
        `forum_thread:${thread.id}`,
        notice,
        thread.id,
      );
    });
  }

  /** התגובה שלך התקבלה — למי שענה, מזוהה או דרך ההפניה המוצפנת. */
  accepted(threadId: string, threadTitle: string, postId: string, author: ForumAuthorRef): void {
    void this.run(async () => {
      const recipients =
        author.authorUserId !== null
          ? await this.activeUsers([author.authorUserId])
          : author.authorNotify
            ? await this.recipientsOf([author.authorRef])
            : [];
      await this.fanOut(
        recipients,
        FORUM_NOTIFICATION_TYPES.accepted,
        `forum_accepted:${postId}`,
        forumAcceptedNotice(threadTitle),
        threadId,
      );
    });
  }

  /**
   * ההפניות המוצפנות ⟵ נמענים. הפענוח קורה כאן ורק כאן; הפניה
   * שאינה נפתחת (מפתח שהוחלף, שורה פגומה) פשוט אינה נמען — לא שגיאה
   * שמפילה את ההפצה לכל השאר.
   */
  private async recipientsOf(refs: (string | null)[]): Promise<Recipient[]> {
    const userIds = new Set<string>();
    for (const ref of refs) {
      if (ref === null) continue;
      try {
        const userId = this.crypto.decrypt(ref).split(":")[1] ?? "";
        if (ID_SHAPE.test(userId)) userIds.add(userId);
      } catch {
        this.logger.warn("הפניית מחבר אנונימי בפורום לא נפתחה — מדלגים");
      }
    }
    return this.activeUsers([...userIds]);
  }

  /** משתמשים פעילים בלבד — המשרד מהשורה שלהם, לא מההפניה. */
  private async activeUsers(userIds: string[]): Promise<Recipient[]> {
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, tenantId: true },
    });
    return users.map((user) => ({ userId: user.id, tenantId: user.tenantId }));
  }

  /** קיבוץ לפי משרד — טרנזקציה אחת לכל משרד, לא לכל נמען. */
  private async fanOut(
    recipients: Recipient[],
    type: string,
    eventKey: string,
    notice: ForumNoticeText,
    threadId: string,
  ): Promise<void> {
    const byTenant = new Map<string, Set<string>>();
    for (const recipient of recipients) {
      const list = byTenant.get(recipient.tenantId) ?? new Set<string>();
      list.add(recipient.userId);
      byTenant.set(recipient.tenantId, list);
    }
    for (const [tenantId, userIds] of byTenant) {
      await this.prisma.withExplicitTenant(tenantId, async (tx) => {
        for (const userId of userIds) {
          await notifyOnce(tx, {
            tenantId,
            // המפתח מתאר את האירוע **ואת הנמען** — הייחודיות היא לכל משרד
            dedupeKey: `${eventKey}:${userId}`,
            userId,
            type,
            title: notice.title,
            body: notice.body,
            entityType: FORUM_THREAD_ENTITY,
            entityId: threadId,
          });
        }
      });
    }
  }

  private async run(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      this.logger.warn(`הפצת התראות הפורום נכשלה: ${String(error)}`);
    }
  }
}
