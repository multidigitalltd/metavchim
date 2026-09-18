import { useMemo } from "react";
import { View } from "react-native";
import {
  JERUSALEM_TZ,
  hebrewDateShort,
  jerusalemDayStart,
  jerusalemWallParts,
} from "@metavchim/shared";
import { space } from "@/theme";
import { Chips } from "./Chips";
import { Field } from "./Field";
import { Text } from "./Text";

const DAYS_AHEAD = 21;

const DAY_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ,
  weekday: "short",
  day: "numeric",
  month: "numeric",
});

/** ‏שעות עגולות של יום עבודה — לחיצה אחת; כל שעה אחרת בשדה. */
const TIMES = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
] as const;

export const DURATIONS: readonly { key: string; label: string }[] = [
  { key: "30", label: "30 דק׳" },
  { key: "45", label: "45 דק׳" },
  { key: "60", label: "שעה" },
  { key: "90", label: "שעה וחצי" },
  { key: "120", label: "שעתיים" },
];

/**
 * ‏מועד בשעון ישראל בלי בורר תאריכים: שורת ימים (היום, מחר, ושלושה
 * ‏שבועות קדימה עם התאריך העברי) ושורת שעות עגולות, ושדה לשעה אחרת.
 * ‏הערכים הם שעת קיר ישראלית (`YYYY-MM-DD`, `HH:MM`) — מה ש-
 * ‏`resolveJerusalemWall` ממיר בשמירה, כמו בטפסי היומן ב-web.
 */
export function WhenPicker({
  date,
  time,
  onDate,
  onTime,
  now,
}: {
  date: string;
  time: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
  now: Date;
}) {
  const days = useMemo(() => {
    const options: { key: string; label: string }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i += 1) {
      const at = jerusalemDayStart(now, i);
      const key = jerusalemWallParts(at).date;
      const hebrew = hebrewDateShort(at);
      const name = i === 0 ? "היום" : i === 1 ? "מחר" : DAY_FMT.format(at);
      options.push({ key, label: hebrew ? `${name} · ${hebrew}` : name });
    }
    // ‏תאריך שהוקלד מעבר לשלושת השבועות נשאר נבחר, ולא נעלם
    if (date !== "" && !options.some((o) => o.key === date))
      options.push({ key: date, label: date });
    return options;
  }, [now, date]);

  const timeOptions = useMemo(
    () => TIMES.map((t) => ({ key: t, label: t })),
    [],
  );

  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">יום</Text>
      <Chips
        options={days}
        value={date === "" ? null : date}
        onChange={onDate}
      />
      <Text variant="label">שעה</Text>
      <Chips
        options={timeOptions}
        value={(TIMES as readonly string[]).includes(time) ? time : null}
        onChange={onTime}
      />
      <Field
        label="שעה אחרת"
        value={time}
        onChangeText={(text) =>
          onTime(text.replace(/[^\d:]/gu, "").slice(0, 5))
        }
        placeholder="10:30"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
    </View>
  );
}
