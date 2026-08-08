/**
 * חריגי הרשאה לכל משתמש — השכבה שמעל התפקיד.
 *
 * התפקיד (owner/admin/agent/assistant/viewer) קובע את נקודת הפתיחה,
 * וכאן מנהל המשרד מכוונן אותה למשתמש בודד: להוסיף יכולת שהתפקיד לא
 * נותן, או לחסום יכולת שהוא כן נותן — לצמיתות או עד תאריך.
 *
 * למה חריגים ולא תפקידים נוספים: משרד שרוצה "סוכן שגם מוציא דוחות"
 * או "מתמחה שחסום מנכסים לחודש" היה מחייב תפקיד חדש בכל צירוף,
 * והרשימה הייתה מתפוצצת. חריג הוא שורה אחת, הפיכה, ועם תאריך תפוגה.
 *
 * התפוגה נאכפת *בקריאה* ולא בעבודת ניקוי: job שנתקע היה משאיר
 * משתמש חסום לנצח בלי שאיש ידע למה.
 */
import { CAPABILITIES, ROLE_CAPABILITIES, type Capability } from "../rbac.js";

export type OverrideEffect = "grant" | "deny";

export type CapabilityOverride = {
  capability: Capability;
  effect: OverrideEffect;
  /** null = לצמיתות (עד שמנהל יסיר), אחרת החריג פג מהתאריך הזה. */
  expiresAt: Date | null;
};

/** חריג בתוקף אם אין לו תפוגה, או שהתפוגה עוד לא הגיעה. */
export function isOverrideActive(override: CapabilityOverride, now: Date): boolean {
  return override.expiresAt === null || override.expiresAt.getTime() > now.getTime();
}

/**
 * היכולות בפועל של משתמש: התפקיד, ועליו החריגים שבתוקף.
 *
 * חריג על יכולת שהתפקיד ממילא לא נותן ו-effect שלו deny הוא no-op —
 * וזה מכוון: מנהל שחוסם "מודול" שלם מקבל התנהגות זהה בין משתמשים,
 * בלי לבדוק קודם מה כל תפקיד כולל.
 */
export function resolveCapabilities(
  role: string,
  overrides: readonly CapabilityOverride[],
  now: Date,
): Set<Capability> {
  const result = new Set<Capability>(ROLE_CAPABILITIES[role] ?? []);
  for (const override of overrides) {
    if (!isOverrideActive(override, now)) continue;
    if (override.effect === "grant") result.add(override.capability);
    else result.delete(override.capability);
  }
  return result;
}

/* ==================== קיבוץ למודולים עבור הממשק ==================== */

export type CapabilityModule = {
  key: string;
  label: string;
  /** מה המשתמש מאבד כשחוסמים את המודול — נוסח שמנהל מבין בלי מדריך. */
  description: string;
  capabilities: readonly Capability[];
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  "properties.view": "צפייה בנכסים",
  "properties.create": "הוספת נכס",
  "properties.edit": "עריכת נכס",
  "properties.delete": "מחיקת נכס",
  "buyers.view_all": "צפייה בכל הקונים במשרד",
  "buyers.view_own": "צפייה בקונים שלו",
  "buyers.edit": "עריכת קונים",
  "leads.view_all": "צפייה בכל הלידים במשרד",
  "leads.view_own": "צפייה בלידים שלו",
  "leads.edit": "עריכת לידים",
  "offers.send": "שליחת הצעות",
  "matches.view": "צפייה בהתאמות",
  "matches.manage": "ניהול התאמות",
  "calendar.manage": "ניהול יומן ופגישות",
  "collaboration.share": "שיתוף במאגר הביקושים",
  "collaboration.offer": "הצעות בין־משרדיות",
  "billing.manage": "ניהול חיוב ומנוי",
  "users.manage": "ניהול משתמשים והרשאות",
  "settings.manage": "הגדרות המשרד",
  "data.export": "ייצוא נתונים",
  "audit.view": "צפייה ביומן הפעולות",
  "analytics.view": "דוח המשרד",
};

export const CAPABILITY_MODULES: readonly CapabilityModule[] = [
  {
    key: "properties",
    label: "נכסים",
    description: "רשימת הנכסים, כרטיס נכס והוספת נכס חדש",
    capabilities: ["properties.view", "properties.create", "properties.edit", "properties.delete"],
  },
  {
    key: "buyers",
    label: "קונים",
    description: "כרטיסי הקונים והביקושים שלהם",
    capabilities: ["buyers.view_all", "buyers.view_own", "buyers.edit"],
  },
  {
    key: "leads",
    label: "לידים",
    description: "לידים נכנסים והטיפול בהם",
    capabilities: ["leads.view_all", "leads.view_own", "leads.edit"],
  },
  {
    key: "matches",
    label: "התאמות",
    description: "מנוע ההתאמות בין קונים לנכסים",
    capabilities: ["matches.view", "matches.manage"],
  },
  {
    key: "offers",
    label: "הצעות",
    description: "שליחת הצעות ללקוחות ומעקב אחריהן",
    capabilities: ["offers.send"],
  },
  {
    key: "calendar",
    label: "יומן",
    description: "פגישות, סיורים ותזכורות",
    capabilities: ["calendar.manage"],
  },
  {
    key: "collaboration",
    label: "שיתוף פעולה בין משרדים",
    description: "מאגר הביקושים המשותף והצעות בין־משרדיות",
    capabilities: ["collaboration.share", "collaboration.offer"],
  },
  {
    key: "reports",
    label: "דוחות וייצוא",
    description: "דוח המשרד וייצוא נתונים לקובץ",
    capabilities: ["analytics.view", "data.export"],
  },
  {
    key: "admin",
    label: "ניהול המשרד",
    description: "משתמשים, הגדרות, יומן פעולות וחיוב",
    capabilities: ["users.manage", "settings.manage", "audit.view", "billing.manage"],
  },
];

/** בדיקת שפיות: כל יכולת שייכת למודול אחד בדיוק. */
export function capabilitiesWithoutModule(): Capability[] {
  const covered = new Set(CAPABILITY_MODULES.flatMap((m) => m.capabilities));
  return CAPABILITIES.filter((c) => !covered.has(c));
}

/* ==================== מי רשאי לשנות למי ==================== */

export type OverrideRequest = {
  actorUserId: string;
  actorCapabilities: ReadonlySet<Capability>;
  targetUserId: string;
  targetRole: string;
  capability: Capability;
  effect: OverrideEffect;
};

/**
 * מה *באמת* עושה ניקוי חריג — הוספה או צמצום.
 *
 * ניקוי אינו פעולה ניטרלית: מחיקת חסימה על יכולת שהתפקיד כן נותן
 * מחזירה גישה, כלומר היא הענקה לכל דבר. בלי ההבחנה הזו מנהל שנחסמה
 * ממנו יכולת מסוימת יכול היה לנקות אותה אצל מנהל אחר ולהחזיר לו
 * גישה שהוא עצמו לא רשאי להעניק (ביקורת Codex).
 *
 * מחיקת *הענקה* היא צמצום, ולכן מותרת תמיד.
 */
export function clearEffect(
  targetRole: string,
  capability: Capability,
  existing: OverrideEffect | null,
): OverrideEffect {
  if (existing === "deny") {
    const roleGives = (ROLE_CAPABILITIES[targetRole] ?? []).includes(capability);
    return roleGives ? "grant" : "deny";
  }
  return "deny";
}

/**
 * מחזיר הודעת סירוב, או null כשהשינוי מותר.
 *
 * שלוש המגבלות כאן הן מה שמונע ממסך ההרשאות להפוך לדלת אחורית:
 * בלעדיהן, מנהל היה יכול להעניק לעצמו יכולת שאין לו, לנעול את עצמו
 * מחוץ למסך שממנו משחזרים, או לרוקן את בעל המשרד מהרשאות ולהשאיר
 * את המשרד בלי אף אחד שיכול לתקן.
 */
export function overrideRejectionReason(request: OverrideRequest): string | null {
  if (request.actorUserId === request.targetUserId) {
    // גם נעילה עצמית וגם הסלמה עצמית נחסמות בכלל אחד. אין תרחיש
    // אמיתי שבו מנהל צריך לשנות את ההרשאות של עצמו.
    return "אי אפשר לשנות הרשאות של עצמך — בקשו ממנהל אחר";
  }
  if (request.targetRole === "owner") {
    // בעל המשרד הוא נתיב השחזור האחרון מכל טעות במסך הזה
    return "אי אפשר לשנות הרשאות של בעל המשרד";
  }
  if (request.effect === "grant" && !request.actorCapabilities.has(request.capability)) {
    return "אי אפשר להעניק הרשאה שאין לכם בעצמכם";
  }
  return null;
}

/** ניסוח מצב החריג למסך — כולל ההבחנה בין חסימה זמנית לצמיתה. */
export function describeOverride(override: CapabilityOverride, now: Date): string {
  const verb = override.effect === "grant" ? "נוספה" : "נחסמה";
  if (override.expiresAt === null) return `${verb} לצמיתות`;
  if (!isOverrideActive(override, now)) return `${verb} — פג תוקף`;
  const days = Math.ceil((override.expiresAt.getTime() - now.getTime()) / 86_400_000);
  return days <= 1 ? `${verb} — עד סוף היום` : `${verb} — ל-${days} ימים נוספים`;
}
