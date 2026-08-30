"use client";

import { useRouter } from "next/navigation";
import {
  PROPERTY_READINESS_FIELDS,
  readinessFieldLabel,
  type PropertyReadinessField,
} from "@metavchim/shared";
import { formatPrice } from "@/lib/format";
import {
  readinessBand,
  readinessCount,
  readinessFieldTarget,
  readinessTargetHref,
} from "@/lib/readiness";
import { IconCheck, IconTarget } from "../../icons";

/**
 * שדה שאינו נספר במוכנות. `value: null` = חסר, ומוצג כמקף.
 *
 * ‎**המקף הוא תצוגה, ולא הערך.** „Missing value prints an em dash —
 * never an empty cell” (SPEC-3c §5): תא ריק נראה כמו תקלת טעינה,
 * ומקף אומר „נבדק, ואין”. `null` בקוד ולא המחרוזת „—”, אחרת אי
 * אפשר להבדיל בין שדה חסר לשדה שערכו במקרה מקף.
 *
 * ‎`ltr` מסומן על השדה ואינו נגזר מהתוכן: „3 מתוך 8” הוא ביטוי
 * עברי שמכיל ספרות, ובידודו היה הופך אותו ל„8 מתוך 3”.
 */
export interface DetailField {
  label: string;
  value: string | null;
  /** מספרים, מידות ותאריכים — DESIGN-SYSTEM-4. */
  ltr?: boolean;
}


/**
 * ‎**כרטיס המוכנות — SPEC-3b §4.**
 *
 * „The first card of the tab, and the reason the screen exists: it names
 * what is missing before the listing can work.”
 *
 * ## מה החליף מה
 *
 * הכרטיס הקודם הציג אחוז, פס, שורת ספירה ו**רשימת נקודות** של מה
 * שחסר. הרשימה אמרה „חסרים: קומה, תמונות” ולא אמרה מה יש, ולא היה
 * אפשר ללחוץ עליה. תחתיה ישב כפתור „השלם פרטים” אחד לכל החוסרים.
 *
 * המסמך מבקש רשת של תשעה תאים — כל שדה, מלא או חסר. תא מלא מציג את
 * הערך; תא חסר מציג גלולת „חסר” **שהיא עצמה הכפתור** לאותו שדה.
 * ההבדל אינו קוסמטי: „חסרה קומה” שולח לטופס ומחפש, ואילו גלולה
 * שנלחצת פותחת את שדה הקומה ממוקד.
 *
 * ## שלושת המספרים שאסור להם לסתור
 *
 * „That count, the grid below and the percentage above MUST agree.
 * Never three numbers for one listing” (SPEC-3b §4).
 *
 * האחוז מגיע מהשרת, `missingFields` מגיע מהשרת, והרשת נגזרת משניהם:
 * שדה מלא הוא בדיוק „אינו ב-`missingFields`”. אין כאן חישוב מקביל
 * שיכול להיפרד, וגם אין רשימת שדות משלנו — `PROPERTY_READINESS_FIELDS`
 * היא אותה רשימה שממנה השרת חישב.
 *
 * ‎**הערך שמוצג אינו קובע נוכחות.** מפתה לכתוב „אם יש מחיר הצג
 * אותו, אחרת גלולה”, אבל אז לתא יש דעה משלו על מה חסר — ואם היא
 * תיפרד מהשרת ולו במקרה קצה אחד, יהיו שוב שלושה מספרים לנכס אחד.
 * הנוכחות היא של השרת; הערך הוא רק תצוגה.
 *
 * ## שני תאים בלי ערך אמיתי להציג
 *
 * „תמונות” ו„תיאור” הם קיום, לא מספר: הכרטיס אינו מחזיק את מניין
 * התמונות ואת גוף התיאור, ושניהם ממילא אינם ערך שמסתדר בתא של
 * שלוש עמודות. „יש” הוא בדיוק מה שהחישוב יודע, ולא יותר.
 */

/** מספרים ומידות ב-LTR — DESIGN-SYSTEM-4, וכמו בשאר המסכים. */
function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
      {children}
    </span>
  );
}

export interface ReadinessCardProperty {
  readinessScore: number;
  missingFields: string[];
  priceAgorot?: number;
  areaSqm?: number;
  rooms?: number;
  floor?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  ownerContact?: { name: string };
}

/**
 * הערך שמוצג בתא מלא.
 *
 * ‎`floor` נבדק מול `undefined` ולא בבדיקת אמת: קומת קרקע היא 0,
 * ובדיקה נאיבית הייתה מציגה „—” לנכס שהקומה שלו מולאה כהלכה.
 * אותו נימוק ל-`false` של מעלית וחניה — „אין מעלית” הוא מידע מלא.
 */
function fieldValue(
  field: PropertyReadinessField,
  property: ReadinessCardProperty,
): React.ReactNode {
  switch (field) {
    case "priceAgorot":
      return <Ltr>{formatPrice(property.priceAgorot)}</Ltr>;
    case "areaSqm":
      return <Ltr>{property.areaSqm ?? "—"}</Ltr>;
    case "rooms":
      return <Ltr>{property.rooms ?? "—"}</Ltr>;
    case "floor":
      return <Ltr>{property.floor ?? "—"}</Ltr>;
    case "hasElevator":
      return property.hasElevator === true ? "יש" : "אין";
    case "hasParking":
      return property.hasParking === true ? "יש" : "אין";
    case "owner":
      return property.ownerContact?.name ?? "—";
    /* תמונות ותיאור — ראו ההערה בראש הקובץ. */
    case "images":
    case "marketingDescription":
      return "יש";
    default: {
      /*
       * שדה עשירי שיתווסף לחישוב חייב לקבל תצוגה מפורשת. בלי
       * השורה הזו הוא היה נופל ל„יש” בשקט — כלומר תא שמצהיר על
       * ערך שאיש לא כתב. אותו נימוק בדיוק שבגללו
       * `PROPERTY_READINESS_LABELS` ממופה על הטיפוס ולא על מחרוזת:
       * המהדר מפיל, ולא המסך.
       */
      const unhandled: never = field;
      return unhandled;
    }
  }
}

/**
 * ‎**„לאן שולחים כדי לתקן את השדה הזה” — הכרעה אחת, לשני הקוראים.**
 *
 * שני השדות `images` ו-`owner` **אינם בטופס העריכה**: תמונות יושבות
 * ברכיב ההעלאה שבסקירה, ובעל הנכס הוא קישור לכרטיס איש קשר שנבחר
 * בלשונית שלו. `readinessFieldTarget` יודעת את זה מאז שהמוכנות עברה
 * לתשעה שדות.
 *
 * הרצועה שבכותרת נכתבה בתחילה עם ניווט ישיר לטופס — ולכן נכס שכל
 * מה שחסר בו הוא תמונות או בעלים היה שולח את המתווך למסך שאין בו מה
 * לתקן, מהכפתור הבולט ביותר בעמוד (ביקורת Codex). הכפתור מכוון
 * עכשיו לחוסר הראשון, דרך אותה פונקציה שמפעילה את תשע הגלולות.
 */
export function openReadinessField({
  router,
  propertyId,
  field,
  onSelectTab,
  onScrollToSection,
}: {
  router: ReturnType<typeof useRouter>;
  propertyId: string;
  field: string;
  onSelectTab: (tab: string) => void;
  onScrollToSection: (id: string) => void;
}): void {
  const target = readinessFieldTarget(field);
  if (target.kind === "form") {
    router.push(readinessTargetHref(propertyId, target));
    return;
  }
  if (target.kind === "tab") {
    onSelectTab(target.tab);
    return;
  }
  onSelectTab("overview");
  onScrollToSection(target.id);
}

/**
 * ‎**רצועת המוכנות — בראש העמוד, לא בתוך הכרטיס.**
 *
 * האחוז הוא הדבר הראשון שמתווך מסתכל עליו כשהוא פותח נכס, והוא ישב
 * בתוך כרטיס שנמצא אחרי הלשוניות — כלומר מתחת לקפל, אחרי שכבר בחר
 * לשונית. כאן הוא צמוד לכותרת הנכס, לצד הכפתור שמתקן אותו.
 *
 * הרצועה והכרטיס חולקים קובץ אחד בכוונה: `readinessBand` מחזיקה שני
 * ערכים לכל רצועה — 3:1 לגרפיקה ו-4.5:1 לטקסט — ופיצול בין קבצים
 * היה מזמין עותק שני של הספים.
 */
export function ReadinessStrip({
  propertyId,
  property,
  onSelectTab,
  onScrollToSection,
}: {
  propertyId: string;
  property: Pick<ReadinessCardProperty, "readinessScore" | "missingFields">;
  onSelectTab: (tab: string) => void;
  onScrollToSection: (id: string) => void;
}) {
  const router = useRouter();
  const band = readinessBand(property.readinessScore);
  const missing = property.missingFields.length;
  /*
   * ‎**החוסר הראשון, ולא הטופס.** ראו `openReadinessField` — תמונות
   * ובעלים אינם בטופס העריכה, והכפתור הבולט בעמוד היה שולח אליו.
   * הסדר הוא של `PROPERTY_READINESS_FIELDS`, כלומר אותו סדר שבו
   * התאים מוצגים.
   */
  const firstGap = property.missingFields[0];

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          style={{
            fontSize: "var(--type-metric)",
            fontWeight: 900,
            letterSpacing: "var(--type-metric-track)",
            color: band.text,
          }}
        >
          <Ltr>{property.readinessScore}%</Ltr>
        </span>
        <span style={{ fontSize: "var(--type-body)", fontWeight: 800 }}>מוכנות לשיווק</span>
        {missing > 0 ? (
          <span style={{ fontSize: "var(--type-body)", color: "var(--color-text-muted)" }}>
            {missing === 1 ? "שדה אחד חסר" : `${missing} שדות חסרים`} — נכס מלא מקבל יותר פניות
          </span>
        ) : (
          <span
            className="flex items-center gap-1.5 font-bold"
            style={{ fontSize: "var(--type-body-sm)", color: "var(--color-primary)" }}
          >
            <IconCheck s={16} />
            הנכס מוכן לשיווק
          </span>
        )}
      </p>

      {missing > 0 ? (
        <button
          type="button"
          className="mv-btn-soft ms-auto"
          onClick={() => {
            if (firstGap === undefined) return;
            openReadinessField({
              router,
              propertyId,
              field: firstGap,
              onSelectTab,
              onScrollToSection,
            });
          }}
        >
          השלם פרטים
        </button>
      ) : null}

      {/*
        הפס אחרון בסדר ה-DOM ותופס שורה מלאה: הוא גרפיקה שמשכפלת את
        האחוז שכבר נאמר במילים, ולכן `aria-hidden`. קורא מסך שמקבל
        „34%” ואחריו סרגל התקדמות מקבל את אותו נתון פעמיים.
      */}
      <div
        aria-hidden="true"
        className="w-full overflow-hidden rounded-full"
        style={{ height: 8, background: "var(--color-progress-track)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${property.readinessScore}%`,
            background: band.bar,
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

export function ReadinessCard({
  propertyId,
  property,
  /**
   * ‎**מה שאינו נספר במוכנות ובכל זאת שייך לכרטיס.**
   *
   * הרשת מציגה את תשעת שדות המוכנות בלבד — זה מה שמגדיר את הציון,
   * ותא עשירי היה שובר את „מספר אחד, תשעה שדות” (#247). אבל לנכס
   * יש שדות שאינם נספרים: סוג הנכס, מועד הכניסה והמאפיינים. הם
   * ישבו בכרטיס נפרד שנשא את אותה כותרת בדיוק, ולכן מוזגו לכאן —
   * מתחת לרשת, כרשימת הגדרות.
   */
  extraFields,
  /** מעבר ללשונית אחרת בכרטיס — פעולה בתוך הדף, לא ניווט. */
  onSelectTab,
  /** גלילה לסעיף בלשונית הסקירה, אחרי שהיא נבחרה. */
  onScrollToSection,
}: {
  propertyId: string;
  property: ReadinessCardProperty;
  extraFields: DetailField[];
  onSelectTab: (tab: string) => void;
  onScrollToSection: (id: string) => void;
}) {
  const router = useRouter();
  const missing = new Set(property.missingFields);

  /*
   * הגלולה מבצעת את היעד, ואינה קישור.
   *
   * שני מהיעדים השלושה — לשונית ובסעיף שבסקירה — הם באותו דף.
   * ניווט „אליו” אינו מרכיב אותו מחדש, ולכן `?tab=owner` היה משנה
   * כתובת בזמן שהלשונית נשארת במקומה, ועוגן לסעיף שבתוך לשונית
   * סגורה מצביע על אלמנט שאינו ב-DOM. אותה החלטה בדיוק שכבר תועדה
   * על „מצא לי קונים” ועל „השלם פרטים”, וכאן היא חוזרת פעם אחת
   * לתשעה תאים במקום פעם אחת לכפתור.
   */
  function openField(field: string): void {
    openReadinessField({ router, propertyId, field, onSelectTab, onScrollToSection });
  }

  return (
    <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="readiness-heading">
      <div className="flex items-center gap-3">
        {/*
          אריח האייקון בטוקנים של NEUTRAL: „A metric at 0 switches to
          NEUTRAL” אינו הכלל כאן, אבל הכרטיס עצמו אינו תחום — האחוז
          שבתוכו הוא שנושא את המשמעות, וצבע נוסף על האריח היה שני
          צבעי תחום בקומפוננטה אחת.
        */}
        <span
          aria-hidden="true"
          className="grid flex-none place-items-center rounded-[13px]"
          style={{
            width: 38,
            height: 38,
            background: "var(--color-surface-sunken)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <IconTarget s={19} />
        </span>
        <h2
          id="readiness-heading"
          className="m-0"
          style={{
            fontSize: "var(--type-panel)",
            fontWeight: 900,
            letterSpacing: "-0.025em",
          }}
        >
          {/*
            ‎**כרטיס אחד, אחרי שהיו שניים.**

            ‎`DetailsCard` נשא את אותה כותרת בדיוק (SPEC-3c §5) וישב
            מיד מתחת, עם ארבעה שדות שכבר מופיעים ברשת. שלושת השדות
            שהיו רק שם — סוג, כניסה/מסירה ומאפיינים — עברו לכאן
            כ-`extraFields`, ולכן המיזוג אינו מוריד דבר.
          */}
          פרטי הנכס
        </h2>
        {/*
          ‎**הספירה בכותרת, והאחוז ברצועה שבראש העמוד.**

          שני המספרים תיארו את אותו דבר פעמיים בתוך כרטיס אחד —
          גלולת אחוז, פס התקדמות, ומשפט „‏2 מתוך 9”. הרצועה שבראש
          העמוד נושאת עכשיו את האחוז ואת הפס (`ReadinessStrip`),
          והכרטיס נושא את מה שהוא באמת מציג: אילו שדות מלאים.
        */}
        <span
          className="m-0"
          style={{ fontSize: "var(--type-body)", color: "var(--color-text-muted)" }}
        >
          {readinessCount(property.missingFields.length, PROPERTY_READINESS_FIELDS.length)}
        </span>
        {/*
          ‎**„עריכת פרטים” לצד תשע הגלולות, ולא במקומן.**

          הגלולה פותחת את השדה שחסר; הכפתור הזה פותח את הטופס כולו.
          מי שיודע מה הוא רוצה לתקן לוחץ על התא, ומי שממלא נכס חדש
          מלמעלה למטה פותח את הטופס פעם אחת.
        */}
        <button
          type="button"
          className="mv-btn-plain ms-auto"
          onClick={() => router.push(`/properties/${propertyId}/edit`)}
        >
          עריכת פרטים
        </button>
      </div>

      {property.missingFields.length === 0 ? (
        <p
          className="m-0 mt-2 flex items-center gap-2 font-bold"
          style={{ fontSize: "var(--type-body-sm)", color: "var(--color-primary)" }}
        >
          {/* אייקון ולא „✓” — „NO EMOJI anywhere in the product UI” */}
          <IconCheck s={18} />
          הנכס מוכן לשיווק
        </p>
      ) : null}

      {/*
        ‎**שלוש עמודות, מפורשות.**
        „3 columns, gap 12px” (SPEC-3b §4) — תשעה שדות בשלוש שורות של
        שלושה.

        הניסוח הראשון היה `auto-fit` עם מינימום 148px, מתוך מחשבה
        ש„שלוש במסך רחב ופחות במסך צר” נובע מאליו. הוא אינו נובע:
        בטור הראשי שרוחבו כ-760px נכנסות **ארבע** עמודות של 148,
        והרשת נשברת ל-4+4+1 — כלומר בדיוק לא מה שהמסמך מבקש, ודווקא
        במסך שבו רוב העבודה נעשית (ביקורת Codex). `auto-fit` עונה על
        „כמה שנכנס”, והשאלה כאן היא „כמה צריך”.

        המדרגות למטה מפורשות אף הן: שתיים מ-640px ואחת מתחת. תא ברוחב
        שליש-טלפון היה מקצץ „‎₪2,150,000” — וזה בדיוק המספר שבגללו
        פותחים את הכרטיס. באחת אין מה שיישבר, וגם בהגדלת טקסט ל-200%.
      */}
      {/*
        ‎**הרוחב נמדד מול התא, לא מול החלון.**

        ‎`md:grid-cols-3` נשען על רוחב החלון, בזמן שהכרטיס יושב בטור
        צר יותר — סרגל צד ופריסה דו-טורית. ב-1024 פיקסלים זה נתן
        שלושה תאים של כ-180, ו-Tailwind מתרגם `grid-cols-3`
        ל-`minmax(0, 1fr)` שמרשה לתא להצטמצם **מתחת** לתוכנו: המחיר
        „3,490,000 ₪” חרג 35 פיקסלים אל מחוץ למסגרת (דיווח בעל
        המוצר, נמדד בדפדפן). הוא גם אינו יכול להישבר — `Intl` מפריד
        את הסימן ברווח קשיח.

        ‎`max()` בתוך `minmax()` פותר את שניהם בלי שאילתת מיכל: רוחב
        שלושה טורים כשהוא מספיק, ולא פחות מ-170 — וכשאין מקום ל-170,
        ‎`auto-fit` יורד לשניים ואז לאחד. התקרה נשמרת (לעולם לא
        ארבעה), וזו הייתה הכוונה המקורית: „כמה צריך”, לא „כמה שנכנס”.
      */}
      <dl
        className="m-0 mt-[15px] grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(max(170px, (100% - 1.5rem) / 3), 1fr))",
        }}
      >
        {PROPERTY_READINESS_FIELDS.map((field) => {
          const isMissing = missing.has(field);
          return (
            /*
             * ‎**התא צבוע לפי מצבו — ולא ניטרלי לכולם.**
             *
             * תשעה תאים זהים דורשים קריאה של כל אחד כדי לדעת מה
             * חסר; הצבע עונה על זה במבט. ירוק רך למלא, אפרסק לחסר —
             * אותם טוקנים של הצלחה ושל חוסר בשאר המערכת, ולכן הם
             * נכונים גם בכהה ובניגודיות גבוהה. הצבע אינו הסימן
             * היחיד: הגלולה „להשלים” אומרת זאת גם במילים.
             */
            <div
              key={field}
              className="rounded-[17px] px-4 py-3.5"
              style={{
                background: isMissing
                  ? "var(--color-danger-soft)"
                  : "var(--color-success-soft)",
                border: `1px solid ${
                  isMissing ? "var(--color-danger)" : "var(--color-success)"
                }`,
              }}
            >
              <dt
                style={{
                  fontSize: "var(--type-caption)",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                }}
              >
                {readinessFieldLabel(field)}
              </dt>
              <dd className="m-0 mt-1.5 flex items-center gap-2">
                {isMissing ? (
                  <>
                    {/*
                      הקו המפריד — „אין כאן ערך”, לפני שהגלולה אומרת
                      מה לעשות עם זה. `aria-hidden`: קורא המסך מקבל
                      את אותו מידע מהתווית שעל הכפתור.
                    */}
                    <span aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>
                      —
                    </span>
                  <button
                    type="button"
                    className="mv-pill"
                    /*
                      התווית לקורא מסך נושאת את שם השדה: תשע גלולות
                      שכולן „חסר” הן תשעה כפתורים זהים למי שאינו רואה
                      את התווית שמעליהן.
                    */
                    aria-label={`${readinessFieldLabel(field)} — חסר, להשלמה`}
                    style={{
                      /*
                        ‎**44px שטח נגיעה** — „Minimum hit target 44px”
                        (DESIGN-SYSTEM-2 §10).

                        ‎`mv-pill` היא תווית: ריפוד 4px/11px, כלומר
                        גובה של כ-33. כתווית זה נכון; כפתור בגודל
                        הזה הוא כפתור שקשה לפגוע בו — במסך מגע,
                        ובמיוחד למי שידו אינה יציבה. ואלה תשעת
                        הכפתורים שכל תכליתם „לחץ כדי להשלים”.

                        המראה נשאר גלולה: הרוחב נגזר מהתוכן והפינות
                        עגולות, רק הגובה מובטח.
                      */
                      minHeight: 44,
                      display: "inline-flex",
                      alignItems: "center",
                      background: "var(--color-danger-soft)",
                      /*
                        מסגרת מפורשת ולא רק מילוי: גלולה שהיא כפתור
                        היא פקד, וגבול פקד כפוף ל-3:1 של WCAG 1.4.11.
                        `mv-pill` לבדה היא תווית — היא לא מגדירה
                        מסגרת, ולכן על משטח בהיר הכפתור היה נראה
                        כטקסט צבעוני (שער הניגודיות).
                      */
                      border: "1px solid var(--color-danger)",
                      color: "var(--color-danger)",
                      fontWeight: 800,
                      fontSize: "var(--type-caption-lg)",
                      cursor: "pointer",
                    }}
                    onClick={() => openField(field)}
                  >
                    להשלים
                  </button>
                  </>
                ) : (
                  <span
                    style={{
                      fontSize: "var(--type-metric)",
                      fontWeight: 900,
                      letterSpacing: "var(--type-metric-track)",
                    }}
                  >
                    {fieldValue(field, property)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {/*
        ‎**מתחת לרשת, ולא בתוכה.** אלה שדות שאינם נספרים במוכנות,
        ולכן אין להם תא עם גלולת „להשלים” — הצורה שלהם היא רשימת
        הגדרות, וערך חסר בה הוא מקף („נבדק, ואין”) ולא תא ריק.
      */}
      {extraFields.length === 0 ? null : (
        <dl className="mv-deflist mt-[15px]">
          {extraFields.map((field) => (
            <div className="mv-deflist__row" key={field.label}>
              <dt className="mv-deflist__label">{field.label}</dt>
              <dd
                className="mv-deflist__value"
                data-empty={field.value === null ? "true" : undefined}
                {...(field.ltr && field.value !== null
                  ? { dir: "ltr" as const, style: { unicodeBidi: "isolate" as const } }
                  : {})}
              >
                {field.value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
