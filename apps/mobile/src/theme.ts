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
  amberFg: "#8a6414",
  border: "#e3e7de",
  inputBorder: "#808a82",
  rowBorder: "#e7eae3",
  chipNeutralFg: "#3c443e",
  chipNeutralBg: "#eef1ec",
  tabActive: "#0b0e0c",
} as const;

/** ‏רצפת הטיפוגרפיה של המערכת: 14px, ובלי משקל דק (docs/06 §4). */
export const font = {
  xs: 14,
  sm: 15,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** ‏גודל מגע מינימלי — ‎44pt‎, ת"י 5568 / WCAG 2.2 (Target Size). */
export const TOUCH = 44;
