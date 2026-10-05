import type { AgentHistoryRef, AgentHistoryTurn, AgentProposal } from "@metavchim/shared";

/**
 * ‏צורות הסוכן — אותן הצהרות כמו ב-`apps/web/src/app/voice`.
 * ‏ההצעה עצמה היא `AgentProposal` מ-shared; מה שכאן הוא התשובות
 * ‏של הביצוע והתור שנשלח כהקשר.
 */

export type Proposal = AgentProposal;

export interface ExecuteResult {
  href?: string;
  /** קישור חיצוני — wa.me עם הודעה מוכנה. מוצג ואינו נשמר. */
  link?: string;
  message: string;
  data?: unknown;
  insight?: string;
  suggestion?: string;
  nextSteps?: { text: string; label: string }[];
  ref?: AgentHistoryRef;
}

/**
 * תור בשיחה — נשלח לשרת כהקשר למשפטי המשך ("ומה עם רמת גן?").
 * הצורה המשותפת, לא העתק שלה: שדה שנוסף לזיכרון (כמו `reply`) מגיע
 * לכל הערוצים יחד.
 */
export type HistoryTurn = AgentHistoryTurn;

export interface AgentHelp {
  groups: { label: string; actions: { id: string; title: string; example: string }[] }[];
  examples: string[];
}
