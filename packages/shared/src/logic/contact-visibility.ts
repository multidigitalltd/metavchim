import type { Capability } from "../rbac.js";

/**
 * ‎**מי הלקוחות שאני רשאי לראות — המדיניות, בלי מסד.**
 *
 * ## ‏למה כאן ולא ב-`ownership.ts`
 *
 * ‏השאלה נשאלת בשני תהליכים: השרת, וסבב ההתראות של העובד. העובד
 * ‏אינו יכול לייבא מה-API — הוא מייבא רק את החבילה המשותפת — ולכן
 * ‏„הגבול נאכף בקריאה” נעצר בגבול החבילה, וההתראה יצאה בוואטסאפ
 * ‏עם השם, הטלפון וקישור הטופס בזמן שהמסך כבר הסתיר אותם (ביקורת
 * ‏Codex, P1).
 *
 * ‏המדיניות עברה לכאן ולא רק „פונקציה משותפת”: מה שמיוצא הוא
 * ‏**תנאי השאילתה** כנתונים. כל תהליך מריץ אותם דרך ה-Prisma שלו,
 * ‏ולכן אין כאן תלות במסד ואין קאסטים — ובכל זאת יש ניסוח אחד.
 */

/** ‏אילו מקורות בכלל פתוחים למי שמחזיק את היכולות האלה. */
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

/**
 * ‏רואה כל לקוח במשרד — ולכן אין מה לסנן.
 *
 * ‏„בלי הגבלה” רק כשבאמת אין מה להגביל: כל הקונים, כל הלידים, וגם
 * ‏כל הנכסים. חסר אחד מהשלושה והקיצור היה מחזיר לקוחות ממקור חסום
 * ‏דווקא למי שהכי הרבה פתוח אצלו — קיצור שמחזיר יותר מהתנאי המלא
 * ‏הוא באג שקט בכיוון המסוכן.
 */
export function seesAllContactsWith(caps: ReadonlySet<Capability>): boolean {
  return (
    caps.has("buyers.view_all") &&
    caps.has("leads.view_all") &&
    contactSourcesOf(caps).properties &&
    caps.has("properties.view_all")
  );
}

/**
 * ‏תנאי השאילתה לכל מקור, או `null` כשהמקור סגור בפני הצופה.
 *
 * ‎`null` בכל השלושה אינו „בלי סינון” אלא „בלי מקורות”; „בלי
 * ‏סינון” מסומן ב-`seesAllContactsWith` לפני שמגיעים לכאן.
 */
export interface ContactVisibilityFilters {
  buyers: { tenantId: string; deletedAt: null; ownerUserId?: string } | null;
  leads:
    | {
        tenantId: string;
        OR?: { assignedToUserId: string | null }[];
      }
    | null;
  properties:
    | {
        tenantId: string;
        deletedAt: null;
        OR: [{ ownerContactId: { not: null } }, { occupantContactId: { not: null } }];
        agentUserId?: string;
      }
    | null;
}

export function visibleContactFilters(
  tenantId: string,
  userId: string,
  caps: ReadonlySet<Capability>,
): ContactVisibilityFilters {
  const sources = contactSourcesOf(caps);
  return {
    buyers: sources.buyers
      ? {
          tenantId,
          deletedAt: null,
          ...(caps.has("buyers.view_all") ? {} : { ownerUserId: userId }),
        }
      : null,
    /*
     * ‎**ליד בלי סוכן משויך שייך לערימה המשותפת** — `null` ב-SQL
     * ‏אינו שווה לכלום, ולכן בלי הענף השני ליד לא-משויך אינו מתאים
     * ‏לאף סוכן. הוא אינו „של מישהו אחר”; הוא בלתי נראה.
     */
    leads: sources.leads
      ? {
          tenantId,
          ...(caps.has("leads.view_all")
            ? {}
            : { OR: [{ assignedToUserId: userId }, { assignedToUserId: null }] }),
        }
      : null,
    properties: sources.properties
      ? {
          tenantId,
          deletedAt: null,
          OR: [{ ownerContactId: { not: null } }, { occupantContactId: { not: null } }],
          ...(caps.has("properties.view_all") ? {} : { agentUserId: userId }),
        }
      : null,
  };
}

/**
 * ‏איסוף המזהים מהשורות שנשלפו — לנכס שני תפקידים, ולכן `flatMap`
 * ‏ולא `map`: בעלים **וגם** דייר הם שני אנשים שהמשרד רשאי לראות.
 */
export function contactIdsFromSources(
  buyers: readonly { contactId: string }[],
  leads: readonly { contactId: string }[],
  properties: readonly { ownerContactId: string | null; occupantContactId: string | null }[],
): string[] {
  return [
    ...new Set([
      ...buyers.map((row) => row.contactId),
      ...leads.map((row) => row.contactId),
      ...properties.flatMap((row) =>
        [row.ownerContactId, row.occupantContactId].filter((id): id is string => id !== null),
      ),
    ]),
  ];
}

/**
 * ‎**בעלות על כרטיס מצמצמת, ואינה מרחיבה** (ביקורת Codex, P1).
 *
 * ‏„מותר לי לראות את האדם” הוא **איחוד מקורות**: מספיק שאני מחזיק
 * ‏כרטיס קונה אחד עליו. איחוד אינו יכול לחסום — ולכן שורה שמצביעה
 * ‏על **כרטיס מסוים** של עמית עוברת בו, על אף שהנתיב לכרטיס עצמו
 * ‏דוחה אותי. `assertCallAccess` כבר עושה את זה נכון: הוא בודק את
 * ‏בעלות הליד **לפני** שער הלקוח, ולא כענף נוסף בתוכו.
 *
 * ‏אלה אותם שני כללים שהשרת אוכף על הנתיבים — `leadOwnershipFilter`
 * ‏ו-`ownershipFilter("buyers.view_all", "ownerUserId")` — בצורתם
 * ‏הטהורה, כדי שגם העובד יוכל לשאול אותם.
 */

/** ‏ליד לא-משויך הוא הערימה המשותפת, ולכן הוא גלוי לכל מי שהמודול פתוח אצלו. */
export function leadIsVisibleWith(
  caps: ReadonlySet<Capability>,
  userId: string,
  assignedToUserId: string | null,
): boolean {
  if (caps.has("leads.view_all")) return true;
  if (!caps.has("leads.view_own")) return false;
  return assignedToUserId === null || assignedToUserId === userId;
}

/**
 * ‏כרטיס קונה, לעומת זאת, **שייך** למישהו: `ownershipFilter` מייצר
 * ‏`{ ownerUserId: <אני> }`, ולכן כרטיס בלי בעלים אינו מתאים לאף
 * ‏סוכן — כאן זה מכוון, ולא הבאג של הלידים.
 */
export function buyerCardIsVisibleWith(
  caps: ReadonlySet<Capability>,
  userId: string,
  ownerUserId: string | null,
): boolean {
  if (caps.has("buyers.view_all")) return true;
  if (!caps.has("buyers.view_own")) return false;
  return ownerUserId === userId;
}
