/**
 * הכרטיס המלא כפי שהוא נקרא בוואטסאפ.
 *
 * ## למה מנסח ייעודי ולא הסיכום הכללי
 *
 * הסיכום הכללי (`summarizeData`) עונה על „כמה יש ומי הם” — הוא
 * אוסף תוויות מרשימת תוצאות. הכרטיס הוא השאלה ההפוכה: רשומה
 * **אחת**, וכל מה שיש עליה. שימוש באותו מנסח היה מחזיר שם בודד
 * בדיוק על הבקשה שדורשת את כל השאר.
 *
 * ## למה בעברית ולא כ-JSON
 *
 * המתווך קורא את זה בטלפון, בין פגישות. שדות עם תוויות בעברית
 * ובסדר קבוע נסרקים בעין; מבנה נתונים גולמי לא. הסדר הוא סדר
 * השימוש — מי זה ואיך מתקשרים אליו קודם, ההיסטוריה בסוף.
 */

import {
  FINANCING_LABELS,
  labelOf,
  LEAD_INTENT_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  MATURITY_LABELS,
} from "@metavchim/shared";

/** מה שהמסך היה קורא לו „לא צוין” — כאן פשוט לא מוצג. */
function line(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined && v !== "");
    return items.length === 0 ? null : `${label}: ${items.join(", ")}`;
  }
  return `${label}: ${String(value)}`;
}

const SHEKEL = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

/** אגורות ⟵ „₪1,200,000”. `undefined` נשאר חסר ולא הופך ל-0. */
function money(agorot: unknown): string | undefined {
  return typeof agorot === "number" ? SHEKEL.format(agorot / 100) : undefined;
}

const WHEN = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  dateStyle: "short",
  timeStyle: "short",
});

function when(value: unknown): string | undefined {
  if (value instanceof Date) return WHEN.format(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : WHEN.format(parsed);
  }
  return undefined;
}

interface CardCall {
  id?: unknown;
  direction?: unknown;
  occurredAt?: unknown;
  outcome?: unknown;
  summary?: unknown;
  hasRecording?: unknown;
}

/**
 * `null` = ה-`data` אינו כרטיס, והקורא ימשיך לסיכום הרגיל.
 */
export function formatCard(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const card = (data as Record<string, unknown>)["card"];
  if (typeof card !== "object" || card === null) return null;
  const c = card as Record<string, unknown>;
  const contact = (c["contact"] ?? {}) as Record<string, unknown>;
  const out: string[] = [];

  /* ---- מי זה ואיך מתקשרים ---- */
  const who = [
    line("📞 טלפון", contact["phone"]),
    line("✉️ אימייל", contact["email"]),
  ].filter((l): l is string => l !== null);
  out.push(...who);

  if (c["kind"] === "buyer") {
    const req = (c["requirements"] ?? {}) as Record<string, unknown>;
    const rooms =
      req["roomsMin"] !== undefined || req["roomsMax"] !== undefined
        ? [req["roomsMin"], req["roomsMax"]].filter((v) => v !== undefined).join("–")
        : undefined;
    const budget = [money(req["budgetMinAgorot"]), money(req["budgetMaxAgorot"])]
      .filter((v): v is string => v !== undefined)
      .join(" – ");
    const maturity = typeof c["maturity"] === "string" ? c["maturity"] : undefined;
    out.push(
      ...[
        line("🏙️ ערים", req["cities"]),
        line("🏘️ שכונות", req["neighborhoods"]),
        line("🚪 חדרים", rooms),
        line("💰 תקציב", budget === "" ? undefined : budget),
        line("🌡️ בשלות", labelOf(MATURITY_LABELS, maturity)),
        line("🏦 מימון", labelOf(FINANCING_LABELS, c["financing"])),
        line("📍 מקור", c["source"]),
        line("📝 הערות", c["agentNotes"]),
      ].filter((l): l is string => l !== null),
    );
  } else {
    out.push(
      ...[
        line("📊 סטטוס", labelOf(LEAD_STATUS_LABELS, c["status"])),
        line("🎯 עניין", labelOf(LEAD_INTENT_LABELS, c["intent"])),
        line("📍 מקור", labelOf(LEAD_SOURCE_LABELS, c["source"])),
        line("📝 תקציר", c["summary"]),
        c["requiresHuman"] === true ? "⚠️ מסומן כדורש טיפול אנושי" : null,
      ].filter((l): l is string => l !== null),
    );
  }

  /* ---- השיחות ---- */
  const calls = Array.isArray(c["calls"]) ? (c["calls"] as CardCall[]) : [];
  if (calls.length > 0) {
    out.push("", `☎️ שיחות אחרונות (${calls.length}):`);
    for (const call of calls.slice(0, 5)) {
      const stamp = when(call.occurredAt) ?? "";
      const dir = call.direction === "inbound" ? "נכנסת" : "יוצאת";
      /*
       * סימון ההקלטה הוא מה שהופך את השורה לפעולה: המתווך רואה
       * שיש מה לשמוע ויכול לבקש „תשמיע לי את השיחה איתו”.
       */
      const rec = call.hasRecording === true ? " 🎧" : "";
      out.push(`• ${stamp} · ${dir} · ${String(call.outcome ?? "")}${rec}`);
      if (typeof call.summary === "string" && call.summary !== "") {
        out.push(`  ↳ ${call.summary.slice(0, 200)}`);
      }
    }
    if (calls.some((call) => call.hasRecording === true)) {
      out.push('🎧 יש הקלטה — אמרו לי "תשמיע לי את השיחה איתו" ואשלח אותה.');
    }
  }

  /* ---- ציר הזמן של הליד ---- */
  const timeline = Array.isArray(c["timeline"]) ? c["timeline"] : [];
  if (timeline.length > 0) {
    out.push("", "🕘 ציר זמן:");
    for (const entry of timeline.slice(0, 5)) {
      const e = entry as Record<string, unknown>;
      const stamp = when(e["createdAt"]) ?? "";
      const content = typeof e["content"] === "string" ? e["content"].slice(0, 160) : "";
      out.push(`• ${stamp} · ${content}`);
    }
  }

  return out.length === 0 ? null : out.join("\n");
}
