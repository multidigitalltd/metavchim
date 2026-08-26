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

export function ReadinessCard({
  propertyId,
  property,
  /** מעבר ללשונית אחרת בכרטיס — פעולה בתוך הדף, לא ניווט. */
  onSelectTab,
  /** גלילה לסעיף בלשונית הסקירה, אחרי שהיא נבחרה. */
  onScrollToSection,
}: {
  propertyId: string;
  property: ReadinessCardProperty;
  onSelectTab: (tab: string) => void;
  onScrollToSection: (id: string) => void;
}) {
  const router = useRouter();
  const band = readinessBand(property.readinessScore);
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
          מוכנות הנכס
        </h2>
        {/*
          גלולת האחוז בצבע הרצועה. `readinessBand` מחזיקה שני ערכים
          לכל רצועה כי הספים שונים — 3:1 לגרפיקה, 4.5:1 לטקסט — וכאן
          הטקסט הוא שנקרא.
        */}
        <span
          className="mv-pill ms-auto"
          style={{
            background: "var(--color-surface-sunken)",
            color: band.text,
            fontWeight: 900,
            fontSize: "var(--type-metric)",
            letterSpacing: "var(--type-metric-track)",
          }}
        >
          <Ltr>{property.readinessScore}%</Ltr>
        </span>
      </div>

      <div
        className="mt-[15px] overflow-hidden rounded-full"
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

      <p
        className="m-0 mt-2.5"
        style={{ fontSize: "var(--type-body)", color: "var(--color-text-muted)" }}
      >
        {readinessCount(property.missingFields.length, PROPERTY_READINESS_FIELDS.length)}
      </p>

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
        שלוש עמודות במסמך; במסך צר הן נעשות שתיים ואז אחת. תא של
        שלוש עמודות ברוחב טלפון היה מקצץ „‎₪2,150,000” לשתי שורות
        חתוכות — וזה בדיוק המספר שבגללו פותחים את הכרטיס.
      */}
      <dl className="m-0 mt-[15px] grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
        {PROPERTY_READINESS_FIELDS.map((field) => {
          const isMissing = missing.has(field);
          return (
            <div
              key={field}
              className="rounded-[17px] px-4 py-3.5"
              style={{
                background: "var(--color-surface-sunken)",
                border: "1px solid var(--color-border)",
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
              <dd className="m-0 mt-1.5">
                {isMissing ? (
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
                    חסר
                  </button>
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
    </section>
  );
}
