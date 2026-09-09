import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  contactIdsFromSources,
  contactSourcesOf,
  effectiveCapabilities,
  leadIsVisibleWith,
  seesAllContactsWith,
  visibleContactFilters,
  type Capability,
} from "@metavchim/shared";
import type { TenantTx } from "../core/prisma.service";
import { TenantContext } from "./tenant-context";

/**
 * אכיפת "רק שלי" (view_own מול view_all): מחזיר תנאי Where לצמצום
 * שאילתה לרשומות של המשתמש הנוכחי, אלא אם יש לו יכולת view_all.
 * מוחל גם על נתיב רשימה וגם על שליפה בודדת — ידיעת ID אינה הרשאה
 * (מניעת IDOR בתוך הדייר; docs/04 §1).
 */
export function ownershipFilter(
  viewAllCapability: Capability,
  ownerField: string,
): Record<string, string> {
  const ctx = TenantContext.current();
  if (ctx.capabilities.has(viewAllCapability)) {
    return {};
  }
  return { [ownerField]: ctx.userId };
}

/**
 * ‎**ליד בלי סוכן משויך שייך לערימה המשותפת — לא לאיש.**
 *
 * ## מה היה שבור
 *
 * ‏`ownershipFilter` מייצר `{ assignedToUserId: <אני> }`, ו-NULL
 * אינו שווה לכלום ב-SQL — כלומר ליד לא-משויך אינו מתאים **לאף
 * סוכן**. הוא אינו „של מישהו אחר”; הוא בלתי נראה.
 *
 * וזה בדיוק המצב שנוצר הכי הרבה: `openLeadForUnknownCaller` כותב
 * ‎`assignedToUserId = null` בכל שיחה שלא הגיעה דרך מספר וירטואלי
 * עם סוכן משויך — כלומר רוב השיחות ממספר לא מוכר. ההערה שם אפילו
 * מנמקת את הנפילה ל-null במילים „ליד בלתי נראה גרוע מליד בערימה
 * המשותפת” — אבל null **הוא** הבלתי נראה. הנפילה שנועדה למנוע את
 * הבעיה הייתה הבעיה.
 *
 * ## ומה זה עשה ליומן השיחות
 *
 * ‏`visibleContactIds` אוסף לקוחות דרך הלידים שלהם, ולכן הלקוח
 * שנפתח מהשיחה לא נכנס לרשימה. ואז ארבעת הענפים של
 * ‎`visibleCallsCondition` נכשלים כולם: השיחה נושאת `contact_id`
 * (ולכן שני הענפים של „בלי איש קשר” אינם חלים) ו-`created_by` ריק
 * (וובהוק, לא אדם). התוצאה: **מסך שיחות ריק לכל סוכן בלי
 * ‎`view_all`, בזמן שהמסד מלא.** בעל המשרד ראה הכול, ולכן זה שרד.
 *
 * הענף „בלי בעלים ובלי איש קשר” נכתב בדיוק נגד התקלה הזו — אבל
 * ברגע שנפתח ליד נוצר גם `contact_id`, והענף מפסיק לחול. החור
 * נפתח מחדש צעד אחד קדימה.
 *
 * ## למה זו אינה הרחבת הרשאות
 *
 * ‏„לא משויך” פירושו שאין סוכן שהליד שייך לו. אין כאן לקוח של
 * עמית שנחשף — יש לקוח שאיש לא לקח. ליד משויך נשאר מוסתר בדיוק
 * כמו קודם, וגבול הדייר (RLS) לא זז.
 *
 * ## ‎**ומי שהמודול חסום אצלו אינו מקבל את הערימה**
 *
 * ‏`ownershipFilter` הגולמי היה בטוח כאן **במקרה**: הוא ייצר
 * ‎`{ assignedToUserId: <אני> }`, ולמי שמודול הלידים חסום אצלו כמעט
 * אף ליד אינו משויך, ולכן הוא קיבל רשימה ריקה. הערימה המשותפת
 * מבטלת את המקריות הזו — ובלי שער היא נפתחת דווקא למי שנחסם
 * (ביקורת Codex, P1).
 *
 * וזה אינו תיאורטי: `ContactsController.related` מוצהר
 * ‎`@AnyAuthenticated()`, וההערה שם אומרת במפורש שההרשאה „נאכפת
 * בתוך השאילתה עצמה” — כלומר כאן. `CoachService` דורש
 * ‎`matches.view` בלבד, ומסלולי ההמרה דורשים יכולות של קונים
 * ונכסים. בכל אחד מהם הסינון הזה הוא ההרשאה.
 *
 * ‎`view_own` הוא הסף: בלעדיו נדרשת קבוצה שלא תתאים לשום שורה,
 * ולא אובייקט ריק — ריק פירושו „בלי סינון”, כלומר ההפך הגמור.
 */
export function leadOwnershipFilter(): Prisma.LeadWhereInput {
  const ctx = TenantContext.current();
  if (ctx.capabilities.has("leads.view_all")) return {};
  if (!ctx.capabilities.has("leads.view_own")) return { id: { in: [] } };
  return { OR: [{ assignedToUserId: ctx.userId }, { assignedToUserId: null }] };
}

/**
 * ‎**אותו כלל, לקורא שאינו יכול לקבל אובייקט Prisma.**
 *
 * שני מקומות מכריעים אותו בעצמם — חישוב בוליאני ב-`LeadsService`
 * ותנאי ב-SQL גולמי ב-`TasksService` — ושניהם החזיקו העתק ידני של
 * „שלי או `view_all`”. העתק שלישי שאינו מכיר את הערימה המשותפת הוא
 * בדיוק הדרך שבה התיקון הזה נשחק (שתי ביקורות Codex).
 *
 * ‎`null` = „אין הגבלה”, ולכן הוא מתאים גם ל-SQL שמשווה מול פרמטר
 * שעשוי להיות NULL.
 */
export function leadPoolOwner(): string | null {
  const ctx = TenantContext.current();
  return ctx.capabilities.has("leads.view_all") ? null : ctx.userId;
}

/** האם הליד הזה נגיש לי — שלי, של אף אחד, או שאני רואה הכול. */
export function leadIsVisible(assignedToUserId: string | null): boolean {
  const ctx = TenantContext.current();
  /* ‏הכלל עצמו בחבילה המשותפת — גם העובד שואל אותו */
  return leadIsVisibleWith(ctx.capabilities, ctx.userId, assignedToUserId);
}

/**
 * ‎**אותו כלל בדיוק, בצורת SQL — לשורה שנושאת `lead_id`.**
 *
 * ‏זו אינה הרחבה של `leadIsVisible` אלא התרגום שלו: שלושת הענפים
 * ‏כאן הם שלושת הענפים שם, בסדר הזה. שיחה בלי `lead_id` אינה
 * ‏נוגעת לכלל הזה כלל, ולכן היא עוברת.
 *
 * ‏`lead_id` שמצביע לשורה שאינה קיימת **אינו** חוסם — מחיקת ליד
 * ‏מאפסת את העמודה (`LeadsService.remove`), ולכן שורה כזו היא
 * ‏שריד ולא ליד של מישהו. חסימה כאן הייתה מעלימה תיעוד ישן בלי
 * ‏שאיש יגן עליו, וזה בדיוק ההפך ממה שהכלל מבקש.
 */
export function visibleLeadCondition(alias: OrphanAlias): Prisma.Sql {
  const ctx = TenantContext.current();
  if (ctx.capabilities.has("leads.view_all")) return Prisma.sql`TRUE`;
  const t = Prisma.raw(alias);
  if (!ctx.capabilities.has("leads.view_own")) {
    return Prisma.sql`
      (${t}.lead_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM leads l
                       WHERE l.tenant_id = ${t}.tenant_id
                         AND l.id = ${t}.lead_id))`;
  }
  return Prisma.sql`
    (${t}.lead_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM leads l
                     WHERE l.tenant_id = ${t}.tenant_id
                       AND l.id = ${t}.lead_id
                       AND l.assigned_to_user_id IS NOT NULL
                       AND l.assigned_to_user_id <> ${ctx.userId}))`;
}

/**
 * שערי גישה לישות בודדת **לפני פעולה עליה**.
 *
 * למה הם קיימים: `ownershipFilter` הוחל בעקביות על נתיבי הקריאה
 * (list/getById), אבל נתיבי הכתיבה והפעולה שלפו לפי `{ id, tenantId }`
 * בלבד. התוצאה הייתה שסוכן עם `view_own` לא יכול היה *לראות* ליד של
 * סוכן אחר — אבל כן יכול היה לשנות את הסטטוס שלו, לכתוב בו הערה,
 * ולשלוף את מספר הטלפון של הקונה דרך הכנת הודעת וואטסאפ.
 *
 * הכלל הוא אותו כלל; מה שחסר היה מקום אחד לקרוא לו ממנו. פונקציה
 * שצריך לקרוא לה במפורש עדיין אפשר לשכוח, אבל שורה אחת בראש הפעולה
 * קלה לראות בביקורת מאשר תנאי Where שחסר בתוכה.
 *
 * כולן זורקות 404 ולא 403: תשובה שונה לישות קיימת-אך-לא-שלי מסגירה
 * את קיומה, ואת הקיום עצמו אין למשתמש הזה הרשאה לדעת.
 */

/** ליד: הבעלות היא הסוכן המשויך. */
export async function assertLeadAccess(
  tx: TenantTx,
  tenantId: string,
  leadId: string,
): Promise<void> {
  const lead = await tx.lead.findFirst({
    where: { id: leadId, tenantId, ...leadOwnershipFilter() },
    select: { id: true },
  });
  if (!lead) throw new NotFoundException("ליד לא נמצא");
}

/** קונה: הבעלות היא הסוכן המטפל; קונה מחוק אינו נגיש לפעולה. */
export async function assertBuyerAccess(
  tx: TenantTx,
  tenantId: string,
  buyerId: string,
): Promise<void> {
  const buyer = await tx.buyer.findFirst({
    where: {
      id: buyerId,
      tenantId,
      deletedAt: null,
      ...ownershipFilter("buyers.view_all", "ownerUserId"),
    },
    select: { id: true },
  });
  if (!buyer) throw new NotFoundException("קונה לא נמצא");
}

/**
 * הצורה ה**מוותרת** של השערים: "האם הכרטיס הזה נגיש לי", בלי לזרוק.
 *
 * קיימת כי לא כל שימוש הוא שער. שיוך תזכורת לכרטיס הוא שיפור ולא
 * תנאי: כרטיס לא-נגיש פשוט אינו נקשר, והתזכורת נוצרת בלעדיו — שגיאה
 * שם הייתה מפילה פעולה שהמשתמש כן ביקש.
 *
 * **שם עמודת הבעלות נכתב כאן ולא אצל הקורא, וזו כל הנקודה.** קונה
 * מסומן ב-`ownerUserId` וליד ב-`assignedToUserId`; `ownershipFilter`
 * מקבל מחרוזת ולכן טעות בשם אינה נתפסת בהידור אלא בזמן ריצה, כשהיא
 * כבר שגיאת Prisma על ארגומנט לא מוכר — ודווקא אצל המשתמש המוגבל,
 * זה שהפילטר בכלל חל עליו (ביקורת Codex, P1). שני השמות חיים כאן,
 * ליד `assertBuyerAccess` שכבר מכיר אותם.
 */
export async function isCardAccessible(
  tx: TenantTx,
  tenantId: string,
  kind: "buyer" | "lead",
  id: string,
): Promise<boolean> {
  const found =
    kind === "buyer"
      ? await tx.buyer.findFirst({
          where: {
            id,
            tenantId,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
          select: { id: true },
        })
      : await tx.lead.findFirst({
          where: {
            id,
            tenantId,
            ...leadOwnershipFilter(),
          },
          select: { id: true },
        });
  return found !== null;
}

/**
 * התאמה: אין לה בעלים משלה — היא זוג (נכס, קונה). הנכסים גלויים לכל
 * המשרד, ולכן מי שרשאי לפעול על ההתאמה נגזר מהקונה שבה.
 */
export async function assertMatchAccess(
  tx: TenantTx,
  tenantId: string,
  matchId: string,
): Promise<void> {
  const match = await tx.match.findFirst({
    where: { id: matchId, tenantId },
    select: { buyerId: true },
  });
  // אותה הודעה בשני המקרים: "ההתאמה לא קיימת" ו"הקונה שבה אינו שלי"
  // חייבים להיראות זהים, אחרת ההבדל עצמו מסגיר שההתאמה קיימת.
  if (!match) throw new NotFoundException("התאמה לא נמצאה");
  const buyer = await tx.buyer.findFirst({
    where: {
      id: match.buyerId,
      tenantId,
      deletedAt: null,
      ...ownershipFilter("buyers.view_all", "ownerUserId"),
    },
    select: { id: true },
  });
  if (!buyer) throw new NotFoundException("התאמה לא נמצאה");
}

/**
 * איש קשר: אין לו בעלים משלו — הוא אדם שמופיע ככרטיס קונה, כליד או
 * כבעלים של נכס. הרשות לגעת בו נגזרת מהישויות שמצביעות עליו.
 *
 * בלי השער הזה כל משתמש מחובר היה יכול לקרוא ולשנות את מספרי הטלפון
 * של הלקוחות של סוכן אחר לפי מזהה — אותה משפחת תקלות שנסגרה ב-#66,
 * והפעם על ה-PII עצמו ולא על מטא-דאטה.
 *
 * נכסים גלויים לכל המשרד בכוונה (אין להם פילטר בעלות), ולכן בעל נכס
 * נגיש לכל סוכן — זו התנהגות קיימת ולא הקלה חדשה.
 */
/**
 * מזהי אנשי הקשר שהמשתמש רשאי לראות — `null` = אין הגבלה.
 *
 * זו הצורה ה**קבוצתית** של `assertContactAccess`, לנתיבי רשימה.
 * שתיהן מבטאות בדיוק את אותו כלל: הלקוח נגיש אם הוא כרטיס קונה
 * שלי, ליד שמשויך אליי, או בעל נכס כלשהו (נכסים גלויים לכל המשרד
 * בכוונה). כל שינוי בכלל חייב להיעשות בשתיהן — `recording-access.test.ts`
 * מריץ את שני המסלולים על אותם נתונים ומשווה.
 *
 * המחיר הוא שלוש שליפות של מזהים בלבד, פעם אחת לבקשה. החלופה —
 * `assertContactAccess` לכל שורה — הייתה שאילתה נפרדת לכל שיחה
 * בעמוד, כלומר בדיוק ה-N+1 שהמודול הזה כבר תיקן פעם אחת.
 */
/**
 * דרך איזה מודול מותר לו להגיע ללקוח.
 *
 * הכלל „כרטיס קונה שלי, ליד שמשויך אליי, או בעל נכס” תיאר **בעלות**
 * בלבד, והניח שמי שהגיע לנתיב מחזיק ממילא את המודול — הנחה שהייתה
 * נכונה כל עוד כל נתיב הצהיר על מודול אחד. ברגע שנתיב מצהיר על שתי
 * יכולות חלופיות היא נשברת: מי שמודול הלידים חסום אצלו נכנס בזכות
 * הקונים, וקיבל גם את הלידים ובעלי הנכסים (ביקורת Codex).
 *
 * לכן המקור עצמו נבדק, לא רק הבעלות: מודול חסום אינו תורם לקוחות.
 */
/*
 * ‎**המדיניות עברה ל-`@metavchim/shared`** (ביקורת Codex, P1).
 *
 * ‏אותה שאלה נשאלת גם בסבב ההתראות של העובד, והוא אינו יכול
 * ‏לייבא מכאן — ולכן „הגבול נאכף בקריאה” נעצר בגבול החבילה,
 * ‏וההתראה יצאה בוואטסאפ עם מה שהמסך כבר הסתיר. הייצוא נשאר כאן
 * ‏כדי ששלושים ושבעה הקוראים בשרת לא ישתנו.
 */
export { contactSourcesOf, seesAllContactsWith };

function contactSources(): { buyers: boolean; leads: boolean; properties: boolean } {
  return contactSourcesOf(TenantContext.current().capabilities);
}

/**
 * רואה כל לקוח במשרד — ולכן אין מה לסנן.
 *
 * „בלי הגבלה” רק כשבאמת אין מה להגביל: כל הקונים, כל הלידים,
 * ומודול הנכסים פתוח. חסר אחד מהשלושה והקיצור היה מחזיר לקוחות
 * ממקור חסום דווקא למי שהכי הרבה פתוח אצלו.
 *
 * מיוצא כי אותו קיצור קיים גם בשער השיחה הבודדת. שלושה עותקים של
 * התנאי הזה כבר נפרדו זה מזה פעם אחת — התיקון הקודם עדכן שניים
 * מהם והשאיר את השלישי מאחור (ביקורת Codex), וכך נפתחה הקלטה של
 * בעל נכס למי שמודול הנכסים חסום אצלו. ניסוח אחד, שלושה קוראים.
 */
export function seesAllContacts(): boolean {
  return seesAllContactsWith(TenantContext.current().capabilities);
}

/**
 * ‎**פעולה שאין לה גרסה חלקית — או על כל אנשי המשרד, או בכלל לא.**
 *
 * ‏מסך הכפילויות הוא המקרה: הוא סורק את **כל** אנשי הקשר של המשרד,
 * ‏מפענח שם וטלפון של כל התאמה, ומציע למזג — כלומר לכתוב מחדש
 * ‏ולמחוק. הוא הוצהר על `buyers.view_all` בלבד, ולכן מי שהמנהל
 * ‏חסם ממנו את בעלי הנכסים קיבל דרכו בדיוק אותם אנשים (ביקורת
 * ‏Codex, P1).
 *
 * ‎**וסינון לא היה התשובה כאן.** ההערה על הנתיב אומרת את הסיבה
 * ‏מראש: „הצעת מיזוג על סמך חצי תמונה היא הצעה למחוק כרטיס שהוא
 * ‏לא רואה”. רשימת כפילויות מסוננת הייתה בדיוק חצי תמונה — אותה
 * ‏תקלה שהצהרת ה-`view_all` נועדה למנוע, רק שקטה יותר. מה שהשתנה
 * ‏הוא ש„ראייה רוחבית על הלקוחות” כבר אינה יכולת אחת אלא ארבע.
 *
 * ‎403 ולא 404: כאן אין מה להסתיר. הפעולה קיימת, והתשובה הנכונה
 * ‏למי שאינו רשאי לה היא שהיא אינה פתוחה בפניו — כדי שמנהל שחסם
 * ‏יכולת יבין למה המסך נעלם, ולא יחפש תקלה.
 */
/**
 * ‎**האם המשרד בכלל צמצם למישהו את ראיית הלקוחות.**
 *
 * ‏קיימת בשביל מקום אחד: התראה שנכתבת **לכל המשרד** (`userId: null`)
 * ‏ונושאת זהות. `NotificationsService.visible()` מציגה אותה לכולם,
 * ‏ואין לה שער לפי לקוח — כלומר היא PII שיושב בטקסט חופשי, אותו
 * ‏סוג בדיוק שנמצא בהערות המשימה.
 *
 * ‎**ולמה אגרגט ולא בדיקה לכל משתמש.** התראת „מי מתקשר” נועדה
 * ‏להגיע למי שנמצא ליד הטלפון, ואין מיפוי אמין משלוחה למשתמש —
 * ‏זו החלטת מוצר שכתובה במפורש ב-`TelephonyService`. חישוב „מי
 * ‏זכאי” לכל שיחה היה מחליף אותה בהחלטה אחרת. השאלה הצרה כאן היא
 * ‏רק **האם ההפרדה בכלל הופעלה במשרד הזה**: לא — ההתנהגות זהה למה
 * ‏שהייתה, בלי שינוי לאף משרד שלא ביקש דבר; כן — הזהות יורדת
 * ‏מההתראה המשרדית, ומי שהלקוח שייך לו מקבל אותה אישית.
 *
 * ‏שאילתה אחת על אינדקס, ורק בנתיב הזה.
 */
/* ────────────────  בעלות על לקוח בהתראה  ──────────────── */

/**
 * ‎**מי הבעלים של ההתראה על מייל נכנס — שלושת המקורות, לפי סדר.**
 *
 * ‏מיוצא וטהור כדי שיהיה **ניתן לבדיקה**: `processInbound` נוגע
 * ‏באחסון, בשליחה ובאנשי הקשר, ובדיקה שלו כולו הייתה מכשיר גדול
 * ‏שבודק הכול חוץ מהכלל.
 *
 * ‏הסדר אינו שרירותי: כרטיס קונה הוא הקשר ההדוק ביותר, ליד אחריו,
 * ‏ובעלות על נכס אחרונה — היא הרחבה של אותו לקוח ולא זהות נפרדת.
 *
 * ‎`null` פירושו „אין בעלים”, ו-`NotificationsService.visible()`
 * ‏מציג התראה כזו **לכל המשרד**. לכן השורה הזו היא גבול פרטיות ולא
 * ‏נוחות: לקוח שהוא רק בעל נכס נפל בעבר ל-`null`, והתמצית של גוף
 * ‏המייל הוצגה לכולם (ביקורת Codex, P1).
 */
/**
 * ‎**מי הקליד את המספר.**
 *
 * ‏זו ההכרעה שמפרידה „סוכן שמנסה מספר במסך” מ„אדם שמסר את המספר
 * ‏שלו”, והיא נשאלת בכל מקום שיוצר כרטיס לקוח מטלפון. הטיפוס יושב
 * ‏כאן ולא ליד קורא אחד כדי ששלושת המסלולים — נכס, קונה, ליד —
 * ‏ידברו באותן שתי מילים. ראו `ContactsService.findOrCreateByPhoneTyped`.
 */
export type PhoneTypedBy = "agent" | "office";

export type ContactOwnerSource = "buyers" | "leads" | "properties";

export interface ContactOwner {
  userId: string;
  /**
   * ‎**השורה שדרכה הוא נמצא** (ביקורת Codex, P2).
   *
   * ‏„המקור” אומר איזו יכולת נבדקת; **הכרטיס** אומר לאן לקשר. הם
   * ‏נלקחו בנפרד: הבחירה נפלה על בעלים של כרטיס ותיק, והקישור
   * ‏נכתב על הכרטיס החדש — שאותו הנמען דווקא אינו יכול לפתוח,
   * ‏בעוד הכרטיס שלו נשאר בלי שורה בציר הזמן.
   *
   * ‎`null` לענף הנכסים: אין שם כרטיס לתלות עליו אינטראקציה.
   */
  cardId: string | null;
  /**
   * ‎**דרך איזה מקור הוא נמצא — וזו אינה עובדה לתיעוד.**
   *
   * ‏„רשאי לראות את הלקוח” אינה שאלה אחת: מי שנמצא דרך כרטיס קונה
   * ‏זקוק ליכולת הקונים, מי שנמצא דרך ליד ליכולת הלידים, ומי שנמצא
   * ‏כסוכן הנכס למודול הנכסים. בלי המקור אי אפשר לשאול את השאלה
   * ‏הנכונה, ו„יש לו משהו” הוא בדיוק הקיצור שכבר נשבר כאן פעם.
   */
  source: ContactOwnerSource;
}

/**
 * ‎**כל השיוכים בכל מקור, החדש ראשון — ולא שורה אחת לכל מקור**
 * ‏(ביקורת Codex, P2).
 *
 * ‏הסבב הקודם לימד **מקור** שנפסל להוריש את התור למקור הבא. אותו
 * ‏כשל בדיוק חזר שכבה אחת פנימה: קונה אינו ייחודי ללקוח —
 * ‏`createWithin` מוסיף כרטיס חדש בכל פעם — ולכן „הכרטיס האחרון”
 * ‏הוא מועמד אחד מתוך כמה. אם בעליו אינו פעיל או שמודול הקונים
 * ‏חסום אצלו, כרטיס ותיק יותר של סוכן כשר מעולם לא נשאל, וההתראה
 * ‏נפלה למקור אחר או נשארה משרדית וחסרת תוכן.
 *
 * ‏הסדר נשמר — קונים, לידים, נכסים, ובכל מקור החדש ראשון — ומה
 * ‏שהשתנה הוא שהפסילה יכולה ליפול הלאה **גם בתוך** המקור.
 */
export interface ContactOwnerSources {
  buyers: readonly { id: string; ownerUserId: string | null }[];
  leads: readonly { id: string; assignedToUserId: string | null }[];
  properties: readonly { agentUserId: string | null }[];
}

/**
 * ‎**שלוש השליפות, פעם אחת — לשני הקוראים.**
 *
 * ‏השיחה הנכנסת והתיבה שאלו את אותה שאלה בשני עותקים, ושניהם
 * ‏שלפו שורה אחת לכל מקור. עותק אחד תוקן פעם, והשני נשאר מאחור —
 * ‏ולכן השאילתה עצמה יושבת כאן, ליד הכלל שצורך אותה.
 *
 * ‎`distinct` על עמוד הבעלות ולא `take` שרירותי: מה שמעניין הוא
 * ‏רשימת **הבעלים** האפשריים, והיא חסומה ממילא בגודל המשרד. שורה
 * ‏שנייה של אותו בעלים אינה מועמד נוסף.
 *
 * ‏השורה הראשונה בכל מערך היא עדיין החדשה ביותר, ולכן קורא שזקוק
 * ‏ל„כרטיס הקונה הנוכחי” מקבל אותה מכאן ואינו שולף בעצמו.
 */
export async function loadContactOwnerSources(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
): Promise<ContactOwnerSources> {
  const [buyers, leads, properties] = await Promise.all([
    tx.buyer.findMany({
      where: { tenantId, contactId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      distinct: ["ownerUserId"],
      select: { id: true, ownerUserId: true },
    }),
    tx.lead.findMany({
      where: { tenantId, contactId },
      orderBy: { createdAt: "desc" },
      distinct: ["assignedToUserId"],
      select: { id: true, assignedToUserId: true },
    }),
    tx.property.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ ownerContactId: contactId }, { occupantContactId: contactId }],
        /*
         * ‎**העדפה ולא סינון:** ללקוח שיש לו גם נכס משויך וגם נכס
         * ‏שאינו משויך, הבעלים הוא הסוכן של המשויך. כשכל נכסיו
         * ‏אינם משויכים אין בעלים — וזה נענה בשלילת התוכן, לא
         * ‏בהוצאת שורה.
         */
        agentUserId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      distinct: ["agentUserId"],
      select: { agentUserId: true },
    }),
  ]);
  return { buyers, leads, properties };
}

/**
 * ‎**כל המועמדים לפי הסדר — ולא רק הראשון.**
 *
 * ‏„הראשון” היה נכון כשהשאלה הייתה „מי משויך”. מרגע שהשאלה היא „מי
 * ‏משויך **ורשאי**”, מועמד שנפסל חייב להוריש את התור לבא אחריו:
 * ‏לקוח שכרטיס הקונה שלו שייך לסוכן חסום ושהליד שלו שייך לסוכן
 * ‏כשר היה מאבד את שניהם — האחד נפסל, השני מעולם לא נבדק (ביקורת
 * ‏Codex). רשימה ולא ערך יחיד, כדי שהפסילה תוכל ליפול הלאה.
 */
export function contactOwnerCandidates(
  sources: ContactOwnerSources,
  /**
   * ‎**הסוכן ששלח את ההודעה שעליה עונים — עולה לראש התור.**
   *
   * ‏הסדר הרגיל עונה על „מי אחראי על הלקוח”, וזו השאלה הנכונה
   * ‏לשיחה נכנסת שאיש לא יזם. תשובה במייל אינה כזו: יש לה **הודעה
   * ‏קודמת**, ולה יש שולח. סוכן ב׳ שלח הסכם על נכס שלו ללקוח
   * ‏שגם לסוכן א׳ יש עליו כרטיס קונה — והתשובה נחתה אצל א׳, כי
   * ‏„קונים” קודם ל„נכסים” בתור.
   *
   * ‎**וזו העדפה, לא עקיפה.** המועמדות של השולח נשארת מועמדות:
   * ‏היא עוברת בדיוק את אותה בדיקת הרשאה של כל השאר, ואם הוא
   * ‏נפסל — איבד את הכרטיס, נשללה ממנו היכולת — התור ממשיך כרגיל.
   * ‏השורות שלו עולות **בשמירת הסדר היחסי** ביניהן, כדי שהשאלה
   * ‏„דרך איזה מקור” תיענה כמו תמיד.
   *
   * ‎`undefined` — אין הודעה קודמת (שיחה נכנסת, טוקן ותיק מלפני
   * ‏השדה), והסדר הרגיל הוא התשובה הנכונה.
   */
  preferUserId?: string | null,
): ContactOwner[] {
  const ordered: ContactOwner[] = [];
  const seen = new Set<string>();
  const push = (
    userId: string | null,
    source: ContactOwnerSource,
    cardId: string | null,
  ): void => {
    if (userId === null) return;
    /*
     * ‎**המפתח הוא הצמד, ולא המשתמש** (ביקורת Codex, P2).
     *
     * ‏„רשאי לראות את הלקוח” אינה שאלה אחת: מי שנמצא דרך כרטיס
     * ‏קונה נשאל על יכולת הקונים, ומי שנמצא דרך ליד על יכולת
     * ‏הלידים. אותו אדם יכול להיות חסום באחת ומורשה בשנייה —
     * ‏ואיחוד לפי משתמש בלבד השאיר את המועמדות הראשונה, הפיל
     * ‏אותה, ומעולם לא שאל על הליד שהוא כן יכול לפתוח. ההתראה
     * ‏הפכה למשרדית וחסרת תוכן במקום להגיע אליו.
     *
     * ‏כפילות אמיתית — אותו אדם דרך שני כרטיסי קונה — עדיין נחסמת,
     * ‏כי היא אותו צמד בדיוק.
     */
    const key = `${source}:${userId}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ userId, source, cardId });
  };
  for (const row of sources.buyers) push(row.ownerUserId, "buyers", row.id);
  for (const row of sources.leads) push(row.assignedToUserId, "leads", row.id);
  for (const row of sources.properties) push(row.agentUserId, "properties", null);
  if (preferUserId === undefined || preferUserId === null) return ordered;
  return [
    ...ordered.filter((candidate) => candidate.userId === preferUserId),
    ...ordered.filter((candidate) => candidate.userId !== preferUserId),
  ];
}

/**
 * ‎**התראה שאין לה בעלים מגיעה לכל המשרד — ולכן אסור שתישא תוכן.**
 *
 * ‏התיקון הקודם נתן בעלים לבעל נכס, ועצר שם. נשאר מקרה שהוא
 * ‏**בדיוק אותה דליפה**: נכס בלי סוכן משויך (`agentUserId = null`),
 * ‏קונה בלי `ownerUserId`, ליד בלי `assignedToUserId`. בכל אלה
 * ‏הבעלים הוא `null`, ההתראה משרדית — ותמצית גוף המייל מוצגת לכל
 * ‏המשרד, בזמן שהשיחה עצמה מוסתרת בתיבה (ביקורת Codex, P1).
 *
 * ‏הכלל נגזר מהתנאי ואינו רשימת מקרים: **`userId` ריק פירושו „לא
 * ‏הצלחנו לזהות מי זכאי”**, וזו בדיוק הסיבה שאסור לצרף תוכן. הוא
 * ‏מכסה גם את המקרה שאיש לא מנה — לקוח בלי קונה, בלי ליד ובלי נכס
 * ‏כלל, שאינו נראה בתיבה לאיש.
 *
 * ‎**וההתראה נשארת.** מחיקתה הייתה מסתירה מייל של נכס לא-משויך
 * ‏מכולם, כולל מהמנהל שכן רשאי לראותו. מה שנשלל הוא התוכן, לא
 * ‏הידיעה שהגיע דבר מה — והכותרת אומרת מפורשות לאן ללכת.
 */

/**
 * ‎**היכולות בפועל של כל משתמשי המשרד — תפקיד ועליו החריגים שבתוקף.**
 *
 * ‏שאילתה אחת עם החריגים בצירוף, ולא שאילתה למשתמש: המשרד נשאל
 * ‏כאן על **כולו**, ולולאת שאילתות הייתה הופכת שאלה אחת לעשרות.
 * ‏התפוגה מסוננת בקוד ולא ב-SQL — `resolveCapabilities` היא
 * ‏שמכריעה, וזו אותה הכרעה שהכניסה למערכת עושה.
 */
async function officeCapabilities(
  tx: TenantTx,
  tenantId: string,
  userIds?: readonly string[],
): Promise<Map<string, Set<Capability>>> {
  const now = new Date();
  /*
   * ‎**וגם חסימת המודולים של הפלטפורמה — השכבה השלישית.**
   *
   * ‏„היכולות בפועל” הן תפקיד, ועליו חריגי המנהל, ועליהם חסימת
   * ‏המודולים. דילגתי על השלישית, ולכן משרד של בעלים בלבד שמודול
   * ‏הנכסים חסום לו נקרא כ„כולם רואים הכול” — והשם המפוענח של בעל
   * ‏נכס יצא בהתראה משרדית (ביקורת Codex, P1).
   *
   * ‏הסדר זהה לזה שבכניסה למערכת ואינו מקרי: חריג `deny` של מנהל
   * ‏המשרד נמחק בלחיצה שלו, וחסימה שהנחסם יכול להסיר אינה חסימה.
   */
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { blockedModules: true },
  });
  const blocked = tenant?.blockedModules ?? [];
  const users = await tx.user.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(userIds === undefined ? {} : { id: { in: [...userIds] } }),
    },
    select: {
      id: true,
      role: true,
      capabilityOverrides: {
        select: { capability: true, effect: true, expiresAt: true },
      },
    },
  });
  return new Map(
    users.map((user) => [
      user.id,
      effectiveCapabilities(
        { role: user.role, overrides: user.capabilityOverrides, blockedModules: blocked },
        now,
      ),
    ]),
  );
}

/**
 * ‎**האם יש במשרד הזה הפרדה בין סוכנים — לפי היכולות, לא לפי חריגים.**
 *
 * ## ‏מה היה שגוי
 *
 * ‏השאלה נשאלה כ„האם קיימת שורת חסימה”, וזו שאלה על **הכוונון**
 * ‏ולא על המצב. ההפרדה קיימת במשרד ברירת-מחדל בלי שאיש כיוון דבר:
 * ‏`agent`, `assistant` ו-`viewer` מקבלים `buyers.view_own`
 * ‏ו-`leads.view_own` בלבד, ולכן סוכן אחד אינו יכול להגיע לקונה של
 * ‏עמיתו דרך `visibleContactIds`. התשובה „אין הפרדה” הייתה מציגה
 * ‏את שמו המפוענח של אותו לקוח בהתראה משרדית — בדיוק מה שהתיבה
 * ‏מסתירה (ביקורת Codex, P1).
 *
 * ## ‏השאלה הנכונה
 *
 * ‏„האם **כל** מי שיקבל את ההתראה המשרדית רשאי לראות כל לקוח”,
 * ‏והיא נשאלת באותו ניסוח שהשער הבודד משתמש בו — `seesAllContactsWith`
 * ‏— ולא בעותק שני שאפשר לעדכן אחד מהם ולשכוח את השני.
 *
 * ‏משרד בלי משתמשים פעילים נחשב מוגבל: „לא מצאנו למי זה מגיע” אינו
 * ‏„מותר לכולם”, וממילא אין למי לשלוח.
 */
export async function officeRestrictsContactVisibility(
  tx: TenantTx,
  tenantId: string,
): Promise<boolean> {
  const caps = await officeCapabilities(tx, tenantId);
  if (caps.size === 0) return true;
  return [...caps.values()].some((set) => !seesAllContactsWith(set));
}

/**
 * ‎**מי מקבל התראה אישית על הלקוח — ורק אם הוא באמת רשאי לראותו.**
 *
 * ## ‏למה השיוך לבדו אינו הרשאה
 *
 * ‏„הקונה משויך לסוכן” ו„הסוכן רשאי לראות את הקונה” נראו כאן כאותו
 * ‏דבר. הם אינם: מנהל המשרד יכול לחסום `buyers.view_own` מסוכן
 * ‏מסוים, ואז אותו סוכן אינו מגיע לכרטיס בשום מסך — אבל השיוך על
 * ‏השורה נשאר, וההתראה האישית הייתה נכתבת אליו עם השם המפוענח,
 * ‏הטלפון והקישור (ביקורת Codex, P1). חסימה שאינה חלה על ההתראות
 * ‏אינה חסימה.
 *
 * ## ‏למה הבדיקה כאן ולא אצל הקוראים
 *
 * ‏שני מקומות מזהים בעלים כזה — התיבה והמרכזייה — ושניהם כותבים
 * ‏אחריו התראה עם תוכן. בדיקה אצל כל אחד מהם היא שני עותקים,
 * ‏והעותק שיישכח הוא הדליפה. כאן הזיהוי **עצמו** מסרב לנקוב בשם
 * ‏מי שאינו רשאי, ואז `null` — שכבר פירושו „התראה משרדית בלי
 * ‏תוכן” אצל שני הקוראים — הוא התשובה הבטוחה מאליה.
 */
export async function notifiableContactOwnerSource(
  tx: TenantTx,
  tenantId: string,
  sources: ContactOwnerSources,
  /** ‏השולח של ההודעה שעליה עונים — ראו `contactOwnerCandidates`. */
  preferUserId?: string | null,
): Promise<ContactOwner | null> {
  const candidates = contactOwnerCandidates(sources, preferUserId);
  if (candidates.length === 0) return null;
  /*
   * ‏שאילתה אחת לכל המועמדים ולא אחת לכל מועמד: הם לכל היותר
   * ‏שלושה, ושלוש שאילתות על כל שיחה נכנסת הן מחיר שאין סיבה לשלם.
   */
  const caps = await officeCapabilities(
    tx,
    tenantId,
    candidates.map((candidate) => candidate.userId),
  );
  for (const candidate of candidates) {
    // ‏משתמש שאינו פעיל אינו מוחזר מהשליפה — ומי שאינו פעיל אינו נמען
    const set = caps.get(candidate.userId);
    if (set !== undefined && contactSourcesOf(set)[candidate.source]) return candidate;
  }
  return null;
}

/**
 * ‎**„מי מקבל התראה על התשובה הזו” — שאלה אחת, בשני הזמנים.**
 *
 * ‏התיבה שואלת אותה פעמיים על אותה תשובה: בתוך הטרנזקציה, כדי
 * ‏לכתוב את ההתראה במערכת, ושוב אחרי העלאת הקבצים — כי בין
 * ‏השניים כרטיס יכול לעבור לעמית או יכולת להישלל, והוואטסאפ יוצא
 * ‏מהמערכת ואי אפשר לצנזר אותו בדיעבד.
 *
 * ‎**ושתי השאלות חייבות להיות אותה שאלה.** ברגע שהשולח נכנס
 * ‏לתמונה הן נפרדו: הראשונה העדיפה אותו והשנייה לא, ולכן על כל
 * ‏תשובה להודעה של סוכן ב׳ — בדיוק המקרה שבגללו נוסף השדה —
 * ‏הבדיקה השנייה ענתה „א׳”, לא הסכימה עם הראשונה, וההתראה
 * ‏בוואטסאפ נבלעה בשקט.
 *
 * ‎`sentByUserId` **חובה** ולא אופציונלי, וזו כל הנקודה: קורא
 * ‏שלישי לא יוכל לשכוח אותו — המהדר יעצור אותו.
 */
export async function replyRecipient(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
  sentByUserId: string | null,
): Promise<ContactOwner | null> {
  const sources = await loadContactOwnerSources(tx, tenantId, contactId);
  return notifiableContactOwnerSource(tx, tenantId, sources, sentByUserId);
}

/**
 * ‎**ורק המזהה — לקורא שאינו מקשר לשום כרטיס.**
 *
 * ‏היטל של `notifiableContactOwnerSource`, לא ניסוח שני שלו. מי
 * ‏שכותב **קישור** להתראה חייב לדעת **דרך איזה מקור** נבחר הנמען,
 * ‏אחרת הוא מקשר לכרטיס שהנמען אינו רשאי לפתוח — ראו את הפונקציה
 * ‏שמעל.
 */
export async function notifiableContactOwner(
  tx: TenantTx,
  tenantId: string,
  sources: ContactOwnerSources,
): Promise<string | null> {
  return (await notifiableContactOwnerSource(tx, tenantId, sources))?.userId ?? null;
}

export function assertSeesAllContacts(): void {
  if (!seesAllContacts()) {
    throw new ForbiddenException(
      "הפעולה דורשת ראייה משרדית מלאה על אנשי הקשר — כולל בעלי הנכסים",
    );
  }
}

/**
 * האם הלקוח הזה יתום — אינו כרטיס קונה, ליד או בעל נכס אצל איש.
 *
 * נועד לענף „אני רשמתי” בשער השיחה הבודדת: הוא קיים כדי ששיחה **בלי
 * בעלים** לא תיעלם ממי שרשם אותה — שיחה בלי איש קשר, או כזו שהלקוח
 * שלה נמחק מכל הכרטיסים. הענף היה עיוור ליכולות, ולכן שיחה שנרשמה
 * כשמודול הלידים היה פתוח המשיכה לחשוף את הטלפון, התמלול וההקלטה
 * של אותו ליד גם אחרי שהמודול נחסם (ביקורת Codex).
 *
 * **רשומה אחת ולא קבוצה.** קדמה לכאן גרסה קבוצתית, לשירות הרשימה:
 * תחילה על כל הדייר (שלוש קריאות טבלה מלאות), ואז על אנשי הקשר
 * שבעמוד — שתיהן ביקורות Codex. הרשימה מכריעה יתמות ב-SQL עצמו
 * (`NOT EXISTS` באותה שאילתה עם ה-LIMIT), ולכן לא נשאר לה קורא:
 * מה שנשאר הוא השאלה על רשומה אחת, וזו הצורה שמופיעה כאן.
 */
/**
 * הכינויים המותרים לטבלה שעליה חל תנאי היתמות.
 *
 * ‎**איחוד סגור ולא `string`.** הכינוי נכנס לשאילתה דרך `Prisma.raw`,
 * כלומר בלי פרמטר ובלי בריחה — הדרך היחידה שלא להשאיר את זה תלוי
 * במשמעת הקורא היא שהטיפוס עצמו לא יאפשר ערך אחר.
 */
type OrphanAlias = "a" | "c" | "d";

/**
 * ‎**כלל היתמות בצורתו הקבוצתית — ניסוח אחד, שלושה קוראים.**
 *
 * אותו כלל בדיוק כמו `isOrphanContact`, בשפה שהמסד מבין: אין קונה
 * חי, אין ליד, ואין נכס חי שהכרטיס הוא בעליו או דיירו. הצורה הזו
 * קיימת כי רשימה חייבת להכריע יתמות **באותה שאילתה עם ה-LIMIT** —
 * סינון אחרי השליפה מחזיר עמוד חסר.
 *
 * ‎**ולמה כפונקציה ולא שוב בגוף השאילתה.** התנאי היה כתוב במפורש
 * בתוך `visibleCallsCondition`, ובאותו קובץ ישב `isOrphanContact`
 * שאומר את אותו הדבר. שני ניסוחים של כלל אחד הם בדיוק מה שכבר קרה
 * כאן פעם אחת: שלושה עותקים נפרדו זה מזה, תיקון עדכן שניים והשאיר
 * את השלישי, ובעל נכס נחשף למי שמודול הנכסים חסום אצלו. ארכיון
 * ההסכמים והסריקות היה העותק הרביעי.
 *
 * ‎**בלי סינון בעלות, במכוון.** „יתום” כאן פירושו שאיש **במשרד**
 * אינו יכול להגיע אליו — לא „המשתמש הזה אינו יכול”. ארכיון המשרד
 * הוא מוצא אחרון לשורה שאיש אינו מגיע אליה, וסינון לפי `view_own`
 * היה מכניס אליו לקוחות חיים של עמיתים.
 */
export function orphanContactCondition(alias: OrphanAlias): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`
    NOT EXISTS (SELECT 1 FROM buyers b
                 WHERE b.tenant_id = ${t}.tenant_id
                   AND b.contact_id = ${t}.contact_id
                   AND b.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM leads l
                     WHERE l.tenant_id = ${t}.tenant_id
                       AND l.contact_id = ${t}.contact_id)
    AND NOT EXISTS (SELECT 1 FROM properties p
                     WHERE p.tenant_id = ${t}.tenant_id
                       AND (p.owner_contact_id = ${t}.contact_id
                         OR p.occupant_contact_id = ${t}.contact_id)
                       AND p.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM contact_links k
                     WHERE k.tenant_id = ${t}.tenant_id
                       AND k.related_contact_id = ${t}.contact_id)`;
}

/**
 * ‎`except` — „האם יהיה יתום **אחרי** שהעוגן הזה יימחק”.
 *
 * מסך האישור חייב לשאול את השאלה הזו לפני שהשורה נמחקה, והמחיקה
 * עצמה שואלת אותה אחריה. אותו כלל בשני זמנים — ולכן פרמטר ולא
 * ניסוח שני, שהוא בדיוק הצורה שנפרדת מעצמה ומבטיחה למתווך „לא
 * יימחק אף כרטיס” על מחיקה שכן מוחקת אחד.
 *
 * ההחרגה הוכללה מנכס בלבד לשלושת סוגי העוגן הנמחקים: מחיקת קונה
 * ומחיקת ליד קיבלו מסכי גילוי משלהם, וכל אחד שואל „מה יקרה אחרי
 * שהעוגן **שלי** יירד”. שלוש החרגות בכלל אחד, לא שלושה כללים.
 */
export async function isOrphanContact(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
  /**
   * ‎`buyerIds` — הצורה הקבוצתית של אותה החרגה, למחיקה המרוכזת:
   * „מה יקרה אחרי שכל הכרטיסים **שנבחרו** יירדו”. החרגה של כרטיס
   * אחד בלבד הייתה עונה „יישאר” על לקוח ששני העוגנים שלו שניהם
   * בבחירה — והמחיקה עצמה, שמוחקת אחד-אחד, כן הייתה מוחקת אותו
   * בסוף (ביקורת Codex).
   */
  except?: {
    propertyId?: string;
    /**
     * ‎`propertyIds` — הצורה הקבוצתית, למחיקת נכסים מרוכזת. אותה
     * סיבה בדיוק כמו `buyerIds`: בעלים ששני הנכסים שלו בבחירה היה
     * נענה „יישאר” על החרגה של אחד בלבד, בעוד שהמחיקה עצמה —
     * שרצה נכס-נכס — כן הייתה מוחקת אותו בסוף. כלומר התצוגה
     * שלפני האישור הייתה מבטיחה פחות ממה שקורה.
     */
    propertyIds?: readonly string[];
    buyerId?: string;
    buyerIds?: readonly string[];
    leadId?: string;
  },
): Promise<boolean> {
  const exceptBuyers = [
    ...(except?.buyerId === undefined ? [] : [except.buyerId]),
    ...(except?.buyerIds ?? []),
  ];
  const exceptProperties = [
    ...(except?.propertyId === undefined ? [] : [except.propertyId]),
    ...(except?.propertyIds ?? []),
  ];
  const [buyer, lead, property, link] = await Promise.all([
    tx.buyer.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        contactId,
        ...(exceptBuyers.length === 0 ? {} : { id: { notIn: exceptBuyers } }),
      },
      select: { id: true },
    }),
    tx.lead.findFirst({
      where: {
        tenantId,
        contactId,
        ...(except?.leadId === undefined ? {} : { id: { not: except.leadId } }),
      },
      select: { id: true },
    }),
    tx.property.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        ...(exceptProperties.length === 0 ? {} : { id: { notIn: exceptProperties } }),
        // גם דייר קושר אדם לנכס — לא רק בעלות
        OR: [{ ownerContactId: contactId }, { occupantContactId: contactId }],
      },
      select: { id: true },
    }),
    /*
     * ‎**ובן/בת זוג על כרטיס של מישהו אחר הוא עוגן.**
     *
     * ‎`peopleFor` מציגה על הכרטיס הראשי את **השם, הטלפון והאימייל**
     * של כל מי שמקושר אליו. כלומר אדם שכל קשרו למשרד הוא היותו
     * בן/בת זוג בכרטיס חי — נראה, נקרא, ונגיש.
     *
     * ‎**זה חסר כאן, וזה היה שגוי.** שלושת הענפים שמעל תיארו „ממי
     * אני מגיע לכרטיס שלו”, והקישור הוא הדרך הרביעית. כל עוד הכלל
     * הכריע רק אם שיחה שאני רשמתי נשארת גלויה, החסר היה בלתי מזיק.
     * מרגע שהוא מכריע **מה נמחק**, אותו חסר הופך למחיקת בן/בת זוג
     * מכרטיס לקוח פעיל: מחיקת הנכס של אדם שהוא גם בן/בת זוג בכרטיס
     * אחר הייתה מוחקת אותו משם, בשקט.
     *
     * ‎**כיוון אחד בלבד, ובכוונה.** קישור הופך את ה**מקושר** לנגיש,
     * לא את הראשי; ומחיקת הראשי ממילא מסירה את הקישור. הבדיקה גם
     * אינה רקורסיבית — כרטיס ראשי שהוא עצמו יתום עדיין נספר כעוגן.
     * זו שמרנות מכוונת: המחיר הוא כרטיס יתום שנשאר, כלומר בדיוק
     * המצב שהיה קודם, מול מחיקה של נתונים חיים.
     *
     * הכלל הזה כבר היה ידוע במערכת — `deleteContactIfOrphan` במחיקת
     * ליד ספרה אותו. שני ניסוחים של „מי יתום”, ואחד מהם ידע משהו
     * שהשני לא.
     */
    tx.contactLink.findFirst({
      where: { tenantId, relatedContactId: contactId },
      select: { id: true },
    }),
  ]);
  return buyer === null && lead === null && property === null && link === null;
}

/**
 * ‎**מול מי נבדקת הבעלות — או שהשורה שייכת לארכיון המשרד.**
 *
 * מסמך שנשמר מטעמים משפטיים מגיע לארכיון בשתי דרכים: מחיקת לקוח
 * מנתקת אותו במפורש (`contactId = null`), **או** שהכרטיס שלו נשאר
 * במקומו ואיבד את כל עוגני הגישה. שתי הדרכים מובילות לאותו מצב —
 * אין כרטיס שאפשר לבדוק מולו בעלות — ולכן שתיהן צריכות את אותו שער.
 *
 * ‎**וזה חייב להיות אותו כלל שהרשימה משתמשת בו.** הרשימה הורחבה
 * ליתומים, והשער נשאר על „נותק” בלבד; התוצאה הייתה ארכיון שמציג
 * שורות שמנהל המשרד **אינו יכול לפתוח** — assertContactAccess נכשלת
 * עליהן בהגדרה (ביקורת Codex). שני תנאים שאמורים להסכים, בשני
 * מקומות, הם בדיוק הצורה שנפרדת מעצמה.
 *
 * מחזיר את המזהה בענף „לקוח” כדי שהקורא לא יצטרך `!`: „יש כרטיס
 * לבדוק מולו” הוא בדיוק המידע שהמזהה קיים.
 */
export async function contactGateFor(
  tx: TenantTx,
  tenantId: string,
  contactId: string | null,
): Promise<{ mode: "archive" } | { mode: "contact"; contactId: string }> {
  if (contactId === null) return { mode: "archive" };
  return (await isOrphanContact(tx, tenantId, contactId))
    ? { mode: "archive" }
    : { mode: "contact", contactId };
}

export async function visibleContactIds(
  tx: TenantTx,
  tenantId: string,
): Promise<string[] | null> {
  if (seesAllContacts()) return null;
  const ctx = TenantContext.current();
  /*
   * ‏התנאים עצמם מגיעים מהחבילה המשותפת כנתונים, וכל תהליך מריץ
   * ‏אותם דרך ה-Prisma שלו. כך גם סבב ההתראות של העובד שואל את
   * ‏אותה שאלה בלי לייבא מכאן — ובלי עותק שני של המדיניות.
   */
  const filters = visibleContactFilters(tenantId, ctx.userId, ctx.capabilities);
  const [buyers, leads, properties] = await Promise.all([
    filters.buyers === null
      ? []
      : tx.buyer.findMany({ where: filters.buyers, select: { contactId: true } }),
    filters.leads === null
      ? []
      : tx.lead.findMany({ where: filters.leads, select: { contactId: true } }),
    filters.properties === null
      ? []
      : tx.property.findMany({
          where: filters.properties,
          select: { ownerContactId: true, occupantContactId: true },
        }),
  ]);
  return contactIdsFromSources(buyers, leads, properties);
}

/**
 * ‎**האם הלקוח הזה מותר לי — בלי לזרוק.**
 *
 * ‏אותו כלל בדיוק של `assertContactAccess`, ובאמת אותו קוד: הפונקציה
 * ‏ההיא קוראת לזו. שני מימושים היו נפרדים בעריכה הראשונה, וזו טבלת
 * ‏ההרשאות האחרונה שבה מותר שזה יקרה.
 *
 * ‏קיימת כי יש מקום אחד שבו „אסור” אינו 404 אלא **השמטה**: כרטיס
 * ‏הנכס. הנכס עצמו גלוי לכל המשרד בכוונה, ולכן חסימת הכרטיס כולו
 * ‏הייתה שינוי אחר לגמרי — מה שצריך לרדת ממנו הוא פרטי הבעלים.
 */
export async function canSeeContact(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
): Promise<boolean> {
  // אותם מקורות בדיוק כמו ב-`visibleContactIds` — הן חייבות להסכים
  const sources = contactSources();
  const [buyer, lead, property] = await Promise.all([
    sources.buyers
      ? tx.buyer.findFirst({
          where: {
            tenantId,
            contactId,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
          select: { id: true },
        })
      : null,
    sources.leads
      ? tx.lead.findFirst({
          where: { tenantId, contactId, ...leadOwnershipFilter() },
          select: { id: true },
        })
      : null,
    sources.properties
      ? tx.property.findFirst({
          where: {
            tenantId,
            deletedAt: null,
            OR: [{ ownerContactId: contactId }, { occupantContactId: contactId }],
            // ‏חייב להסכים עם `visibleContactIds` — ראו ההערה שם
            ...ownershipFilter("properties.view_all", "agentUserId"),
          },
          select: { id: true },
        })
      : null,
  ]);
  return Boolean(buyer || lead || property);
}

/**
 * ‎**כרטיס שאיש אינו מחזיק בו** — לא „של מישהו אחר”, אלא פנוי.
 *
 * ‏שיחה שלא נענתה יוצרת כרטיס איש קשר בלי שום כרטיס עסקי:
 * ‏בלי קונה, בלי ליד, ובלי נכס. `canSeeContact` נשען על קיומו של
 * ‏כרטיס כזה, ולכן החזירה `false` — **לכל הסוכנים, כולל בעל
 * ‏המשרד**. השער מעל סירב אז ליצור קונה מהמספר, בהודעה „המספר
 * ‏הזה משויך ללקוח שאינו נגיש לך”, שהיא פשוט לא נכונה: הוא לא
 * ‏משויך לאיש (דיווח מהשטח).
 *
 * ‏זה בדיוק הענף הרביעי של כלל ראיית השיחות שכמה שורות מכאן:
 * ‏„לא כי מישהו אחר ראה אותה — אלא כי **אף אחד** לא”.
 *
 * ‎**מה שלא משתנה:** הבדיקה מוודאת שאין כרטיס כזה **בכלל**, לא
 * ‏„אין כזה שאני רואה”. לכן היא מכוונת בלי `ownershipFilter` —
 * ‏כרטיס של עמית באותו משרד מחזיר `false` וממשיך להיחסם, וזה
 * ‏כל ההבדל בין „פנוי” ל„לא שלי”. ה-RLS מגביל ל-tenant ממילא.
 *
 * ‏גם `contactSources` (חסימת מודול) אינה חלה כאן: ליד קיים הוא
 * ‏כרטיס תפוס גם כשמודול הלידים כבוי למשתמש הזה. הבחירה היא
 * ‏לצד המחמיר — פחות כרטיסים נחשבים פנויים.
 */
export async function contactIsUnclaimed(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
): Promise<boolean> {
  const [buyer, lead, property] = await Promise.all([
    tx.buyer.findFirst({
      where: { tenantId, contactId, deletedAt: null },
      select: { id: true },
    }),
    tx.lead.findFirst({ where: { tenantId, contactId }, select: { id: true } }),
    tx.property.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ ownerContactId: contactId }, { occupantContactId: contactId }],
      },
      select: { id: true },
    }),
  ]);
  return !buyer && !lead && !property;
}

export async function assertContactAccess(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
): Promise<void> {
  if (!(await canSeeContact(tx, tenantId, contactId))) {
    throw new NotFoundException("איש קשר לא נמצא");
  }
}

/**
 * מי רשאי לראות שיחה — **התנאי היחיד, ולא עותק אצל כל קורא.**
 *
 * הוא נכתב בתוך `CallsService.list`, ולכן החיפוש הגלובלי — שמוצא
 * שיחה לפי טקסט מתוך התקציר — שלף לפי `tenantId` בלבד. פעולת
 * `search` דורשת `properties.view`, כלומר סוכן בלי גישה משרדית
 * ללידים ולקונים יכול היה לחפש ביטוי מתוך שיחה של סוכן אחר ולקבל
 * את התקציר שלה (ביקורת Codex). הכלל יושב עכשיו במקום אחד, ושני
 * הקוראים מרכיבים אותו לתוך השאילתה שלהם.
 *
 * הכינוי של הטבלה חייב להיות `c` — התנאי מתייחס אליו.
 *
 * ארבעה ענפים, וכולם קיימים גם ביומן השיחות: איש קשר שהמשתמש
 * רשאי לו, שיחה שהוא רשם בלי איש קשר, שיחה שהוא רשם על איש קשר
 * שאין לו עוד כרטיס חי — „אני רשמתי” חל על יתומה בלבד, אחרת שיחה
 * שנרשמה לפני חסימת מודול הייתה שורדת אותה — ושיחה שאיש אינו
 * בעליה.
 *
 * ## הענף הרביעי: שיחה שאיש אינו בעליה
 *
 * שיחה שלא נענתה ממספר שאיננו מכירים לא נראתה לאף סוכן (דיווח
 * מהשטח). לא כי מישהו אחר ראה אותה — אלא כי **אף אחד** לא.
 *
 * שיחה ממרכזייה נכתבת בלי `created_by`: אין משתמש שביקש אותה, יש
 * וובהוק. כשהיא גם לא נענתה, המערכת אינה פותחת ליד (`createLead`
 * דורש שיחה שנענתה), ולכן גם `contact_id` ריק. שלושת הענפים
 * הראשונים נשענים כולם על אחד מהשניים, וכך שורה קיימת ותקינה
 * נעלמה מכל עין — בזמן שהמערכת עצמה כבר שלחה על אותה שיחה התראת
 * „שיחה שלא נענתה”. מספר שהתקשר ואיש אינו רואה הוא ליד אבוד.
 *
 * ‎`created_by` אינו עמודה שנוספה בדיעבד — הוא קיים מהמיגרציה
 * הראשונה של הטבלה, ורישום ידני ממלא אותו תמיד. לכן „ריק” כאן
 * אינו נתון היסטורי חסר אלא קביעה: לא אדם כתב את השורה.
 *
 * ואין כאן פרצה: הצירוף „בלי בעלים **וגם** בלי איש קשר” הוא בדיוק
 * המצב שבו אין כרטיס לקוח להגן עליו. שיחה של לקוח של סוכן אחר
 * נושאת `contact_id`, ונשארת מוסתרת כמו קודם.
 */
/**
 * ‎**פעולה על בעל נכס — שתי שאלות שונות, ושתיהן חייבות להיענות.**
 *
 * ## ‏מה היה שגוי
 *
 * ‏`assertContactAccess` שואל „האם מותר לי לראות את האדם הזה”,
 * ‏והתשובה שלו היא **איחוד**: הוא נמצא דרך הקונה שלי, או הליד שלי,
 * ‏או נכס שאני רשאי לראות. זה נכון לכרטיס הלקוח — אדם שאני מטפל
 * ‏בו הוא שלי לכל דבר.
 *
 * ‏אבל הפעולות כאן אינן על האדם, הן על **האדם בהקשר של הנכס
 * ‏הזה**: „עדכון שיווק על הנכס”, „דוח פעילות על הנכס”. בתרחיש
 * ‏שכיח לגמרי — לקוח שקונה דרכי ומוכר דרך עמית — האיחוד נפתח דרך
 * ‏הקונה שלי, ואז יכולתי לפנות אליו **על הנכס של העמית**. ההפרדה
 * ‏שכל ה-PR הזה בונה נעקפת בלי שום חריגה (ביקורת Codex, P1).
 *
 * ## ‏הכלל
 *
 * ‏מותר לראות את האדם **וגם** מותר לי הנכס: `properties.view_all`,
 * ‏או שאני הסוכן שלו.
 *
 * ‏אין כאן ענף ל„נכס בלי סוכן משויך”, ובכוונה: `visibleContactIds`
 * ‏מסנן את ענף הנכסים ב-`agentUserId` שלי, ולכן בעליו של נכס
 * ‏לא-משויך אינו נראה למי שאין לו `view_all` ממילא — השער הראשון
 * ‏כבר דחה. ענף כזה היה קוד מת שנראה כמו החלטה.
 *
 * ‏ושני השערים נדרשים: נכס **שלי** עדיין נחסם אם מודול הנכסים
 * ‏חסום אצלי, וזה מה שהשער הראשון תופס.
 */
export async function assertPropertyOwnerAction(
  tx: TenantTx,
  tenantId: string,
  property: { agentUserId: string | null; ownerContactId: string },
): Promise<void> {
  await assertContactAccess(tx, tenantId, property.ownerContactId);
  assertPropertyScope(property.agentUserId, "פנייה לבעל הנכס");
}

/**
 * ‎**„הנכס הזה שלי?” — החצי השני, בלי הלקוח.**
 *
 * ‏מופרד מ-`assertPropertyOwnerAction` כי לא כל פעולה על נכס היא
 * ‏פנייה לבעליו: הסכם בלעדיות וסריקה חתומה נושאים מזהה נכס בלי
 * ‏שהם „הודעה למישהו”. ניסוח מקומי שני היה בדיוק העותק שנפרד.
 *
 * ‎**חסימת המודול נבדקת כאן ישירות, ולא נסמכת על שער הלקוח.** שער
 * ‏הלקוח הוא איחוד: אם בעל הנכס הוא גם הקונה שלי הוא עובר דרך
 * ‏הקונה — גם כשמודול הנכסים חסום אצלי לגמרי — ואז ענף „הנכס שלי”
 * ‏מאשר, כי הנכס באמת משויך אליי. כלומר בדיוק ההצרנה שהשער נבנה
 * ‏למנוע, בתוך השער עצמו (ביקורת Codex, P1).
 *
 * ‏אין ענף ל„נכס בלי סוכן משויך”, ובכוונה: נכס כזה אינו של אף אחד,
 * ‏ומי שאמור לפעול עליו הוא מי שיכול לשייך אותו — כלומר מנהל, שיש
 * ‏לו `view_all` ממילא.
 *
 * ‎`subject` הוא צירוף שם — „פנייה לבעל הנכס”, „הסכם על נכס” —
 * ‏ולא משפט, כדי שההודעה תישאר נכונה דקדוקית בכל קורא.
 */
/**
 * ‎**„הנכס הזה בהיקף שלי” — ההכרעה עצמה, בלי זריקה.**
 *
 * ‏קיימת כי יש מקום אחד שבו התשובה אינה חסימה אלא **השמטה**:
 * ‏המקדימון של דוח פעילות הנכס, שמחליט אם להציג את שם הבעלים ואת
 * ‏הערוצים הזמינים. הוא כתב את התנאי בעצמו — וכתב אותו רחב יותר:
 * ‏נכס בלי סוכן משויך נחשב אצלו „שלי”, בזמן ש-`assertPropertyScope`
 * ‏דוחה אותו. המסך הדליק כפתורים שכל לחיצה עליהם נכשלה, ועצם
 * ‏הכישלון גילה שיש בעלים שאפשר לפנות אליו (ביקורת Codex, P2).
 *
 * ‏הכרעה אחת, שני קוראים: זה שמשמיט וזה שזורק.
 */
export function inPropertyScope(agentUserId: string | null): boolean {
  const ctx = TenantContext.current();
  if (!ctx.capabilities.has("properties.view")) return false;
  if (ctx.capabilities.has("properties.view_all")) return true;
  return agentUserId === ctx.userId;
}

export function assertPropertyScope(agentUserId: string | null, subject: string): void {
  const ctx = TenantContext.current();
  if (!ctx.capabilities.has("properties.view")) {
    throw new ForbiddenException(`${subject} — מודול הנכסים חסום עבורך, פנו למנהל המשרד`);
  }
  if (inPropertyScope(agentUserId)) return;
  throw new ForbiddenException(
    `${subject} — הנכס הזה משויך לסוכן אחר, פנו אליו או למנהל המשרד`,
  );
}

/**
 * ‎**רשומה שההיקף שלה נגזר מנכס, ומי מכריע אם היא חייבת אחד.**
 *
 * ‎`requiresProperty` נמסר על ידי הקורא ואינו נגזר כאן, כי זו אינה
 * ‏שאלה אחת: להסכם דיגיטלי רק בלעדיות חייבת נכס
 * ‏(`agreementRequiresProperty`), ואילו **סריקה** חתומה מצהירה על
 * ‏הסכם על נכס מסוים בשני הסוגים (`documentUnlocksOffers`) — שם
 * ‏הזמנה בכתב סרוקה בלי נכס היא בדיוק אותה עקיפה (ביקורת Codex, P1).
 *
 * ‏מדיניות אחת לשניהם הייתה נכונה לאחד ורפה לשני. שאלה אחת עם שתי
 * ‏תשובות, וכל צד אומר את שלו במקום אחד.
 */
export interface PropertyRecord {
  propertyId: string | null;
  requiresProperty: boolean;
}

/**
 * ‎**האם הרשומה בהישג יד — הצורה הקבוצתית של השער** (ביקורת Codex, P1).
 *
 * ‏`assertPropertyRecordScope` תיקן את השורה הבודדת, והרשימות
 * ‏המשיכו לשמור **כל** שורה בלי נכס כמשרדית. כלומר בלעדיות ישנה
 * ‏בלי `propertyId` נחסמה בהורדה ובשליחה — והוחזרה ברשימה, עם
 * ‏קישור החתימה נושא־הטוקן בתוכה. שער שאפשר לעקוף דרך הרשימה
 * ‏שמובילה אליו אינו שער.
 *
 * ‎`allowed === null` פירושו „אין מה להגביל”, כמו ב-`visibleContactIds`.
 */
export function propertyRecordInScope(
  record: PropertyRecord,
  allowed: Set<string> | null,
): boolean {
  if (allowed === null) return true;
  /* ‏שורה שחייבת נכס ואין לה — חסרת היקף, ולא משרדית */
  if (record.propertyId === null) return !record.requiresProperty;
  return allowed.has(record.propertyId);
}

/**
 * ‎**רשומה שנושאת מזהה נכס — הלקוח *וגם* הנכס.**
 *
 * ## ‏מה היה שגוי
 *
 * ‏הסכם וסריקה חתומה נושאים `contactId` **ו**-`propertyId`, ושניהם
 * ‏אושרו ב-`assertContactAccess` בלבד. אבל השער הזה הוא איחוד
 * ‏מקורות: לקוח שקונה דרכי ומוכר דרך עמית נפתח דרך כרטיס הקונה
 * ‏שלי — ומשם יכולתי להפיק הסכם **בלעדיות על הנכס של העמית**,
 * ‏לשלוח אותו לחתימה, ולראות את הטוקן החתימה ואת פרטי החותם של
 * ‏הסכם קיים שלו (ביקורת Codex, P1).
 *
 * ## ‏הכלל
 *
 * ‏רשומה בלי `propertyId` היא ברמת המשרד ונשארת על שער הלקוח בלבד.
 * ‏רשומה **עם** `propertyId` דורשת גם את הנכס — בלי הבחנה לפי סוג
 * ‏ההסכם או לפי מי הבעלים הרשום: הבחנה כזו הייתה הופכת את השער
 * ‏לשאלה על התוכן, ובדיוק זה הכשל שחוזר כאן שוב ושוב.
 *
 * ‎**ברירת המחדל אינה משתנה.** לכל תפקיד קיים יש `properties.view_all`,
 * ‏ולכן השער חוסם רק מי שמנהל המשרד הגביל במפורש — ואצלו זו בדיוק
 * ‏הכוונה: הוא עובד על הנכסים שלו.
 *
 * ‏נכס שנמחק מתחת לרשומה אינו חוסם: אין מה לשייך, ושער הלקוח הוא
 * ‏מה שנשאר. זו אותה הכרעה כמו בשריד `lead_id` ב-`assertCallAccess`.
 *
 * ## ‏ושורה ישנה שחסר בה נכס — ולא הייתה אמורה
 *
 * ‎(ביקורת Codex, P1). ‏„בלי `propertyId` ⇒ ברמת המשרד” נכון
 * ‏להזמנה בכתב, ו**שקרי** לבלעדיות: היצירה כאן כבר דורשת נכס
 * ‏(`agreementRequiresProperty`), אבל ה-API הישן לא — ושורות
 * ‏בלעדיות בלי נכס יושבות במסד. הן נפלו בדיוק לענף הזה, כלומר
 * ‏חזרו להיות מוגנות בשער הלקוח בלבד: מי שרואה את האדם דרך כרטיס
 * ‏הקונה שלו קיבל את קישור החתימה של הבלעדיות של העמית, פתח את
 * ‏המסמך החתום ויכול היה לשלוח אותו מחדש.
 *
 * ‏אין מאיפה להשלים את הנכס במיגרציה — הוא מעולם לא נשמר. לכן
 * ‏שורה כזו נקראת כמו **נכס לא משויך**: `assertPropertyScope(null)`,
 * ‏כלומר רק מי שמחזיק `properties.view_all`. אותה הכרעה בדיוק שכל
 * ‏שאר הקוד עושה על נכס בלי סוכן, ולא מושג חדש.
 *
 * ‏השאלה נשאלת על **הסוג** ולא על „האם יש נכס”, כי זו בדיוק אותה
 * ‏שאלה שהיצירה שואלת. שני ניסוחים שלה היו נפרדים ביום שיתווסף
 * ‏סוג שלישי.
 */
export async function assertPropertyRecordScope(
  tx: TenantTx,
  tenantId: string,
  record: PropertyRecord & { contactId: string },
  subject: string,
): Promise<void> {
  await assertContactAccess(tx, tenantId, record.contactId);
  if (record.propertyId === null) {
    if (record.requiresProperty) assertPropertyScope(null, subject);
    return;
  }
  const property = await tx.property.findFirst({
    where: { id: record.propertyId, tenantId },
    select: { agentUserId: true },
  });
  if (property === null) return;
  assertPropertyScope(property.agentUserId, subject);
}

/**
 * ‎**אותה שאלה לרשימה: אילו מהנכסים האלה מותרים לי לפעולה.**
 *
 * ‎`null` = אין הגבלה, כמו ב-`visibleContactIds`. רשימה שמסננת
 * ‏בעצמה הייתה העותק שנפרד מהשער — ולכן שתיהן נגזרות מאותן שתי
 * ‏יכולות, כאן ושם.
 */
export async function actionablePropertyIds(
  tx: TenantTx,
  tenantId: string,
  ids: readonly string[],
): Promise<Set<string> | null> {
  const reach = propertyReach();
  if (reach === "all") return null;
  if (reach === "none" || ids.length === 0) return new Set();
  const rows = await tx.property.findMany({
    where: { id: { in: [...ids] }, tenantId, agentUserId: TenantContext.current().userId },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * ‎**עד היכן מגיעה הרשות שלי בנכסים** — שלוש תשובות, מקום אחד.
 *
 * ‏קיים כי לאותה שאלה יש שתי צורות: סינון של רשימה שכבר בידי
 * ‏(`actionablePropertyIds`), ותנאי `where` שרץ **לפני** התקרה
 * ‏(`actionablePropertyWhere`). שתי הצורות נחוצות, שני **כללים**
 * ‏לא — ולכן ההכרעה עצמה יושבת כאן, והן נבדקות זו מול זו.
 */
type PropertyReach = "all" | "own" | "none";

function propertyReach(): PropertyReach {
  const ctx = TenantContext.current();
  if (!ctx.capabilities.has("properties.view")) return "none";
  return ctx.capabilities.has("properties.view_all") ? "all" : "own";
}

/**
 * ‎**אותו כלל, כתנאי שאילתה — כדי שהוא ירוץ לפני `take`**
 * ‏(ביקורת Codex, P2).
 *
 * ‏`actionablePropertyIds` מסנן רשימה **שכבר נשלפה**, ולכן כשהוא
 * ‏בא אחרי `take: 200` הוא מסנן את המאתיים ולא את המאגר: מאתיים
 * ‏הסכמים חדשים על נכסים של עמיתים מילאו את החלון, נמחקו כאן,
 * ‏והתור חזר ריק בזמן שהסכמים ישנים יותר **שלי** המתינו מחוצה לו.
 *
 * ‏שורה בלי נכס עוברת תמיד: הבעלות עליה נגזרת מהלקוח, וזה כבר
 * ‏נבדק בשלב `visibleContactIds`.
 *
 * ‏מחיר: בענף „שלי” נשלפת רשימת מזהי הנכסים שלי לתוך `in`. זה
 * ‏רץ רק למי שאין לו `properties.view_all` — כלומר על תת-קבוצה של
 * ‏המשרד, על עמודה מאונדקסת.
 */
/**
 * ‏צורת התנאי, ולא `Prisma.AgreementWhereInput`.
 *
 * ‏אותה שאלה נשאלת על יותר מטבלה אחת — הסכמים וסריקות חתומות —
 * ‏וטיפוס של טבלה אחת אינו ניתן לשימוש בשנייה. הצורה עצמה זהה
 * ‏בשתיהן, ולכן היא זו שמתוארת.
 */
export interface PropertyScopeWhere {
  propertyId?: string | null | { in: string[] };
  kind?: { notIn: string[] };
  OR?: { propertyId: string | null | { in: string[] }; kind?: { notIn: string[] } }[];
}

/**
 * ‎**והשאילתה יודעת אילו סוגים חייבים נכס** (ביקורת Codex, P1).
 *
 * ‏„בלי `propertyId` ⇒ עובר תמיד” היה נכון כשההנחה הייתה ששורה
 * ‏בלי נכס היא ברמת המשרד. היא אינה: ה-API הישן אִפשר בלעדיות בלי
 * ‏נכס, ומחיקת נכס מאפסת את השדה על סריקה. שורות כאלה חזרו ברשימה
 * ‏עם קישור החתימה בתוכה.
 *
 * ‏הסוגים מגיעים מהקורא, ולא נגזרים כאן — אותה הכרעה בדיוק כמו
 * ‏ב-`PropertyRecord.requiresProperty`, ומאותה סיבה.
 */
export async function actionablePropertyWhere(
  tx: TenantTx,
  tenantId: string,
  kindsRequiringProperty: readonly string[],
): Promise<PropertyScopeWhere> {
  const reach = propertyReach();
  if (reach === "all") return {};
  const detached = { propertyId: null, kind: { notIn: [...kindsRequiringProperty] } };
  if (reach === "none") return detached;
  const mine = await tx.property.findMany({
    where: { tenantId, agentUserId: TenantContext.current().userId },
    select: { id: true },
  });
  return { OR: [detached, { propertyId: { in: mine.map((row) => row.id) } }] };
}

export function visibleCallsCondition(
  tenantId: string,
  userId: string,
  /** `null` = רואה כל לקוח במשרד, ולכן אין מה להגביל */
  visible: string[] | null,
): Prisma.Sql {
  if (visible === null) return Prisma.sql`c.tenant_id = ${tenantId}`;
  /*
   * ‎**הליד חוסם, והלקוח פותח — ולכן `AND` ולא ענף נוסף ב-`OR`.**
   *
   * ‏הרשימה בנויה מאיחוד מקורות, ואיחוד אינו יכול לחסום: אותו אדם
   * ‏יכול להיות הקונה שלי וגם הליד של עמית, ואז שיחה שהעמית ניהל
   * ‏על **הליד שלו** נכנסה דרך כרטיס הקונה שלי. תנאי הליד יושב
   * ‏מחוץ לאיחוד מפני שהוא מצמצם אותו, לא מרחיב (ביקורת Codex, P1).
   *
   * ‏ואותו תנאי בדיוק נבדק ב-`assertCallAccess`, דרך `leadIsVisible`
   * ‏— שני ביטויים של כלל אחד, ולא שני כללים.
   */
  return Prisma.sql`
    c.tenant_id = ${tenantId}
    AND ${visibleLeadCondition("c")}
    AND (
         c.contact_id = ANY(${visible}::char(26)[])
      OR (c.created_by = ${userId} AND c.contact_id IS NULL)
      OR (c.created_by IS NULL AND c.contact_id IS NULL)
      OR (c.created_by = ${userId}
          AND c.contact_id IS NOT NULL
          AND ${orphanContactCondition("c")})
    )`;
}

/**
 * ‎**„הבלעדיויות שדורשות טיפול” — של מי שמטפל בהן.**
 *
 * ## מה היה שבור
 *
 * ‏שורת ההתראה במסך הנכסים הציגה לכל מי שנכנס את **כל** הבלעדיויות
 * של המשרד. במשרד עם כמה סוכנים זה אומר שסוכן פותח את המסך שלו
 * ורואה „חסרות פעולות שיווק” על נכס שאינו שלו, שאין לו מה לעשות
 * איתו, ושהוא אינו יכול לטפל בו.
 *
 * וזו אינה רק הפרעה: תור שרובו לא-שלי מלמד את העין לדלג עליו,
 * ואז גם השורה **שכן** שלי נבלעת. התראה שאיש אינו קורא שווה
 * להיעדר התראה — כאן, על מועד שאחריו הבלעדיות פוקעת בדין.
 *
 * ## הכלל
 *
 * ‏הבעלות יושבת על **הנכס** (`properties.agent_user_id`) ולא על
 * תיק הבלעדיות, ולכן התנאי הוא תת-שאילתה ולא השוואת עמודה.
 *
 * ‎**מנהל ממשיך לראות את כל המשרד.** אין ל„נכסים” יכולת
 * ‎`view_all` משלהם — הם גלויים לכל המשרד ממילא — ולכן ההרחבה
 * נשענת על `tasks.view_all`, היכולת שמשמעותה „רואה גם עבודה
 * שהוטלה על אחרים” ושמוחזקת בדיוק בידי שלושת תפקידי ההנהלה. זו
 * אותה הבחנה שכבר נעשית בהעברת נכס בין סוכנים, ולא תפקיד שנבדק
 * בשמו.
 *
 * ‎**נכס בלי סוכן משויך נראה למנהל בלבד** — במכוון. הוא אינו
 * „של מישהו אחר”, אבל הוא גם אינו משימה של אף סוכן; מי שאמור
 * לראות אותו הוא מי שיכול לשייך אותו. זו התנהגות שונה מהערימה
 * המשותפת של הלידים (`leadOwnershipFilter`), כי ליד לא-משויך הוא
 * הזמנה לקחת אותו — ובלעדיות היא חובה חוזית של המשרד, שאין דרך
 * „לקחת” אותה בלי שיוך הנכס עצמו.
 */
export function seesAllProperties(): boolean {
  return TenantContext.current().capabilities.has("tasks.view_all");
}

/**
 * ‎`ownedPropertyScope` היא הצורה ה-SQL של אותה שאלה. שתי הצורות
 * נגזרות מ-`seesAllProperties` ולא מכריעות בעצמן: הסינון והמילים
 * שמתארות אותו למשתמש חייבים לומר את אותו הדבר, ובדיקה שנייה של
 * היכולת הייתה בדיוק העותק שנפרד ומשקר על עצמו.
 */
export function ownedPropertyScope(tenantId: string): Prisma.Sql {
  const ctx = TenantContext.current();
  if (seesAllProperties()) return Prisma.sql`TRUE`;
  return Prisma.sql`
    property_id IN (SELECT id FROM properties
                     WHERE tenant_id = ${tenantId}
                       AND agent_user_id = ${ctx.userId})`;
}
