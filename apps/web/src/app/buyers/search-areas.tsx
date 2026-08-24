"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_AREAS,
  MAX_SEARCH_RADIUS_KM,
  MIN_SEARCH_RADIUS_KM,
  describeDistance,
  searchAreaRejectionReason,
  type SearchArea,
} from "@metavchim/shared";
import {
  LocationPicker,
  type LocationValue,
} from "../properties/location-picker";
import { Notice } from "../notice";

/**
 * אזורי החיפוש של הקונה — **מה שהוא באמת מחפש, במקום שם עיר.**
 *
 * "מחפש בבני ברק" הוא קירוב: בפועל הוא מחפש ליד ההורים, או במרחק
 * הליכה מהעבודה. רשימת ערים אינה יודעת לבטא את זה, והיא גם מסתירה
 * נכס 300 מטר מעבר לגבול המוניציפלי — שהוא בדיוק הנכס שהקונה היה
 * שמח לראות.
 *
 * **כמה אזורים ולא אחד**, ולכל אחד רדיוס משלו: "רק בשכונה הזאת"
 * (600 מטר) ו"או איפשהו ליד העבודה" (5 ק״מ) הם שני דברים שונים,
 * ואותו קונה מחזיק את שניהם.
 *
 * רשימת הערים נשארת ואינה מוחלפת: היא הגיבוי לנכס שאין לו
 * קואורדינטה, והיא מה שעובד למי שלא רוצה לגעת במפה בכלל.
 *
 * ## למה המפה פתוחה מלכתחילה ולא מאחורי כפתור
 *
 * קודם היה כאן כפתור "+ הוספת אזור חיפוש", והמפה נפתחה רק בלחיצה
 * עליו. שדה שצריך לגלות אותו הוא שדה שלא ממלאים: הסוכן הקליד עיר,
 * המשיך, ואזורי החיפוש נשארו ריקים — כלומר הקריטריון המדויק ביותר
 * שיש לקונה פשוט לא נאסף. עכשיו המפה היא שדה קבוע בפרטי הקונה,
 * לצד העיר, והיא נראית ברגע שנפתח הטופס.
 *
 * ## למה שם האזור חובה
 *
 * הוא היה "לא חובה", וכמעט אף אחד לא מילא אותו. התוצאה נראתה רק
 * בצד השני של הרשת: ביקוש שפורסם הציג „אזור מסומן במפה — רדיוס
 * 1 ק״מ” ותו לא, כלומר לא אמר **איפה**. משרד אחר אינו רואה את
 * המפה שלנו ואינו יכול לגזור שכונה מנקודת ציון, ולכן מודעה כזו
 * אינה ניתנת לפעולה (דיווח המשתמש).
 *
 * החובה נאכפת כאן ולא ב-`searchAreaRejectionReason`: אזורים שכבר
 * נשמרו בלי שם הם נתון קיים, וכלל משותף שפוסל אותם היה חוסם עריכת
 * קונה על שדה שהמסך של אתמול לא ביקש. במקום זה השם ניתן לעריכה
 * במקום ברשימה, כך שאפשר להשלים אותו בלי למחוק ולסמן מחדש.
 */

/** אורך שם האזור — כותרת קצרה, לא תיאור. */
const AREA_LABEL_MAX = 60;

export function SearchAreas({
  value,
  onChange,
  disabled = false,
}: {
  value: SearchArea[];
  onChange: (next: SearchArea[]) => void;
  disabled?: boolean;
}) {
  /*
   * `{}` ולא `null` — המפה מוצגת מיד. הערך נשאר "טיוטה" כי סיכה
   * שסומנה ועדיין לא נוספה אינה אזור חיפוש.
   */
  const [draft, setDraft] = useState<LocationValue>({});
  const [radius, setRadius] = useState(String(DEFAULT_SEARCH_RADIUS_KM));
  const [label, setLabel] = useState("");
  /*
   * הסוכן נגע בשם בעצמו — ומאז הכתובת מהמפה כבר אינה דורסת אותו.
   * בלי זה גרירה קטנה של הסיכה הייתה מוחקת שם שהוקלד ידנית.
   */
  const [labelTouched, setLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = value.length >= MAX_SEARCH_AREAS;

  /**
   * עריכת שם של אזור שכבר ברשימה — כולל השלמה של אזור ישן בלי שם.
   *
   * **ריק אינו שם, ולכן אינו נשמר.** הוספת אזור כבר דורשת שם, ובלי
   * אותה דרישה כאן היה אפשר להוסיף אזור עם שם ומיד למחוק אותו —
   * ולחזור בדיוק לביקוש שהמשרדים ברשת רואים כ„עיגול על המפה” בלי
   * לדעת על מה מדובר, שזה מה שהדרישה נועדה למנוע. הערך הקודם נשמר,
   * וההודעה מסבירה למה השדה לא התרוקן.
   */
  function rename(index: number, next: string): void {
    const text = next.slice(0, AREA_LABEL_MAX);
    if (text.trim() === "" && value[index]?.label !== undefined) {
      setError("שם האזור לא יכול להישאר ריק — זה מה שיוצג למשרדים אחרים ברשת");
      return;
    }
    setError(null);
    onChange(
      value.map((area, i) => {
        if (i !== index) return area;
        /*
          מחיקה ולא `label: undefined` — הטיפוסים כאן מדויקים
          (`exactOptionalPropertyTypes`), ושדה שקיים עם ערך `undefined`
          אינו אותו דבר כמו שדה שאינו קיים. שאר השדות נשמרים בהעתקה
          כדי ששדה שיתווסף לאזור בעתיד לא ייעלם בשינוי שם.
        */
        const updated: SearchArea = { ...area };
        if (text.trim() === "") delete updated.label;
        else updated.label = text;
        return updated;
      }),
    );
  }

  function add(): void {
    if (draft.latitude === undefined || draft.longitude === undefined) {
      setError("סמנו נקודה על המפה");
      return;
    }
    const name = label.trim();
    if (name === "") {
      setError("כתבו את שם השכונה או האזור — זה מה שיוצג למשרדים אחרים ברשת");
      return;
    }
    const area: SearchArea = {
      lat: draft.latitude,
      lon: draft.longitude,
      radiusKm: Number(radius),
      label: name,
    };
    const problem = searchAreaRejectionReason(area);
    if (problem) {
      setError(problem);
      return;
    }
    onChange([...value, area]);
    // המפה נשארת פתוחה לאזור הבא, בלי הסיכה שכבר נוספה
    setDraft({});
    setLabel("");
    setLabelTouched(false);
    setError(null);
  }

  return (
    <div>
      {value.length > 0 ? (
        <ul className="m-0 mb-2 list-none p-0">
          {value.map((area, i) => (
            <li
              key={`${area.lat},${area.lon},${i}`}
              className="flex flex-wrap items-center gap-2 border-b py-1.5 text-[14.5px]"
              style={{ borderColor: "var(--color-border)" }}
            >
              {/*
                שדה ולא טקסט: אזור שנשמר בלי שם — וכאלה יש — ניתן
                להשלמה כאן, בלי למחוק אותו ולסמן את הנקודה מחדש.
              */}
              <input
                value={area.label ?? ""}
                maxLength={AREA_LABEL_MAX}
                disabled={disabled}
                aria-label={`שם האזור ${i + 1}`}
                placeholder="שם השכונה או האזור"
                onChange={(e) => rename(i, e.target.value)}
                className="min-w-0 grow rounded-lg border px-2.5 py-1 font-semibold"
                style={{
                  borderColor:
                    area.label === undefined
                      ? "var(--color-danger)"
                      : "var(--color-input-border)",
                  background: "var(--color-surface)",
                }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>
                רדיוס {describeDistance(area.radiusKm)} · {area.lat.toFixed(4)},{" "}
                {area.lon.toFixed(4)}
              </span>
              <button
                type="button"
                className="mv-btn-plain ms-auto"
                style={{ color: "var(--color-danger)" }}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? (
        /* הגבלה אמיתית, ולכן היא נאמרת במקום שבו היה השדה */
        <p
          className="m-0 text-[14px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          הגעתם ל-{MAX_SEARCH_AREAS} אזורי חיפוש — אפשר להסיר אזור כדי להוסיף
          אחר.
        </p>
      ) : (
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <LocationPicker
            value={draft}
            onChange={setDraft}
            /*
              הכתובת שהמפה מחזירה הופכת לשם האזור המוצע. הסוכן עדיין
              רואה אותה ויכול לתקן — אבל ברירת המחדל כבר אינה ריקה,
              וזה ההבדל בין מודעה שאומרת "רמת אהרן" למודעה שאומרת
              "אזור מסומן במפה". כשהספק אינו מפענח הפוך (מפ״י) לא
              נקרא כאן דבר, והשדה נשאר להקלדה.
            */
            onAddressSuggested={(suggested) => {
              if (!labelTouched) setLabel(suggested);
            }}
            disabled={disabled}
          />
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[14px]">
              <span className="mb-0.5 block font-semibold">רדיוס (ק״מ)</span>
              <input
                type="number"
                step="0.1"
                min={MIN_SEARCH_RADIUS_KM}
                max={MAX_SEARCH_RADIUS_KM}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="w-24 rounded-lg border px-2.5 py-1.5"
                style={{
                  borderColor: "var(--color-input-border)",
                  background: "var(--color-surface)",
                }}
              />
            </label>
            <label className="grow text-[14px]">
              <span className="mb-0.5 block font-semibold">
                שם השכונה או האזור *
              </span>
              <input
                value={label}
                maxLength={AREA_LABEL_MAX}
                placeholder="למשל: רמת אהרן, או ליד ההורים"
                onChange={(e) => {
                  setLabelTouched(true);
                  setLabel(e.target.value);
                }}
                className="w-full rounded-lg border px-2.5 py-1.5"
                style={{
                  borderColor: "var(--color-input-border)",
                  background: "var(--color-surface)",
                }}
              />
            </label>
            <Button onClick={add} disabled={disabled}>
              הוסף
            </Button>
            {/* אין מה "לבטל" בשדה קבוע — הכפתור מנקה את הסיכה */}
            <Button
              variant="ghost"
              onClick={() => {
                setDraft({});
                setLabel("");
                setLabelTouched(false);
                setError(null);
              }}
              disabled={disabled}
            >
              נקה סימון
            </Button>
          </div>
          {error !== null ? (
            <Notice tone="danger">{error}</Notice>
          ) : null}
        </div>
      )}
    </div>
  );
}
