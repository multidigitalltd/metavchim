/**
 * המנטור בשיחה — הרפלקציה והתוכנית, בלי הרשת.
 *
 * ## למה זה מסלול משלו ולא פעולה בקטלוג
 *
 * „מה עצר?” היא שאלה שהמנטור שואל, והתשובה היא טקסט חופשי במילים
 * של המתווך — „לא היה זמן, היו מילואים”. מנוע ההבנה מחפש פעולה
 * במשפט כזה ולא מוצא, או מוצא אחת שאינה נכונה. לכן, אחרי לחיצה על
 * „לענות למנטור” (או המילים האלה כלשונן), **ההודעה הבאה היא
 * התשובה** — מצב ממתין כמו „אשר”, עם אותו חותם ואותה צריכה אטומית.
 * אחרי התשובה מגיע החצי השני של WOOP: „ואם זה יקרה שוב?” — שלוש
 * הצעות ללחיצה, או תוכנית במילים של המתווך (docs/13 §9).
 */

import { MENTOR_QUICK_COMMANDS, type WhatsAppListRow } from "@metavchim/shared";
import { choiceVariant, type AgentReply } from "./assistant-buttons";
import { normalizeShort } from "./assistant-lang";

/** „לענות למנטור” — כלשונו, כמו שהכפתור שולח; לא זיהוי כוונה. */
export function isMentorReflectRequest(text: string): boolean {
  return (
    normalizeShort(text) ===
    normalizeShort(MENTOR_QUICK_COMMANDS.mentor_reflect)
  );
}

const SKIP_WORDS = new Set([
  "דלג",
  "לדלג",
  "לא עכשיו",
  "בלי תוכנית",
  "אין",
  "לא",
]);

/** „דלג” על התוכנית — הרפלקציה כבר נשמרה, התוכנית היא רשות. */
export function isSkipMessage(text: string): boolean {
  return SKIP_WORDS.has(normalizeShort(text));
}

/** התוכנית מוגבלת כמו כוונת היישום; קצר מדי אינו תוכנית. */
export const MENTOR_PLAN_MIN = 3;

/** השאלה של המנטור, והזמנה לענות בהודעה הבאה. */
export function mentorReflectionPrompt(question: string): AgentReply {
  const body = `🧭 ${question}`;
  return {
    text: `${body}\n\nכתבו לי מה עצר — במילים שלכם. ההודעה הבאה נשמרת כתשובה. „בטל” אם לא עכשיו.`,
    buttonBody: body,
    speak: `${question} כתבו לי מה עצר, במילים שלכם.`,
  };
}

/** התשובה נשמרה — ועכשיו „ואם זה יקרה שוב?” עם הצעות ללחיצה. */
export function mentorPlanPrompt(
  answer: string,
  plans: readonly string[],
  token: string,
): AgentReply {
  const head = `נשמר: „${answer}”.\n\nואם זה יקרה שוב — מה התוכנית? „כש… אז…” במילים שלכם, או אחת מאלה:`;
  const listed = plans.map((plan, i) => `${i + 1}. ${plan}`);
  const rows: WhatsAppListRow[] = plans.map((plan, i) => ({
    action: "pick",
    arg: String(i + 1),
    token,
    title: `תוכנית ${i + 1}`,
    description: plan,
  }));
  const tail = "אפשר לענות במספר, לכתוב תוכנית משלכם, או „דלג”.";
  return {
    text: [head, ...listed, "", tail].join("\n"),
    buttonBody: [head, ...listed].join("\n"),
    ...(rows.length === 0 ? {} : choiceVariant(rows)),
    speak:
      "נשמר. ואם זה יקרה שוב, מה התוכנית? אפשר לבחור אחת מההצעות או לכתוב משלכם.",
  };
}

export function mentorPlanSaved(plan: string): AgentReply {
  const text = `✅ התוכנית נכנסה ליעד: „${plan}”. הדחיפה של אמצע השבוע תזכיר אותה.`;
  return { text, speak: "התוכנית נכנסה ליעד." };
}

export function mentorPlanSkipped(): AgentReply {
  const text = "בסדר — בלי תוכנית הפעם. התשובה נשמרה, והמנטור יזכור אותה.";
  return { text, speak: text };
}
