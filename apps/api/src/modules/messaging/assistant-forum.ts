/**
 * הפורום בשיחה — „להשיב בפורום” ו„להפסיק לעקוב”, בלי הרשת (docs/14).
 *
 * ## למה מסלול משלו ולא פעולה בקטלוג
 *
 * אותה סיבה כמו הרפלקציה של המנטור: אחרי לחיצה על „להשיב בפורום”
 * ההודעה הבאה היא **התגובה עצמה** — טקסט חופשי שמנוע ההבנה היה
 * מחפש בו פעולה ולא מוצא. לכן זה מצב ממתין כמו „אשר”, עם חותם
 * וצריכה אטומית, ולא פירוש. „אנונימי:” בתחילת ההודעה = בעילום שם.
 */

import { FORUM_QUICK_COMMANDS, forumThreadPath } from "@metavchim/shared";
import type { AgentReply } from "./assistant-buttons";
import { normalizeShort } from "./assistant-lang";

export function isForumReplyRequest(text: string): boolean {
  return normalizeShort(text) === normalizeShort(FORUM_QUICK_COMMANDS.forum_reply);
}

export function isForumUnfollowRequest(text: string): boolean {
  return normalizeShort(text) === normalizeShort(FORUM_QUICK_COMMANDS.forum_unfollow);
}

/** אין שרשור להתייחס אליו — לא הגיעה עדיין שום התראה מהפורום. */
export function forumNoThreadReply(): AgentReply {
  const text =
    "עוד לא הגיעה אליך התראה מהפורום, ולכן אין שרשור להשיב עליו מכאן. אפשר לכתוב לי „תענה בפורום על השאלה של …: …”, או לפתוח את הפורום במערכת.";
  return { text, speak: text };
}

/** הזמנה לכתוב את התגובה בהודעה הבאה. */
export function forumReplyPrompt(threadTitle: string): AgentReply {
  const body = `💬 תגובה לשרשור „${threadTitle}”`;
  return {
    text: `${body}\n\nכתבו את התגובה בהודעה הבאה — היא תפורסם בשמכם. להשיב בעילום שם: התחילו ב„אנונימי:”. „בטל” אם לא עכשיו.`,
    buttonBody: body,
    speak: `תגובה לשרשור ${threadTitle}. כתבו את התגובה בהודעה הבאה.`,
  };
}

export function forumReplyPosted(threadId: string, anonymous: boolean, webOrigin: string): AgentReply {
  const link = `${webOrigin.replace(/\/+$/u, "")}${forumThreadPath(threadId)}`;
  const text = `✅ התגובה פורסמה${anonymous ? " בעילום שם" : ""}. ${link}`;
  return { text, speak: "התגובה פורסמה בפורום." };
}

export function forumUnfollowed(threadTitle: string): AgentReply {
  const text = `🔕 הפסקת לעקוב אחרי „${threadTitle}”. לא יגיעו עוד עדכונים על השרשור הזה.`;
  return { text, speak: text };
}
