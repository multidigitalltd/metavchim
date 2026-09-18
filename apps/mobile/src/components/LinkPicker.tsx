import { useEffect, useState } from "react";
import { View } from "react-native";
import { space } from "@/theme";
import { Button } from "./Button";
import { Field } from "./Field";
import { Row } from "./Row";
import { Text } from "./Text";

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
}

const MIN_QUERY = 2;
const MAX_ROWS = 8;
const DEBOUNCE_MS = 300;

/**
 * ‏בחירת קישור (לקוח או נכס) בתוך טופס — כמו `PickerShell` ב-web:
 * ‏מה שנבחר מוצג כשורה עם „החלפה”; אחרת שדה חיפוש, ומתחתיו
 * ‏האחרונים (בלי טקסט) או תוצאות החיפוש (משתי אותיות). כישלון
 * ‏טעינה נאמר, לא נבלע לרשימה ריקה.
 */
export function LinkPicker({
  label,
  placeholder,
  chosen,
  onPick,
  onClear,
  search,
  recent,
}: {
  label: string;
  placeholder: string;
  chosen: PickOption | null;
  onPick: (option: PickOption) => void;
  onClear: () => void;
  search: (query: string) => Promise<PickOption[]>;
  recent: () => Promise<PickOption[]>;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PickOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (chosen !== null) return;
    let cancelled = false;
    const trimmed = query.trim();
    const timer = setTimeout(
      () => {
        setError(null);
        (trimmed.length >= MIN_QUERY ? search(trimmed) : recent())
          .then((rows) => {
            if (!cancelled) setOptions(rows.slice(0, MAX_ROWS));
          })
          .catch(() => {
            if (!cancelled)
              setError("הרשימה לא נטענה — אפשר להקליד ולנסות שוב");
          });
      },
      trimmed.length >= MIN_QUERY ? DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, chosen, search, recent]);

  if (chosen !== null) {
    return (
      <View style={{ gap: space.xs }}>
        <Text variant="label">{label}</Text>
        <Row
          title={chosen.label}
          subtitle={chosen.sub}
          trailing={
            <Button title="החלפה" kind="text" small onPress={onClear} />
          }
        />
      </View>
    );
  }

  return (
    <View style={{ gap: space.xs }}>
      <Field
        label={label}
        placeholder={placeholder}
        value={query}
        onChangeText={setQuery}
        clearButtonMode="while-editing"
        error={error}
      />
      {options === null && error === null ? (
        <Text variant="small">טוען…</Text>
      ) : null}
      {options !== null && options.length === 0 ? (
        <Text variant="small">
          {query.trim().length >= MIN_QUERY ? "לא נמצא" : "אין עדיין רשומות"}
        </Text>
      ) : null}
      {(options ?? []).map((option) => (
        <Row
          key={option.id}
          title={option.label}
          subtitle={option.sub}
          onPress={() => {
            setQuery("");
            onPick(option);
          }}
        />
      ))}
    </View>
  );
}
