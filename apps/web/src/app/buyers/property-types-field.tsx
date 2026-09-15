"use client";

import { useState } from "react";
import { PROPERTY_TYPE_LABELS } from "@/lib/format";
import { PropertyTypeOptions } from "../property-type-options";

/**
 * סוגי הנכס שהקונה מחפש.
 *
 * ## למה השדה הזה חסר עד עכשיו
 *
 * `propertyTypes` קיים במודל מאז ומתמיד, מנוע ההתאמות פוסל לפיו
 * (`matching.ts` — נכס שסוגו אינו ברשימה יורד), הוא נספר בציון
 * המוכנות של הקונה („סוג נכס”), והוא מתפרסם עם הביקוש לרשת
 * השיתופים. מה שלא היה זה מסך אחד שבו אפשר להזין אותו: כל נתיבי
 * הכתיבה — טופס קליטה, ייבוא מאקסל וקליטה בקול — שתלו `[]` קבוע.
 *
 * התוצאה הייתה שקטה ומטעה: קריטריון התאמה שלעולם אינו מסנן, וניקוד
 * מוכנות שמוריד לכל קונה נקודה שאיש אינו יכול להשלים.
 *
 * ## למה רשימה ולא בחירה אחת
 *
 * הרשימה נבחרת מרשימה נפתחת, אבל נשמרת כמערך — וזה מכוון. קונה
 * שמחפש דירה לא בהכרח פוסל דירת גן או פנטהאוז, ובחירה יחידה הייתה
 * הופכת את הקריטריון ממסנן מועיל למסנן שמפספס התאמות טובות. הבחירה
 * מוסיפה סוג, והסוגים שנבחרו מוצגים כתגיות שאפשר להסיר.
 *
 * ריק = **כל הסוגים**, וזו בדיוק ההתנהגות במנוע: מערך ריק אינו
 * מסנן דבר. לכן זהו גם המצב ההתחלתי, ולא „דירה” כברירת מחדל שקטה
 * שהייתה מסתירה נכסים בלי שאיש בחר בכך.
 */

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export function PropertyTypesField({
  initial = [],
  disabled = false,
}: {
  /** הסוגים שכבר נשמרו (בעריכה). */
  initial?: readonly string[];
  disabled?: boolean;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<string[]>([...initial]);

  const remaining = Object.entries(PROPERTY_TYPE_LABELS).filter(
    ([value]) => !chosen.includes(value),
  );

  function add(value: string): void {
    if (value === "" || chosen.includes(value)) return;
    setChosen([...chosen, value]);
  }

  return (
    <div>
      <label htmlFor="propertyTypePicker" className="mb-1 block font-medium">
        סוג נכס מבוקש
      </label>
      {/*
        השדה שנשלח בפועל. `select` מרובה היה שולח את הערכים לבד, אבל
        הוא גם בחירה שמחייבת Ctrl ואינה קריאה במובייל — ולכן הבחירה
        היא רשימה נפתחת רגילה, והערך נשלח מכאן.

        שדה יחיד עם ערכים מופרדים בפסיק ולא `input` לכל תגית: הטופס
        קורא אותו ב-`FormData.get`, ומספר שדות באותו שם היו דורשים
        `getAll` בכל אחד משני הטפסים — הבדל שנשכח בקלות באחד מהם.
      */}
      <input type="hidden" name="propertyTypes" value={chosen.join(",")} />
      <select
        id="propertyTypePicker"
        /*
          בלי `name`: זהו הבורר, לא הערך. שם כאן היה שולח לשרת גם את
          הסוג שמופיע בתיבה אחרי בחירה — סוג שכבר נוסף לתגיות.
        */
        value=""
        onChange={(event) => add(event.target.value)}
        disabled={disabled || remaining.length === 0}
        className="w-full rounded-lg border px-3 py-2.5"
        style={inputStyle}
      >
        <option value="">
          {chosen.length === 0
            ? "כל הסוגים — בחרו כדי לצמצם"
            : remaining.length === 0
              ? "כל הסוגים נבחרו"
              : "הוספת סוג…"}
        </option>
        <PropertyTypeOptions exclude={chosen} />
      </select>

      {chosen.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 p-0" style={{ listStyle: "none" }}>
          {chosen.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => setChosen(chosen.filter((v) => v !== value))}
                disabled={disabled}
                className="mv-chip"
                /*
                  התווית לבדה אומרת „דירה”, ולא „לחיצה תסיר את דירה”.
                  קורא מסך שומע רשימת כפתורים בלי לדעת מה הם עושים.
                */
                aria-label={`הסרת ${PROPERTY_TYPE_LABELS[value] ?? value}`}
              >
                {PROPERTY_TYPE_LABELS[value] ?? value}
                <span aria-hidden="true"> ✕</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        {chosen.length === 0
          ? "בלי בחירה — כל סוגי הנכסים מתאימים."
          : "נכס שסוגו אינו ברשימה לא יוצג כהתאמה."}
      </p>
    </div>
  );
}

/**
 * קריאת השדה מתוך הטופס — אותה פענוח בשני הטפסים.
 *
 * מסננת ערכים שאינם בקטלוג במקום להעביר אותם הלאה: הסכימה בשרת
 * דוחה אותם ממילא, וכאן זה ההבדל בין „הסוג לא נשמר” לבין טופס שלם
 * שנדחה בשגיאה שאינה מסבירה דבר.
 */
export function readPropertyTypes(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value in PROPERTY_TYPE_LABELS);
}
