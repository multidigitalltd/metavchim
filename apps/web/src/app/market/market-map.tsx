"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Popup, type Map as MapLibreMap } from "maplibre-gl";
import { quantile, type MarketMapDto, type MarketNatureGroup } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { LoadError } from "../load-error";
import { MapCanvas } from "../map-canvas";
import { ppsqm } from "./market-parts";

/**
 * ‎**מפת עסקאות — חלקה לנקודה, צבע לפי מחיר למ"ר** (docs/14, יכולת 8).
 *
 * צבע **רציף בגוון אחד**, מבהיר לכהה — זה גודל, לא קטגוריה, וקשת
 * צבעים הייתה מציירת גבולות שאינם קיימים. הסולם נמתח בין הרבעון
 * התחתון לעליון של היישוב עצמו, ולכן תל אביב ודימונה מקבלות כל אחת
 * מפה שאפשר לקרוא — ולא תל אביב כהה ודימונה בהירה כולה.
 *
 * גודל הנקודה לפי מספר העסקאות בחלקה: בניין עם עשרים מכירות אינו
 * „עוד נקודה”. המפה מתמלאת בהדרגה — חלקות מועשרות במיקום בסבב
 * הסנכרון — והמסך אומר כמה כבר מוקם.
 *
 * הצבעים כאן ערכי hex ולא טוקנים, כי MapLibre מצייר ב-WebGL ואינו
 * קורא משתני CSS. הם אותו גוון כחול בחמש דרגות, ואותם ערכים במקרא.
 */

const RAMP = ["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"] as const;

export function MarketMap({ settlementId, group }: { settlementId: number; group: MarketNatureGroup }) {
  const [data, setData] = useState<MarketMapDto | null>(null);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<MapLibreMap | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    setData(null);
    apiGet<MarketMapDto>(`/market/map?settlementId=${settlementId}&group=${group}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [settlementId, group]);

  useEffect(load, [load]);

  const values = (data?.points ?? []).flatMap((p) => (p.medianPpsqm === null ? [] : [p.medianPpsqm])).sort((a, b) => a - b);
  const lo = values.length > 0 ? quantile(values, 0.1) : 0;
  const hi = values.length > 0 ? quantile(values, 0.9) : 1;

  const draw = useCallback(
    (map: MapLibreMap) => {
      if (!data || data.points.length === 0) return;
      const features = data.points.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { ppsqm: p.medianPpsqm ?? 0, deals: p.deals, label: `גוש ${p.gush} חלקה ${p.helka}`, last: p.lastDeal },
      }));
      const source = { type: "geojson" as const, data: { type: "FeatureCollection" as const, features } };
      if (map.getLayer("market-deals")) map.removeLayer("market-deals");
      if (map.getSource("market-deals")) map.removeSource("market-deals");
      map.addSource("market-deals", source);
      const step = (hi - lo) / (RAMP.length - 1 || 1);
      map.addLayer({
        id: "market-deals",
        type: "circle",
        source: "market-deals",
        paint: {
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "ppsqm"],
            ...RAMP.flatMap((color, i) => [lo + step * i, color]),
          ] as unknown as string,
          "circle-radius": ["interpolate", ["linear"], ["get", "deals"], 1, 5, 20, 12] as unknown as number,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      // מתמקדים בנקודות — מרכז היישוב שהן בו, לא מרכז הארץ
      const lons = data.points.map((p) => p.lon);
      const lats = data.points.map((p) => p.lat);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 40, maxZoom: 15, duration: 0 },
      );
      const popup = new Popup({ closeButton: false, closeOnClick: false });
      map.on("mouseenter", "market-deals", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        map.getCanvas().style.cursor = "pointer";
        const props = feature.properties as { ppsqm: number; deals: number; label: string; last: string };
        const node = document.createElement("div");
        node.dir = "rtl";
        node.textContent = `${props.label} · ${props.deals} עסקאות · חציון ${ppsqm(props.ppsqm)} למ"ר`;
        popup.setLngLat(event.lngLat).setDOMContent(node).addTo(map);
      });
      map.on("mouseleave", "market-deals", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    },
    [data, lo, hi],
  );

  useEffect(() => {
    if (mapRef.current) draw(mapRef.current);
  }, [draw]);

  if (failed) return <LoadError message="לא הצלחנו לטעון את מפת העסקאות" onRetry={load} />;
  if (!data) return <p aria-live="polite">טוען מפה…</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
        {data.points.length === 0
          ? "עוד אין חלקות ממוקמות ביישוב הזה — המיקום מתמלא בהדרגה בסבב הסנכרון."
          : `${data.points.length} חלקות עם עסקאות ב-24 החודשים האחרונים`}
        {data.locatedPct !== null ? ` · ${data.locatedPct}% מהחלקות ביישוב כבר מוקמו` : ""}
      </p>
      <MapCanvas
        height="460px"
        onReady={(map) => {
          mapRef.current = map;
          if (map.isStyleLoaded()) draw(map);
          else map.once("load", () => draw(map));
        }}
      />
      {values.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="מקרא: מחיר חציוני למ״ר" role="group">
          <span style={{ fontSize: "var(--type-caption-lg)" }}>מחיר למ&quot;ר:</span>
          <span style={{ fontSize: "var(--type-caption-lg)" }}>{ppsqm(Math.round(lo))}</span>
          <span
            aria-hidden="true"
            style={{ width: 160, height: 10, borderRadius: 4, background: `linear-gradient(to left, ${RAMP.join(", ")})` }}
          />
          <span style={{ fontSize: "var(--type-caption-lg)" }}>{ppsqm(Math.round(hi))}</span>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--type-caption)" }}>· גודל הנקודה = מספר העסקאות</span>
        </div>
      ) : null}
    </div>
  );
}
