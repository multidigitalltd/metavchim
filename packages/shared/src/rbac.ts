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
  /**
   * מחיקת כרטיס קונה — יכולת נפרדת מ-`buyers.edit`, כמו בליד ובנכס.
   *
   * הכרטיס נושא את כל ההיסטוריה: ביקושים, התאמות, הצעות שנשלחו
   * וציר הזמן. מחיקה היא החלטה ניהולית ולא חלק משגרת הטיפול.
   */
  "buyers.delete",
  "leads.view_all",
  "leads.view_own",
  "leads.edit",
  /**
   * מחיקת ליד — יכולת נפרדת מ-`leads.edit` בכוונה, כמו
   * `properties.delete` מול `properties.edit`.
   *
   * ליד ספאם או טעות במספר הוא זבל שצריך להיעלם, אבל מחיקה מוחקת
   * גם את ציר הזמן ואת איש הקשר שנשאר בלי כלום — ולכן היא החלטה
   * ניהולית ולא חלק משגרת הטיפול. בעל משרד שרוצה לתת אותה לסוכן
   * מעניק אותה במפורש במסך ההרשאות.
   */
  "leads.delete",
  /**
   * מחיקת לקוח מהמערכת — כל מה שקשור לאדם, לצמיתות.
   *
   * זו זכות המחיקה של הלקוח, לא ניקוי זבל: אדם שמבקש שהמשרד לא
   * יחזיק עליו מידע זכאי לכך, והמשרד חייב שתהיה לו דרך לבצע את זה
   * בלי לפנות לתמיכה. לכן היא יכולת של הנהלה (owner/admin) ולא של
   * שגרת הטיפול — היא מוחקת כרטיסי קונה, לידים, שיחות, הקלטות
   * והסכמים חתומים, ואי אפשר לחזור ממנה.
   */
  "contacts.delete",
  "offers.send",
  "matches.view",
  "matches.manage",
  "calendar.manage",
  "collaboration.share",
  "collaboration.offer",
  /**
   * שינוי תנאי שת"פ שסוכן אחר קבע — חלוקת עמלה, הערה, והורדה מהרשת.
   *
   * נפרדת מ-`collaboration.share` בדיוק כמו ש-`buyers.view_all`
   * נפרדת מ-`buyers.view_own`: לשתף זו שגרת עבודה, ולגעת בהתחייבות
   * שעמית נתן למשרד אחר זו החלטה ניהולית. בלי ההפרדה כל סוכן במשרד
   * יכול היה להוריד את חלקו של עמית מ-50% ל-34% על נכס שכבר מוצג
   * בלוח — בלי ידיעתו, ואחרי שמשרדים אחרים כבר ראו את התנאים.
   */
  "collaboration.manage_all",
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
  /**
   * מנהל סניף — מנהל את העבודה, לא את המשרד.
   *
   * הוא רואה את כל הלידים והקונים של הסניף, מטיל משימות, קורא את
   * דוח הביצועים ומנקה זבל. מה שאינו כאן חשוב לא פחות ממה שכן:
   *
   * - `settings.manage`, `billing.manage`, `users.manage` — אלה
   *   מגדירים את המשרד עצמו. מנהל סניף שיכול לשנות הרשאות יכול
   *   להעניק לעצמו כל יכולת אחרת, וההפרדה כולה מתאיינת.
   * - `audit.view` — יומן הביקורת הוא כלי הפיקוח **עליו**.
   * - `data.export` — ייצוא כל בסיס הלקוחות של המשרד לקובץ אחד.
   *   זו לא פעולה יומית אלא הסיכון של מנהל שעוזב, ולכן היא נשארת
   *   אצל מי שאחראי על המשרד.
   * - `contacts.delete` — זכות המחיקה של הלקוח, שמוחקת אדם מכל
   *   המערכת לצמיתות. מסומנת במפורש כיכולת של הנהלת המשרד.
   */
  branch_manager: [
    "properties.view",
    "properties.create",
    "properties.edit",
    "properties.delete",
    /*
     * `view_own` **וגם** `view_all`, ולא רק השני.
     *
     * הן לא שתי דרגות של אותה הרשאה: `view_own` היא כרטיס הכניסה
     * למודול והיא זו שנבדקת ב-`@RequireCapability` על נתיב
     * הרשימה, ו-`view_all` רק מרחיבה בתוכו את הסינון
     * (`ownershipFilter`). תפקיד שנושא רק את השנייה נחסם ב-403
     * במסך עצמו — כלומר „רואה את כל המשרד” ולא רואה כלום.
     *
     * הצירוף אינו סתירה אצל אף תפקיד קיים: owner ו-admin מחזיקים
     * בשתיהן ממילא, כי הם מקבלים את כל הקטלוג.
     */
    "buyers.view_own",
    "buyers.view_all",
    "buyers.edit",
    "buyers.delete",
    "leads.view_own",
    "leads.view_all",
    "leads.edit",
    "leads.delete",
    "offers.send",
    "matches.view",
    "matches.manage",
    "calendar.manage",
    "collaboration.share",
    "collaboration.offer",
    // מנהל סניף מתקן תנאים של סוכן שיצא לחופשה — זו בדיוק עבודתו
    "collaboration.manage_all",
    "analytics.view",
    "tasks.assign",
    "tasks.view_all",
  ],
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

/**
 * אילו תפקידים מחזיקים ביכולת הזו — לשאילתות ולתצוגה.
 *
 * הקוד בודק יכולת ולא תפקיד, אבל יש שני מקומות שבהם צריך את
 * הכיוון ההפוך: „למי לשלוח את ההתראה” ו„למי להראות את הפריט
 * בסרגל”. שניהם החזיקו רשימה כתובה ביד — `["owner", "admin"]` —
 * ולכן תפקיד חדש עם אותה יכולת בדיוק לא היה מקבל את ההתראה ולא
 * היה רואה את המסך, בלי שום שגיאה שמישהו יראה.
 *
 * **אינה תחליף לבדיקת יכולת.** היא מתעלמת מחריגי ההרשאות
 * הפרטניים של המשתמש (`capability-overrides`), ולכן היא בסדר
 * לניתוב ולניסוח התראה — ואסורה כשער גישה.
 */
export function rolesWithCapability(capability: Capability): string[] {
  return Object.keys(ROLE_CAPABILITIES).filter((role) =>
    (ROLE_CAPABILITIES[role] ?? []).includes(capability),
  );
}
