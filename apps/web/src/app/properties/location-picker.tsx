"use client";

import { useEffect, useRef, useState } from "react";
import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { apiGet } from "@/lib/api";
import { MapCanvas } from "../map-canvas";

/**
 * מיקום הנכס — טקסט ומפה, בשני הכיוונים.
 *
 * **כתובת ← מפה:** מקלידים כתובת, בוחרים מההצעות, והסיכה קופצת לשם.
 * **מפה ← כתובת:** גוררים את הסיכה, והכתובת מתמלאת מהמיקום.
 *
 * שני הכיוונים חשובים כי כך עובדים בפועל: לפעמים יש כתובת מדויקת
 * מהמוכר, ולפעמים הסוכן יודע איפה זה אבל לא איך זה נקרא — "הבניין
 * מול בית הכנסת". גם ידני בלבד עובד: אפשר לגרור בלי לפענח כלום,
 * והנקודה נשמרת כמו שהיא.
 *
 * הכיוון ההפוך תלוי בספק: לא כולם מפענחים נקודה לכתובת. הרכיב שואל
 * את השרת מה נתמך ומסתיר את מה שאינו — כפתור שנכשל בלחיצה גרוע
 * מכפתור שאינו קיים.
 */

interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
}

export interface LocationValue {
  latitude?: number;
  longitude?: number;
  locationSource?: "pin" | "geocode";
}

export function LocationPicker({
  value,
  addressText,
  onChange,
  onAddressSuggested,
  disabled = false,
}: {
  value: LocationValue;
  /** הכתובת שכבר בטופס — נקודת הפתיחה לחיפוש. */
  addressText?: string;
  onChange: (next: LocationValue) => void;
  /** הכתובת שהתקבלה מהמפה — הטופס מחליט מה לעשות איתה. */
  onAddressSuggested?: (label: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(addressText ?? "");
  /*
   * הכתובת שבטופס ממשיכה לזלוג לשדה החיפוש גם אחרי ההרכבה.
   *
   * קודם הערך נקרא פעם אחת בלבד. כל עוד המפה נפתחה בלחיצה זה עבד
   * במקרה — היא הורכבה אחרי שהכתובת כבר הוקלדה — אבל מרגע שהיא שדה
   * קבוע היא מורכבת ריקה, וכל מה שהוקלד אחריה לא הגיע לשדה החיפוש.
   * המתווך היה צריך להקליד את הכתובת פעם שנייה (ביקורת Codex).
   *
   * הסנכרון נעצר ברגע שהמשתמש נגע בשדה: `touched` מבדיל בין "השדה
   * עוקב אחרי הטופס" לבין "המשתמש כתב כאן משהו משלו", ודריסה של
   * הקלדה ידנית הייתה גרועה מהבאג המקורי.
   */
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setQuery(addressText ?? "");
  }, [addressText, touched]);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [caps, setCaps] = useState<{ forward: boolean; reverse: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    apiGet<{ forward: boolean; reverse: boolean }>("/maps/capabilities")
      .then(setCaps)
      .catch(() => setCaps({ forward: false, reverse: false }));
  }, []);

  /** הסיכה — נוצרת בפעם הראשונה, אחר כך רק זזה. */
  function placeMarker(lat: number, lon: number, source: "pin" | "geocode"): void {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current === null) {
      const marker = new Marker({ draggable: !disabled, color: "#c0392b" })
        .setLngLat([lon, lat])
        .addTo(map);
      marker.on("dragend", () => {
        const { lat: dLat, lng: dLon } = marker.getLngLat();
        onChange({ latitude: dLat, longitude: dLon, locationSource: "pin" });
        void fillAddressFromPoint(dLat, dLon);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([lon, lat]);
    }
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16) });
    onChange({ latitude: lat, longitude: lon, locationSource: source });
  }

  /** מפה ← כתובת. שקט כשהספק אינו תומך — הנקודה נשמרת בלי הטקסט. */
  async function fillAddressFromPoint(lat: number, lon: number): Promise<void> {
    if (caps?.reverse !== true) return;
    try {
      const { label } = await apiGet<{ label?: string }>(
        `/maps/reverse?lat=${lat}&lon=${lon}`,
      );
      if (label !== undefined) {
        setQuery(label);
        onAddressSuggested?.(label);
      }
    } catch {
      // כשל בפענוח אינו מבטל את הסימון — הנקודה כבר נשמרה
    }
  }

  /** כתובת ← מפה. */
  async function search(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      const { results: found } = await apiGet<{ results: GeocodeResult[] }>(
        `/maps/geocode?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(found);
      if (found.length === 0) setNote("לא נמצאה כתובת — אפשר לסמן ידנית על המפה.");
      else if (found.length === 1) {
        placeMarker(found[0]!.lat, found[0]!.lon, "geocode");
        setResults(null);
      }
    } catch {
      setNote("החיפוש נכשל — אפשר לסמן ידנית על המפה.");
    } finally {
      setBusy(false);
    }
  }

  const hasPoint = value.latitude !== undefined && value.longitude !== undefined;

  return (
    <div>
      {caps?.forward === true ? (
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <label className="grow">
            <span className="mb-1 block text-sm font-semibold">כתובת לחיפוש</span>
            <input
              value={query}
              onChange={(e) => {
                setTouched(true);
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                // Enter מחפש ואינו שולח את הטופס כולו
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="רחוב, מספר, עיר"
              className="mv-field"
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            className="mv-btn-plain"
            onClick={() => void search()}
            disabled={disabled || busy || query.trim().length < 2}
          >
            מצא על המפה
          </button>
        </div>
      ) : null}

      {results !== null && results.length > 1 ? (
        <ul className="m-0 mb-2 list-none p-0">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button
                type="button"
                className="mv-btn-plain w-full text-start"
                onClick={() => {
                  placeMarker(r.lat, r.lon, "geocode");
                  setQuery(r.label);
                  onAddressSuggested?.(r.label);
                  setResults(null);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <MapCanvas
        height="300px"
        center={hasPoint ? [value.longitude!, value.latitude!] : undefined}
        zoom={hasPoint ? 16 : 12}
        onReady={(map) => {
          mapRef.current = map;
          if (hasPoint) placeMarker(value.latitude!, value.longitude!, value.locationSource ?? "pin");
          if (disabled) return;
          // לחיצה על המפה מציבה סיכה — הדרך המהירה כשאין כתובת מדויקת
          map.on("click", (event) => {
            placeMarker(event.lngLat.lat, event.lngLat.lng, "pin");
            void fillAddressFromPoint(event.lngLat.lat, event.lngLat.lng);
          });
        }}
      />

      <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {hasPoint
          ? `מיקום נשמר: ${value.latitude!.toFixed(5)}, ${value.longitude!.toFixed(5)}${
              value.locationSource === "geocode" ? " (מהכתובת)" : " (סומן ידנית)"
            }`
          : "לחיצה על המפה מציבה סיכה; אפשר גם לגרור אותה."}
        {caps?.reverse === false && caps.forward
          ? " · הספק הנוכחי אינו ממלא כתובת מסיכה."
          : ""}
      </p>
      {note !== null ? (
        <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-danger)" }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
