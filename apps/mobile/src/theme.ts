/**
 * ‏טוקני העיצוב — אותם ערכים כמו `apps/web/src/app/globals.css` (ערכה
 * ‏בהירה). המקור הוא ה-CSS; כאן העתק שמתועד ככזה, כי RN אינו קורא CSS.
 * ‏שינוי צבע במערכת = שינוי בשני המקומות, ולכן הרשימה קצרה בכוונה.
 */
export const colors = {
  bg: "#f6f7f3",
  surface: "#ffffff",
  surfaceSunken: "#f8faf6",
  text: "#111710",
  textMuted: "#3c443e",
  textSoft: "#2c322e",
  primary: "#0c6e34",
  primaryAccent: "#0f8a43",
  primarySoft: "#e5fcea",
  action: "#70ee91",
  onAction: "#0b1f12",
  danger: "#b0512c",
  dangerSoft: "#fdf0eb",
  success: "#0c6e34",
  successSoft: "#e5fcea",
  warning: "#8f4200",
  warningBg: "#fef3c7",
  amberFg: "#79541a",
  border: "#e3e7de",
  inputBorder: "#808a82",
  rowBorder: "#e7eae3",
  chipNeutralFg: "#616a63",
  chipNeutralBg: "#eef1ec",
  tabActive: "#0b0e0c",
} as const;

/** ‏ערכת צבעים — אותם מפתחות בערכה הבהירה ובכהה; המסכים מקבלים אותה מ-`useTheme`. */
export type Palette = { readonly [K in keyof typeof colors]: string };

/**
 * ‏הערכה הכהה — `--dk-*` / `--dm-*` ב-`globals.css`, לפי המיפוי של
 * ‏`:root[data-theme="dark"]`. אותו שער (`verify:theme`) בודק גם אותה.
 */
export const darkColors: Palette = {
  bg: "#0d130f",
  surface: "#151d17",
  surfaceSunken: "#111a14",
  text: "#e8f0ea",
  textMuted: "#c3cfc6",
  textSoft: "#c3cfc6",
  primary: "#5fe083",
  primaryAccent: "#70ee91",
  primarySoft: "#17301f",
  action: "#5fe083",
  onAction: "#0d130f",
  danger: "#f0a58a",
  dangerSoft: "#331a12",
  success: "#5fe083",
  successSoft: "#17301f",
  warning: "#f0c674",
  warningBg: "#33280f",
  amberFg: "#f0cd85",
  border: "#364a3b",
  inputBorder: "#5a7461",
  rowBorder: "#2b3a2f",
  chipNeutralFg: "#c3cfc6",
  chipNeutralBg: "#1a231c",
  tabActive: "#d8e6dc",
};

/**
 * ‏המעטפת הכהה והמותג — ערכים שב-`globals.css` כתובים ישירות ברכיבים
 * ‏(`.mv-sidebar`, `.mv-nav-badge`, `.mv-auth-brand`), ולא כטוקנים, ולכן
 * ‏אינם בשער ההשוואה. מסומנים כאן במקורם.
 */
export const chrome = {
  /** ‏`.mv-sidebar` — רקע הסרגל/המגירה */
  sidebarBg: "#0b0e0c",
  /** ‏`.mv-sidebar` — טקסט */
  sidebarFg: "#e8ece8",
  /** ‏`.mv-sidebar-sub`, `.mv-nav-count` */
  sidebarMuted: "#9aa89e",
  /** ‏`.mv-sidebar-head` — קו הפרדה */
  sidebarLine: "rgba(255, 255, 255, 0.08)",
  /** ‏`.mv-sidebar-link[aria-current]` — הפריט הפעיל */
  sidebarActiveBg: "rgba(255, 255, 255, 0.08)",
  /** ‏`.mv-sidebar-user` */
  sidebarUserBg: "rgba(255, 255, 255, 0.05)",
  /** ‏`.mv-nav-badge` — תג אפרסק ללידים חדשים ולמשימות דחופות */
  badgeFg: "#f5b48e",
  badgeBg: "rgba(245, 180, 142, 0.16)",
  /** ‏`.mv-auth-brand` — הגרדיאנט של לוח המותג במסכי הכניסה */
  authGradient: ["#0c6e34", "#0a5b2b"] as const,
  /** ‏`icon.svg` — האריח הכהה מאחורי הסימן */
  tile: "#111513",
  /** ‏`.mv-list-row--new` / `--highlight` */
  rowNewBg: "#f4f9f5",
  rowHighlightBg: "#fdfaf3",
} as const;

/**
 * ‏גווני השורה בערכה הכהה — ל-`.mv-list-row--new` / `--highlight` אין
 * ‏ערך כהה ב-CSS, ולכן כאן הירוק הרך והרקע של האזהרה מהערכה הכהה.
 */
export const darkChrome = {
  rowNewBg: darkColors.primarySoft,
  rowHighlightBg: darkColors.warningBg,
} as const;

/**
 * ‏סולם הטיפוגרפיה — `--type-*` ב-`globals.css` (§1 בחבילת העיצוב),
 * ‏בפיקסלים. הרצפה 14px, ובלי משקל דק (docs/06 §4).
 */
export const type = {
  h1: 38,
  panel: 22,
  cardTitle: 18.5,
  rowTitle: 17.5,
  screenTitle: 19,
  button: 16,
  body: 15.5,
  bodySm: 15,
  caption: 14,
  captionLg: 14.5,
  counter: 30,
} as const;

/** ‏שמות קצרים שהמסכים משתמשים בהם — ממופים לסולם. */
export const font = {
  xs: type.caption,
  sm: type.bodySm,
  md: type.body,
  lg: type.rowTitle,
  xl: type.panel,
  xxl: type.h1,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** ‏`--radius` 22 לכרטיס, `--control-radius` 10 לשדה/כפתור, 15 לשורה (Tailwind `rounded-lg`). */
export const radius = {
  sm: 8,
  md: 10,
  row: 15,
  lg: 22,
  pill: 999,
} as const;

/** ‏`--shadow-card` — הצללה אחת לכל כרטיס במנוחה; בכהה (`--dk-shadow-card`) שחורה וקצרה. */
export const shadowCard = {
  shadowColor: "#101812",
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export const darkShadowCard = {
  shadowColor: "#000000",
  shadowOpacity: 0.4,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
} as const;

/** ‏`--mv-topbar-h` במובייל, ו-`--control-h`. */
export const TOPBAR_H = 64;
export const CONTROL_H = 42;

/** ‏גודל מגע מינימלי — ‎44pt‎, ת"י 5568 / WCAG 2.2 (Target Size). */
export const TOUCH = 44;
