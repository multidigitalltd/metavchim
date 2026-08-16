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
import { LocationPicker, type LocationValue } from "../properties/location-picker";

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
 */

export function SearchAreas({
  value,
  onChange,
  disabled = false,
}: {
  value: SearchArea[];
  onChange: (next: SearchArea[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<LocationValue | null>(null);
  const [radius, setRadius] = useState(String(DEFAULT_SEARCH_RADIUS_KM));
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const full = value.length >= MAX_SEARCH_AREAS;

  function add(): void {
    if (draft?.latitude === undefined || draft.longitude === undefined) {
      setError("סמנו נקודה על המפה");
      return;
    }
    const area: SearchArea = {
      lat: draft.latitude,
      lon: draft.longitude,
      radiusKm: Number(radius),
      ...(label.trim() === "" ? {} : { label: label.trim() }),
    };
    const problem = searchAreaRejectionReason(area);
    if (problem) {
      setError(problem);
      return;
    }
    onChange([...value, area]);
    setDraft(null);
    setLabel("");
    setError(null);
  }

  return (
    <div>
      <p className="m-0 mb-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        סימון על המפה גובר על רשימת הערים: נכס בתוך הרדיוס יתאים גם אם הוא בעיר
        שכנה, ונכס מחוץ לו יקבל ניקוד נמוך יותר במקום להיעלם. בלי סימון —
        ההתאמה עובדת לפי הערים, כרגיל.
      </p>

      {value.length > 0 ? (
        <ul className="m-0 mb-2 list-none p-0">
          {value.map((area, i) => (
            <li
              key={`${area.lat},${area.lon},${i}`}
              className="flex flex-wrap items-center gap-2 border-b py-1.5 text-[13px]"
              style={{ borderColor: "var(--color-border)" }}
            >
              <b>{area.label ?? `אזור ${i + 1}`}</b>
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

      {draft === null ? (
        <Button
          variant="ghost"
          disabled={disabled || full}
          onClick={() => {
            setDraft({});
            setError(null);
          }}
        >
          {full ? `הגעתם ל-${MAX_SEARCH_AREAS} אזורים` : "+ הוספת אזור חיפוש"}
        </Button>
      ) : (
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <LocationPicker value={draft} onChange={setDraft} disabled={disabled} />
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[12px]">
              <span className="mb-0.5 block font-semibold">רדיוס (ק״מ)</span>
              <input
                type="number"
                step="0.1"
                min={MIN_SEARCH_RADIUS_KM}
                max={MAX_SEARCH_RADIUS_KM}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="w-24 rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              />
            </label>
            <label className="grow text-[12px]">
              <span className="mb-0.5 block font-semibold">שם האזור (לא חובה)</span>
              <input
                value={label}
                maxLength={60}
                placeholder="למשל: ליד ההורים"
                onChange={(e) => setLabel(e.target.value)}
                className="w-full rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              />
            </label>
            <Button onClick={add} disabled={disabled}>
              הוסף
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={disabled}>
              ביטול
            </Button>
          </div>
          {error !== null ? (
            <p role="alert" className="m-0 mt-2 text-[12.5px]" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
