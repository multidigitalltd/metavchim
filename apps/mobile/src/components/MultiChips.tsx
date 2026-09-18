import { Pressable, ScrollView, StyleSheet } from "react-native";
import { colors, font, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";

/** ‏בחירה מרובה — כל לשונית נדלקת ונכבית בנפרד. */
export function MultiChips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: readonly K[];
  onChange: (keys: K[]) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {options.map((option) => {
        const active = value.includes(option.key);
        return (
          <Pressable
            key={option.key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            onPress={() =>
              onChange(active ? value.filter((k) => k !== option.key) : [...value, option.key])
            }
            style={[styles.chip, active && styles.active]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{option.label}</Text>
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
  active: { backgroundColor: colors.primarySoft, borderColor: colors.primaryAccent },
  label: { fontSize: font.sm, color: colors.text, fontFamily: "Almoni-Medium" },
  activeLabel: { color: colors.primary },
});
