/**
 * לאן מובילה התראה — מקור אמת אחד לפעמון ולמסך ההתראות.
 *
 * שתי רשימות נפרדות היו מתפצלות ביום שמתווסף סוג ישות: ההתראה
 * הייתה לחיצה במסך אחד ומתה בשני.
 */

import type { Capability } from "@metavchim/shared";

/**
 * יעד ההתראה, יחד עם היכולות שנדרשות כדי לפתוח אותו.
 *
 * `Capability` ולא `string`: שם יכולת שגוי הוא בדיוק התקלה שהמפה
 * הזו נועדה למנוע — הוא היה מסתיר קישור תקין ממי שכן רשאי, בלי
 * שדבר ייכשל. הטיפוס הופך שגיאת כתיב לשגיאת קומפילציה.
 */
interface Target {
  href: string;
  /** אחת מהן מספיקה. חסר = היעד פתוח לכל מי שמחובר. */
  needs?: readonly Capability[];
}

function targetFor(entityType: string, entityId: string): Target | null {
  switch (entityType) {
    case "property":
      return { href: `/properties/${entityId}`, needs: ["properties.view"] };
    case "lead":
      return { href: `/leads/${entityId}`, needs: ["leads.view_own"] };
    case "appointment":
      return { href: "/calendar", needs: ["calendar.manage"] };
    case "task":
      return { href: "/calendar", needs: ["calendar.manage"] };
    case "buyer":
      return { href: `/buyers/${entityId}`, needs: ["buyers.view_own"] };
    /*
     * להצעה אין מסך משלה — היא נצפית דרך כרטיס הנכס — אבל מזהה
     * ההצעה אינו מזהה הנכס, ולכן אי אפשר לקפוץ ישירות. רשימת
     * ההצעות היא הקרובה ביותר: ההצעה שההתראה מדברת עליה נמצאת בה.
     */
    case "offer":
      return { href: "/offers", needs: ["offers.send"] };
    /*
     * שתי ההתראות האלה משרדיות (`recipientUserId` אינו נקבע), ולכן
     * הן מגיעות גם למי שאינו רשאי לפתוח את היעד. בלי `needs` הן
     * היו שולחות אותו לנתיב שיחזיר 403 (ביקורת Codex).
     */
    case "coop_offer":
      // הלשונית מפורשת: בלעדיה ההתראה נחתה על "ביקושים ברשת", וההצעה
      // שההתראה דיברה עליה נראתה כאילו איננה
      return { href: "/collaboration?tab=incoming" };
    case "shared_lead":
      return { href: "/collaboration" }; // "נקלטה" מוצג בלשונית ההפניות
    /*
     * שיחה נבחרת בתוך הרשימה ואין לה נתיב משלה, ולכן פרמטר ולא
     * קטע נתיב. בלי זה ההתראה על סיום תמלול הייתה נוחתת על רשימת
     * השיחות בלי לבחור את השיחה שהיא מדברת עליה.
     *
     * שתי היכולות, כמו בשרת: שיחה תלויה בלקוח, ולקוח הוא ליד או קונה.
     */
    case "call":
      return {
        href: `/calls?call=${entityId}`,
        needs: ["leads.view_own", "buyers.view_own"],
      };
    /*
     * ‎**חדר העסקה — הישות שהתראותיה מתו בפעמון** (בקשת המשתמש:
     * ‏„אם יש הודעה בחדר עסקה משותפת אז שההודעה תפתח את החדר”).
     *
     * ‏שתי התראות נכתבות עם `coop_deal` — „נפתח חדר עסקה משותף”
     * ו„הודעה חדשה בחדר עסקה” — ולשתיהן היה מסלול תקין בוואטסאפ
     * ובהתראת הדחיפה, ולא כאן. המפה הזו נעצרה ב-`default: null`,
     * הפעמון תרגם `null` ל„לכל ההתראות”, והלחיצה נחתה ברשימה
     * במקום בחדר.
     *
     * ‏שני הצדדים בעסקה: מי שהציע ומי שקיבל, ולכן די באחת מהשתיים.
     */
    case "coop_deal":
      return {
        href: `/collaboration/deals/${entityId}`,
        needs: ["collaboration.offer", "collaboration.share"],
      };
    /* ‏ביקוש ברשת — הלשונית, כי לביקוש בודד אין מסך */
    case "coop_demand":
      return { href: "/collaboration?tab=demands", needs: ["collaboration.offer"] };
    /* ‏להתאמה אין נתיב משלה; היא נמצאת ברשימה שההתראה מדברת עליה */
    case "match":
      return { href: "/matches", needs: ["matches.view"] };
    /*
     * ‏`mentor_achievement` ‎אינו כאן במכוון: `/mentor` מציג היום
     * „בקרוב” בלבד, והמסך הבנוי מחכה ב-`mentor-screen.tsx` בלי ניתוב.
     * הנפילה ל-`null` שולחת את הלוחץ למסך ההתראות, שבו גוף ההתראה
     * מוצג — במקום לעמוד שאין בו ההישג (ביקורת Codex). ההסבר המלא,
     * ומה להחזיר כשהמסך ייחשף, יושבים ב-`web-push.ts`.
     */
    /*
     * ‏שתי אלה משרדיות ומגיעות גם לסוכן: „החיבור נפל”, „המספר
     * שהושכר”. בלי `needs` הן היו שולחות אותו למסך הגדרות שיחזיר
     * ‎403.
     */
    case "integration":
      return { href: "/settings/integrations", needs: ["settings.manage"] };
    case "virtual_number":
      return { href: "/settings#virtual-numbers", needs: ["settings.manage"] };
    default:
      return null;
  }
}

/**
 * `null` = „אין יעד ספציפי”, וזו תשובה אמיתית ולא חוסר.
 *
 * הפעמון הופך אותה למסך ההתראות המלא, כדי שכל שורה בו תהיה
 * לחיצה (בקשת המשתמש); מסך ההתראות עצמו מסתיר את הקישור, כי
 * הפניה מהמסך אל עצמו אינה עוזרת לאיש. ההחלטה הזו שייכת לכל
 * מסך בנפרד, ולכן היא אינה נאפית לתוך המפה.
 *
 * `can` — מה המשתמש רשאי. יעד שהוא אינו רשאי לפתוח אינו יעד: הוא
 * מוחזר כ-`null` בדיוק כמו סוג ישות שאין לו מסך, כי מבחינת מי
 * שלוחץ אין הבדל בין „אין לאן” לבין „יש לאן ותיחסם בכניסה”.
 */
export function notificationHref(
  entityType: string | undefined,
  entityId: string | undefined,
  can: (capability: Capability) => boolean,
): string | null {
  if (!entityType || !entityId) return null;
  const target = targetFor(entityType, entityId);
  if (target === null) return null;
  if (target.needs === undefined) return target.href;
  return target.needs.some(can) ? target.href : null;
}
