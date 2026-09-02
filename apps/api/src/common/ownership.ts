import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Capability } from "@metavchim/shared";
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
function contactSources(): { buyers: boolean; leads: boolean; properties: boolean } {
  const caps = TenantContext.current().capabilities;
  return {
    buyers: caps.has("buyers.view_own") || caps.has("buyers.view_all"),
    leads: caps.has("leads.view_own") || caps.has("leads.view_all"),
    properties: caps.has("properties.view"),
  };
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
  const caps = TenantContext.current().capabilities;
  return (
    caps.has("buyers.view_all") && caps.has("leads.view_all") && contactSources().properties
  );
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

export async function assertContactAccess(
  tx: TenantTx,
  tenantId: string,
  contactId: string,
): Promise<void> {
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
          },
          select: { id: true },
        })
      : null,
  ]);
  if (!buyer && !lead && !property) throw new NotFoundException("איש קשר לא נמצא");
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
export function visibleCallsCondition(
  tenantId: string,
  userId: string,
  /** `null` = רואה כל לקוח במשרד, ולכן אין מה להגביל */
  visible: string[] | null,
): Prisma.Sql {
  if (visible === null) return Prisma.sql`c.tenant_id = ${tenantId}`;
  return Prisma.sql`
    c.tenant_id = ${tenantId}
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
