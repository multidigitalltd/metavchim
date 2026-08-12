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
  "buyers.delete": "מחיקת כרטיס קונה",
  "leads.view_all": "צפייה בכל הלידים במשרד",
  "leads.view_own": "צפייה בלידים שלו",
  "leads.edit": "עריכת לידים",
  "leads.delete": "מחיקת ליד",
  "contacts.delete": "מחיקת לקוח מהמערכת",
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
  "tasks.assign": "הטלת משימות על סוכנים אחרים",
  "tasks.view_all": "צפייה בלוח המשימות של המשרד",
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
    capabilities: ["buyers.view_all", "buyers.view_own", "buyers.edit", "buyers.delete"],
  },
  {
    key: "leads",
    label: "לידים",
    description: "לידים נכנסים והטיפול בהם",
    capabilities: ["leads.view_all", "leads.view_own", "leads.edit", "leads.delete"],
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
    label: "יומן ומשימות",
    description: "פגישות, סיורים, תזכורות ומשימות",
    capabilities: ["calendar.manage"],
  },
  {
    /*
     * מודול נפרד מ"יומן" בכוונה: לכל סוכן יש משימות משלו וזה חלק
     * מ-calendar.manage, אבל **להטיל על אחרים** ו**לראות את לוח
     * המשרד** הן החלטות ניהוליות שמנהל אמור להעניק במפורש.
     */
    key: "tasks_management",
    label: "ניהול משימות הצוות",
    description: "הטלת משימות על סוכנים אחרים וצפייה בלוח המשימות של המשרד",
    capabilities: ["tasks.assign", "tasks.view_all"],
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
    description: "משתמשים, הגדרות, יומן פעולות, חיוב ומחיקת לקוח",
    /*
     * מחיקת לקוח יושבת כאן ולא במודול הקונים: היא אינה חלק מהטיפול
     * בלקוח אלא מימוש זכות המחיקה שלו — פעולה ניהולית שאי אפשר
     * לחזור ממנה, ושמוחקת גם הסכמים חתומים.
     */
    capabilities: [
      "users.manage",
      "settings.manage",
      "audit.view",
      "billing.manage",
      "contacts.delete",
    ],
  },
];

/** בדיקת שפיות: כל יכולת שייכת למודול אחד בדיוק. */
export function capabilitiesWithoutModule(): Capability[] {
  const covered = new Set(CAPABILITY_MODULES.flatMap((m) => m.capabilities));
  return CAPABILITIES.filter((c) => !covered.has(c));
}

/* ============================================================
   חסימת מודול ברמת המשרד — החלטה של הפלטפורמה
   ============================================================
   שכבה שלישית מעל התפקיד ומעל חריגי המשתמש, ובכיוון אחד בלבד:
   **חוסמת ולעולם לא מעניקה.** בעל הפלטפורמה מחליט שמשרד מסוים אינו
   עושה שימוש במודול — למשל בהפניות לקוחות — ובעל המשרד אינו יכול
   לבטל את זה מתוך מסך ההרשאות שלו.

   לכן היא מוחלת **אחרי** `resolveCapabilities` ולא כחריג נוסף:
   חריג deny ברמת המשתמש היה נמחק בלחיצה של מנהל המשרד, וחסימה
   שהנחסם יכול להסיר אינה חסימה.
   ============================================================ */

/** מפתחות המודולים החוקיים לחסימה — נגזרים מהקטלוג, לא רשימה שנייה. */
export const BLOCKABLE_MODULE_KEYS: readonly string[] = CAPABILITY_MODULES.map((m) => m.key);

/** תווית המודול לתצוגה; המפתח עצמו כשאינו מוכר. */
export function moduleLabel(key: string): string {
  return CAPABILITY_MODULES.find((m) => m.key === key)?.label ?? key;
}

/**
 * תקינות רשימת המודולים לחסימה — הודעה בעברית או `null`.
 *
 * מפתח שאינו בקטלוג נדחה ולא מתעלמים ממנו: חסימה שנשמרת ואינה
 * חוסמת דבר היא בדיוק ההבטחה השבורה שהמסך הזה קיים כדי למנוע.
 */
export function blockedModulesRejectionReason(keys: readonly string[]): string | null {
  const unknown = keys.filter((key) => !BLOCKABLE_MODULE_KEYS.includes(key));
  if (unknown.length > 0) return `מודול לא מוכר: ${unknown.join(", ")}`;
  return null;
}

/**
 * היכולות בפועל אחרי חסימת המודולים של המשרד.
 *
 * מקבלת את התוצאה של `resolveCapabilities` ומחסרת ממנה; מפתח לא
 * מוכר פשוט אינו מחסיר דבר, כי כאן כבר מאוחר מדי לזרוק שגיאה —
 * הבדיקה נעשית בשמירה.
 */
export function applyBlockedModules(
  capabilities: ReadonlySet<Capability>,
  blockedModules: readonly string[],
): Set<Capability> {
  if (blockedModules.length === 0) return new Set(capabilities);
  const result = new Set(capabilities);
  for (const key of blockedModules) {
    for (const capability of CAPABILITY_MODULES.find((m) => m.key === key)?.capabilities ?? []) {
      result.delete(capability);
    }
  }
  return result;
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
