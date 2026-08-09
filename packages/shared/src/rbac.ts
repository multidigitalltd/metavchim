/**
 * RBAC מבוסס Capabilities — הקוד בודק תמיד יכולת, לעולם לא תפקיד גולמי.
 * (docs/04-security-privacy.md §3)
 */
export const CAPABILITIES = [
  "properties.view",
  "properties.create",
  "properties.edit",
  "properties.delete",
  "buyers.view_all",
  "buyers.view_own",
  "buyers.edit",
  "leads.view_all",
  "leads.view_own",
  "leads.edit",
  "offers.send",
  "matches.view",
  "matches.manage",
  "calendar.manage",
  "collaboration.share",
  "collaboration.offer",
  "billing.manage",
  "users.manage",
  "settings.manage",
  "data.export",
  "audit.view",
  /**
   * דוח המשרד: מספרי הלידים, הקונים החמים, ההצעות ושיעור ההמרה —
   * התמונה העסקית של הסוכנות. עד כה הוא נשמר מאחורי matches.view,
   * שיש גם ל-viewer, ולכן היה גלוי לכל מי שנכנס למערכת.
   */
  "analytics.view",
  /**
   * הטלת משימה על סוכן אחר.
   *
   * עד כה משימה נוצרה תמיד על שם היוצר, ולכן מנהל משרד לא יכול היה
   * להטיל דבר — מה שהפך את המודול לפנקס אישי במקום לכלי ניהול.
   * יכולת נפרדת ולא חלק מ-`calendar.manage`: לכל סוכן יש משימות
   * משלו, ולא לכל סוכן יש רשות להעמיס על אחרים.
   */
  "tasks.assign",
  /**
   * לוח המשימות של המשרד — לראות את מה שהוטל על כולם.
   *
   * אותו דפוס בדיוק כמו `buyers.view_all` ו-`leads.view_all`, ומופעל
   * דרך אותו `ownershipFilter`.
   */
  "tasks.view_all",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES.filter((c) => c !== "billing.manage"),
  agent: [
    "properties.view",
    "properties.create",
    "properties.edit",
    "buyers.view_own",
    "buyers.edit",
    "leads.view_own",
    "leads.edit",
    "offers.send",
    "matches.view",
    "matches.manage",
    "calendar.manage",
  ],
  assistant: [
    "properties.view",
    "properties.edit",
    "buyers.view_own",
    "leads.view_own",
    "leads.edit",
    "matches.view",
    "matches.manage",
    "calendar.manage",
  ],
  viewer: ["properties.view", "buyers.view_own", "leads.view_own", "matches.view"],
};
