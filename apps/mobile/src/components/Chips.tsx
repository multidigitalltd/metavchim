import { Pressable, ScrollView, StyleSheet } from "react-native";
import { colors, font, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";

export interface ChipOption<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/** ‏שורת מסננים — לשונית אחת פעילה, נגללת לרוחב. */
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
            <Text style={[styles.label, active && styles.activeLabel]}>
              {option.count === undefined ? option.label : `${option.label} · ${option.count}`}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: TOUCH - 8,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  active: { backgroundColor: colors.tabActive, borderColor: colors.tabActive },
  label: { fontSize: font.sm, color: colors.text, fontWeight: "600" },
  activeLabel: { color: "#ffffff" },
});
