import type { Capability } from "@metavchim/shared";
import type { AuthUser } from "./auth";

/**
 * ‏הניווט של המערכת — **אותם פריטים, אותו סדר ואותם כללים כמו הסרגל
 * ‏ב-web** (`apps/web/src/app/app-shell.tsx`). האפליקציה מציגה אותם
 * ‏במגירה כהה, כמו במובייל של ה-web.
 *
 * ‏לכל פריט יעד אחד משניים: מסך נייטיבי כשיש כזה (מה שהמתווך עושה
 * ‏עם טלפון ביד), ואחרת אותו מסך של ה-web מוטמע בתוך האפליקציה
 * ‏(`app/web/[...path].tsx`) — כך שכל פונקציה של המערכת זמינה, ומה
 * ‏שנבנה נייטיבית מחליף את ה-web בשקט.
 */

export interface NavSummary {
  properties: number;
  buyers: number;
  newLeads: number;
  matches: number;
  urgentTasks: number;
  emailUnread?: number;
  features?: string[];
  blockedModules?: string[];
}

export type NavTag = "soon" | "beta" | "ai";

export interface NavItem {
  /** ‏הנתיב ב-web — המזהה של הפריט. */
  href: string;
  label: string;
  /** ‏Ionicons — קירוב לסמלי הקו הדקים של ה-web. */
  icon: string;
  /** ‏מסך נייטיבי, כשיש. בלעדיו — ה-web המוטמע. */
  native?: string;
  /** ‏המודולים שהמסך נשען עליהם — חסומים כולם ⇒ הפריט יורד (כמו `NAV_MODULE`). */
  modules?: readonly string[];
  /** ‏פיצ'ר במסלול; לא כלול ⇒ לא מוצג. */
  feature?: string;
  /** ‏יכולת נדרשת. */
  needs?: Capability;
  platformAdmin?: boolean;
  tag?: NavTag;
  /** ‏תצוגה מקדימה: מנהל הפלטפורמה רואה את המסך פתוח — בלי התג. */
  tagHiddenForPlatformAdmin?: boolean;
  /** ‏מונה אפור ליד התווית. */
  count?: (s: NavSummary) => number;
  /** ‏תג אפרסק — דחיפות. */
  badge?: (s: NavSummary) => number;
  /** ‏נפתח בדפדפן של המכשיר, מחוץ לאפליקציה. */
  external?: boolean;
  /** ‏פריט משנה — מוסט פנימה תחת האב. */
  sub?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  /* ‏מסך הבית של האפליקציה — הדשבורד של המערכת (בקשת המשתמש) */
  { href: "/", label: "דשבורד", icon: "grid-outline" },
  { href: "/today", label: "היום", icon: "sunny-outline", native: "/today" },
  {
    href: "/properties",
    label: "נכסים",
    icon: "home-outline",
    native: "/properties",
    modules: ["properties"],
    count: (s) => s.properties,
  },
  {
    href: "/properties/recruitment",
    label: "נכסים לגיוס",
    icon: "flag-outline",
    modules: ["properties"],
    sub: true,
  },
  {
    href: "/buyers",
    label: "קונים · שוכרים",
    icon: "people-outline",
    native: "/buyers",
    modules: ["buyers"],
    count: (s) => s.buyers,
  },
  {
    href: "/leads",
    label: "לידים",
    icon: "flash-outline",
    native: "/leads",
    modules: ["leads"],
    badge: (s) => s.newLeads,
  },
  {
    href: "/voice",
    label: "הסוכן הקולי",
    icon: "mic-outline",
    native: "/voice",
    feature: "voice_intake",
  },
  {
    href: "/calls",
    label: "שיחות",
    icon: "call-outline",
    modules: ["leads", "buyers"],
  },
  {
    href: "/matches",
    label: "התאמות",
    icon: "git-compare-outline",
    native: "/matches",
    modules: ["matches"],
    count: (s) => s.matches,
  },
  {
    href: "/offers",
    label: "הצעות",
    icon: "document-text-outline",
    modules: ["offers"],
  },
  {
    href: "/inbox",
    label: "תיבת מייל",
    icon: "mail-outline",
    badge: (s) => s.emailUnread ?? 0,
  },
  {
    href: "/calendar",
    label: "יומן",
    icon: "calendar-outline",
    native: "/calendar",
    modules: ["calendar"],
  },
  {
    href: "/tasks",
    label: "משימות",
    icon: "checkbox-outline",
    native: "/tasks",
    modules: ["calendar"],
    badge: (s) => s.urgentTasks,
  },
  {
    href: "/collaboration",
    label: 'שת"פים',
    icon: "link-outline",
    modules: ["collaboration"],
  },
  {
    href: "/kanko",
    label: "קונים - kanko",
    icon: "people-circle-outline",
    tag: "soon",
  },
  {
    href: "/reports",
    label: "דוחות",
    icon: "bar-chart-outline",
    modules: ["reports"],
    feature: "analytics",
    needs: "analytics.view",
  },
  {
    href: "/forum",
    label: "פורום וכלים",
    icon: "chatbubbles-outline",
    tag: "beta",
  },
  {
    href: "/mentor",
    label: "המנטור האישי שלך",
    icon: "sparkles-outline",
    tag: "ai",
  },
  {
    href: "/media",
    label: "רכש מדיה",
    icon: "megaphone-outline",
    // ‏תצוגה מקדימה למנהל הפלטפורמה; לשאר — „בקרוב” (השער ב-web, media/layout.tsx)
    tag: "soon",
    tagHiddenForPlatformAdmin: true,
  },
  { href: "/docs", label: "הדרכות", icon: "book-outline", external: true },
  {
    href: "/settings",
    label: "ניהול משרד",
    icon: "settings-outline",
    modules: ["admin"],
    needs: "settings.manage",
  },
  {
    href: "/setup",
    label: "הקמה",
    icon: "checkmark-done-outline",
    modules: ["admin"],
    needs: "settings.manage",
  },
  {
    href: "/platform",
    label: "פלטפורמה",
    icon: "cube-outline",
    platformAdmin: true,
  },
];

/** ‏התג שמוצג ליד הפריט למשתמש הזה — אותו כלל כמו התג בתפריט ה-web. */
export function navTag(item: NavItem, user: AuthUser | null): NavTag | undefined {
  if (item.tagHiddenForPlatformAdmin && user?.isPlatformAdmin === true) return undefined;
  return item.tag;
}

/** ‏האם הפריט מוצג למשתמש הזה, עם הסיכום הזה — אותם כללים כמו `navLink` ב-web. */
export function navVisible(
  item: NavItem,
  user: AuthUser | null,
  summary: NavSummary | null,
): boolean {
  if (item.platformAdmin && user?.isPlatformAdmin !== true) return false;
  if (
    item.needs !== undefined &&
    !(user?.capabilities?.includes(item.needs) ?? false)
  )
    return false;
  const blocked = summary?.blockedModules ?? [];
  if (
    item.modules !== undefined &&
    item.modules.every((m) => blocked.includes(m))
  )
    return false;
  // ‏כל עוד הסיכום לא נטען — מציגים, כדי שהתפריט לא „יקפוץ” על רשת איטית
  if (
    item.feature !== undefined &&
    summary?.features !== undefined &&
    !summary.features.includes(item.feature)
  ) {
    return false;
  }
  return true;
}

/** ‏תווית לנתיב של ה-web — לכותרת מסך מוטמע. הארוך ביותר שמתאים. */
export function navLabelFor(path: string): string | null {
  const clean = path.split("?")[0] ?? path;
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    const hit =
      item.href === "/"
        ? clean === "/"
        : clean === item.href || clean.startsWith(`${item.href}/`);
    if (hit && (best === null || item.href.length > best.href.length))
      best = item;
  }
  return best?.label ?? null;
}

/** ‏כותרות למסכי web שאינם פריטי ניווט — כמו `SCREEN_TITLES` ב-web. */
const EXTRA_TITLES: readonly [prefix: string, title: string][] = [
  ["/profile", "הפרופיל שלי"],
  ["/notifications", "התראות"],
  ["/search", "חיפוש"],
  ["/office", "המשרד שלנו"],
];

/** ‏כרטיס של ישות — הכותרת היא הישות, לא הרשימה שממנה הגיעו. */
const CARD_TITLES: readonly [pattern: RegExp, title: string][] = [
  [/^\/leads\/[A-Za-z0-9]{26}(\/|$)/u, "ליד"],
  [/^\/properties\/[A-Za-z0-9]{26}\/edit(\/|$)/u, "עריכת נכס"],
  [/^\/properties\/[A-Za-z0-9]{26}(\/|$)/u, "נכס"],
  [/^\/buyers\/[A-Za-z0-9]{26}\/edit(\/|$)/u, "עריכת לקוח"],
  [/^\/buyers\/[A-Za-z0-9]{26}(\/|$)/u, "לקוח"],
  [/^\/properties\/new(\/|$)/u, "נכס חדש"],
  [/^\/buyers\/new(\/|$)/u, "לקוח חדש"],
  [/^\/leads\/new(\/|$)/u, "ליד חדש"],
];

export function webScreenTitle(path: string): string {
  const clean = path.split("?")[0] ?? path;
  const card = CARD_TITLES.find(([pattern]) => pattern.test(clean));
  if (card) return card[1];
  const extra = EXTRA_TITLES.find(([prefix]) => clean.startsWith(prefix));
  return extra?.[1] ?? navLabelFor(clean) ?? "מתווכים";
}

/**
 * ‏לאן מנווטים בשביל נתיב של המערכת: המסך הנייטיבי כשיש, ואחרת המסך
 * ‏המוטמע. גם קישורים עמוקים (התראות, פוש) עוברים כאן — כך אין
 * ‏„אין מסך כזה”: מה שאין באפליקציה יש ב-web.
 */
export function routeFor(href: string): string {
  const [path, query] = href.split("?", 2);
  const clean = path ?? "/";
  const item = NAV_ITEMS.find((i) => i.href === clean);
  // ‏השאילתה נשארת גם במסך נייטיב — „17 קונים מתאימים” מגיע ל-`/matches?property=…`
  if (item?.native) return `${item.native}${query ? `?${query}` : ""}`;
  return `/web${clean === "/" ? "/home" : clean}${query ? `?${query}` : ""}`;
}
