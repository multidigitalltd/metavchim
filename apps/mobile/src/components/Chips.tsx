import { Pressable, ScrollView, StyleSheet } from "react-native";
import { colors, radius, type } from "@/theme";
import { Text } from "./Text";

export interface ChipOption<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/**
 * ‏שורת מסננים — `.mv-chip` של ה-web: מסגרת פקד, 14/700, פינות 99;
 * ‏הנבחרת בירוק המותג עם טקסט לבן (`aria-pressed`). נגללת לרוחב.
 */
export function Chips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly ChipOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.key)}
            style={[styles.chip, active && styles.active]}
          >
            <Text style={[styles.label, active && styles.activeLabel]} weight={700}>
              {option.count === undefined ? option.label : `${option.label} · ${option.count}`}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingVertical: 4 },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  active: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { fontSize: type.caption, color: colors.textSoft, lineHeight: 18 },
  activeLabel: { color: colors.surface },
});
