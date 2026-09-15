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
 */

/** מקסימום נמענים להפצה אחת — מעבר לזה זו כבר רשימת תפוצה, לא פורום. */
const MAX_RECIPIENTS = 2000;

interface Recipient {
  userId: string;
  tenantId: string;
}

@Injectable()
export class ForumNotifyService {
  private readonly logger = new Logger(ForumNotifyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** תגובה חדשה — לעוקבי השרשור, חוץ ממי שכתב אותה. */
  newReply(thread: ForumThreadDto, post: ForumPostDto, authorUserId: string): void {
    const notice = forumReplyNotice({
      threadTitle: thread.title,
      authorLabel: post.author.label,
      reply: post.body,
    });
    void this.run(async () => {
      const followers = await this.prisma.forumFollow.findMany({
        where: { threadId: thread.id, userId: { not: authorUserId }, user: { isActive: true } },
        select: { user: { select: { id: true, tenantId: true } } },
        take: MAX_RECIPIENTS,
      });
      await this.fanOut(
        followers.map((row) => ({ userId: row.user.id, tenantId: row.user.tenantId })),
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

  /** התגובה שלך התקבלה — למחבר מזוהה בלבד (לאנונימי אין למי לשלוח). */
  accepted(threadId: string, threadTitle: string, postId: string, authorUserId: string): void {
    void this.run(async () => {
      const user = await this.prisma.user.findFirst({
        where: { id: authorUserId, isActive: true },
        select: { id: true, tenantId: true },
      });
      if (user === null) return;
      await this.fanOut(
        [{ userId: user.id, tenantId: user.tenantId }],
        FORUM_NOTIFICATION_TYPES.accepted,
        `forum_accepted:${postId}`,
        forumAcceptedNotice(threadTitle),
        threadId,
      );
    });
  }

  /** קיבוץ לפי משרד — טרנזקציה אחת לכל משרד, לא לכל נמען. */
  private async fanOut(
    recipients: Recipient[],
    type: string,
    eventKey: string,
    notice: ForumNoticeText,
    threadId: string,
  ): Promise<void> {
    const byTenant = new Map<string, string[]>();
    for (const recipient of recipients) {
      const list = byTenant.get(recipient.tenantId) ?? [];
      list.push(recipient.userId);
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
