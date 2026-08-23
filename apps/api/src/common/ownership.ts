import { NotFoundException } from "@nestjs/common";
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
    where: { id: leadId, tenantId, ...ownershipFilter("leads.view_all", "assignedToUserId") },
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

export async function visibleContactIds(
  tx: TenantTx,
  tenantId: string,
): Promise<string[] | null> {
  const ctx = TenantContext.current();
  const sources = contactSources();
  /*
   * „בלי הגבלה” רק כשבאמת אין מה להגביל: מנהל שרואה את כל הקונים
   * ואת כל הלידים, ושמודול הנכסים פתוח אצלו. חסר אחד מהשלושה —
   * הרשימה נבנית, אחרת הקיצור היה מחזיר גם לקוחות ממקור חסום.
   */
  if (
    ctx.capabilities.has("buyers.view_all") &&
    ctx.capabilities.has("leads.view_all") &&
    sources.properties
  ) {
    return null;
  }

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
          where: { tenantId, ...ownershipFilter("leads.view_all", "assignedToUserId") },
          select: { contactId: true },
        })
      : [],
    sources.properties
      ? tx.property.findMany({
          where: { tenantId, deletedAt: null, ownerContactId: { not: null } },
          select: { ownerContactId: true },
        })
      : [],
  ]);

  return [
    ...new Set([
      ...buyers.map((row) => row.contactId),
      ...leads.map((row) => row.contactId),
      ...properties.map((row) => row.ownerContactId!),
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
          where: { tenantId, contactId, ...ownershipFilter("leads.view_all", "assignedToUserId") },
          select: { id: true },
        })
      : null,
    sources.properties
      ? tx.property.findFirst({
          where: { tenantId, ownerContactId: contactId, deletedAt: null },
          select: { id: true },
        })
      : null,
  ]);
  if (!buyer && !lead && !property) throw new NotFoundException("איש קשר לא נמצא");
}
