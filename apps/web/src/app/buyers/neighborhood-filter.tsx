"use client";

import { useEffect, useState } from "react";
import { NeighborhoodInput } from "../neighborhood-input";

/**
 * ‎**סינון רשימת הקונים לפי שכונה.**
 *
 * ## למה בורר חופשי ולא רשימה נפתחת
 *
 * ‏שמות שכונות אינם רשומים בשום מרשם, ולכן אין רשימה סגורה שאפשר
 * ‏לפתוח. הבורר מציע את מה שכבר הוזן במשרד — אותו אוצר בדיוק שממנו
 * ‏השדות בטפסים מציעים — ומרשה להמשיך ולהקליד כל דבר אחר. מי שכתב
 * ‏שכונה שאיש עוד לא כתב ימצא את הקונים שלו גם בלי שהיא תהיה
 * ‏ברשימה.
 *
 * ## למה השהיה ולא שליחה בכל תו
 *
 * ‏הסינון רץ **בשרת** (כמו הבשלות, סטטוס המשרד ועמדת הטאבו), ולכן
 * ‏כל תו היה שאילתה ורשימה שקופצת מתחת לאצבע. ההשהיה ארוכה מזו של
 * ‏ההצעות עצמן: ההצעות הן עזר שמתרענן תוך כדי הקלדה, והסינון הוא
 * ‏פעולה שמחליפה את כל מה שעל המסך.
 *
 * ## ולמה הערך נשלט מבחוץ
 *
 * ‏„נקה סינון” של סרגל הרשימה מאפס את מצב העמוד, ושדה שמחזיק טקסט
 * ‏משל עצמו היה ממשיך להציג שכונה שכבר אינה מסננת — כלומר מסך
 * ‏שסותר את עצמו.
 */

/** ‏ארוכה מהשהיית ההצעות (200ms): זו שאילתה שמחליפה את הרשימה. */
const APPLY_DEBOUNCE_MS = 400;

/**
 * ‎**אותה תקרה של `ListQuerySchema`.**
 *
 * ‏בלעדיה הדבקה ארוכה היתה שולחת בקשה שהשרת דוחה ב-400
 * ‏— שגיאה על קלט שהמסך עצמו הזמין. המסננת חוסמת מראש,
 * ‏והעמוד מנקה שגיאה קודמת בכל טעינה שמצליחה.
 */
const NEIGHBORHOOD_FILTER_MAX = 80;

export function NeighborhoodFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);

  /*
   * ‏ההורה הוא המקור: ניקוי הסינון, או קישור נכנס עם `?neighborhood=`,
   * משנים את הערך מבחוץ והטיוטה חייבת ללכת אחריו.
   */
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), APPLY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    /*
     * ‎`onChange` אינו בתלויות בכוונה: הוא נוצר מחדש בכל רינדור של
     * העמוד, והכללתו הייתה מאפסת את הטיימר בכל רינדור — כלומר
     * סינון שלעולם אינו נשלח כל עוד משהו אחר על המסך מתעדכן.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);

  return (
    <div className="min-w-0" style={{ flex: "0 1 210px", minWidth: 170 }}>
      {/* התווית נשארת ב-DOM ומוסתרת חזותית — כמו בשאר הבוררים בשורה */}
      <label htmlFor="flt-neighborhood" className="mv-visually-hidden">
        סינון לפי שכונה
      </label>
      <NeighborhoodInput
        id="flt-neighborhood"
        name="neighborhood"
        value={draft}
        onValueChange={setDraft}
        maxLength={NEIGHBORHOOD_FILTER_MAX}
        placeholder="כל השכונות"
        style={{
          borderColor: "var(--color-input-border)",
          background: "var(--color-surface)",
          borderRadius: "var(--control-radius)",
          minHeight: "var(--control-h)",
          paddingBlock: 0,
          fontSize: "var(--type-caption)",
          fontWeight: 700,
        }}
      />
    </div>
  );
}
