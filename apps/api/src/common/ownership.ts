import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { effectiveCapabilities, type Capability } from "@metavchim/shared";
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
  if (ctx.capabilities.has("leads.view_all")) return true;
  if (!ctx.capabilities.has("leads.view_own")) return false;
  return assignedToUserId === null || assignedToUserId === ctx.userId;
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
export function contactSourcesOf(caps: ReadonlySet<Capability>): {
  buyers: boolean;
  leads: boolean;
  properties: boolean;
} {
  return {
    buyers: caps.has("buyers.view_own") || caps.has("buyers.view_all"),
    leads: caps.has("leads.view_own") || caps.has("leads.view_all"),
    properties: caps.has("properties.view"),
  };
}

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
export function seesAllContactsWith(caps: ReadonlySet<Capability>): boolean {
  return (
    caps.has("buyers.view_all") &&
    caps.has("leads.view_all") &&
    contactSourcesOf(caps).properties &&
    /*
     * ‎**גם `properties.view_all`, ולא רק „המודול פתוח”.**
     *
     * ‏בלי זה הקיצור היה מנצח את הסינון החדש: סוכן עם כל הקונים וכל
     * ‏הלידים אבל **בלי** כל הנכסים היה מקבל `null` — כלומר „אין מה
     * ‏לסנן” — ורואה את בעלי הנכסים של כולם. קיצור שמחזיר יותר ממה
     * ‏שהתנאי המלא מחזיר הוא באג שקט בדיוק בכיוון המסוכן.
     */
    caps.has("properties.view_all")
  );
}

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
export type ContactOwnerSource = "buyers" | "leads" | "properties";

export interface ContactOwner {
  userId: string;
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

export interface ContactOwnerSources {
  buyer: { ownerUserId: string | null } | null;
  lead: { assignedToUserId: string | null } | null;
  property: { agentUserId: string | null } | null;
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
export function contactOwnerCandidates(sources: ContactOwnerSources): ContactOwner[] {
  const ordered: ContactOwner[] = [];
  const buyer = sources.buyer?.ownerUserId;
  if (buyer !== null && buyer !== undefined) ordered.push({ userId: buyer, source: "buyers" });
  const lead = sources.lead?.assignedToUserId;
  if (lead !== null && lead !== undefined) ordered.push({ userId: lead, source: "leads" });
  const agent = sources.property?.agentUserId;
  if (agent !== null && agent !== undefined) {
    ordered.push({ userId: agent, source: "properties" });
  }
  return ordered;
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
): Promise<ContactOwner | null> {
  const candidates = contactOwnerCandidates(sources);
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
  const sources = contactSources();
  if (seesAllContacts()) return null;

  const [buyers, leads, properties] = await Promise.all([
    sources.buyers
      ? tx.buyer.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...ownershipFilter("buyers.view_all", "ownerUserId"),
          },
          select: { contactId: true },
        })
      : [],
    sources.leads
      ? tx.lead.findMany({
          where: { tenantId, ...leadOwnershipFilter() },
          select: { contactId: true },
        })
      : [],
    sources.properties
      ? tx.property.findMany({
          where: {
            tenantId,
            deletedAt: null,
            OR: [{ ownerContactId: { not: null } }, { occupantContactId: { not: null } }],
            /*
             * ‎**גם הנכסים — לפי החלטת מנהל המשרד.**
             *
             * ‏עד כה הענף הזה היה חסר סינון: כל בעל נכס וכל דייר
             * ‏במשרד נראו לכל מי שמודול הנכסים פתוח אצלו. יש משרדים
             * ‏שזה נכון להם, ויש משרדים שבהם נכס שייך לסוכן שגייס
             * ‏אותו — ועמית שמדבר עם הבעלים מאחורי גבו הוא בדיוק מה
             * ‏שאסור.
             *
             * ‏לכן זו אינה הכרעה שלנו אלא של המשרד: `properties.view_all`
             * ‏ניתנת כברירת מחדל לכל תפקיד שיש לו `properties.view`,
             * ‏ומנהל שרוצה הפרדה חוסם אותה לסוכן במסך ההרשאות.
             */
            ...ownershipFilter("properties.view_all", "agentUserId"),
          },
          select: { ownerContactId: true, occupantContactId: true },
        })
      : [],
  ]);

  return [
    ...new Set([
      ...buyers.map((row) => row.contactId),
      ...leads.map((row) => row.contactId),
      /*
       * שני התפקידים, ולכן `flatMap` ולא `map`: לנכס יכולים להיות
       * בעלים **וגם** דייר, ושניהם אנשים שהמשרד רשאי לראות. סינון
       * ה-`null` נעשה כאן ולא ב-`!`, כי עכשיו כל שורה יכולה להביא
       * אפס, אחד או שניים.
       */
      ...properties.flatMap((row) =>
        [row.ownerContactId, row.occupantContactId].filter(
          (id): id is string => id !== null,
        ),
      ),
    ]),
  ];
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
export function assertPropertyScope(agentUserId: string | null, subject: string): void {
  const ctx = TenantContext.current();
  if (!ctx.capabilities.has("properties.view")) {
    throw new ForbiddenException(`${subject} — מודול הנכסים חסום עבורך, פנו למנהל המשרד`);
  }
  if (ctx.capabilities.has("properties.view_all")) return;
  if (agentUserId === ctx.userId) return;
  throw new ForbiddenException(
    `${subject} — הנכס הזה משויך לסוכן אחר, פנו אליו או למנהל המשרד`,
  );
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
 */
export async function assertPropertyRecordScope(
  tx: TenantTx,
  tenantId: string,
  record: { contactId: string; propertyId: string | null },
  subject: string,
): Promise<void> {
  await assertContactAccess(tx, tenantId, record.contactId);
  if (record.propertyId === null) return;
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
export async function actionablePropertyWhere(
  tx: TenantTx,
  tenantId: string,
): Promise<Prisma.AgreementWhereInput> {
  const reach = propertyReach();
  if (reach === "all") return {};
  if (reach === "none") return { propertyId: null };
  const mine = await tx.property.findMany({
    where: { tenantId, agentUserId: TenantContext.current().userId },
    select: { id: true },
  });
  return { OR: [{ propertyId: null }, { propertyId: { in: mine.map((row) => row.id) } }] };
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
