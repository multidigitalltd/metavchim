import { Pressable, ScrollView } from "react-native";
import { font, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";
import { makeStyles } from "@/lib/theme";

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
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {options.map((option) => {
        const active = value.includes(option.key);
        return (
          <Pressable
            key={option.key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            onPress={() =>
              onChange(
                active
                  ? value.filter((k) => k !== option.key)
                  : [...value, option.key],
              )
            }
            style={[styles.chip, active && styles.active]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    strip: { gap: space.sm, paddingVertical: space.xs },
    chip: {
      minHeight: TOUCH - 8,
      justifyContent: "center",
      paddingHorizontal: space.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.surface,
    },
    active: { backgroundColor: c.primarySoft, borderColor: c.primaryAccent },
    label: { fontSize: font.sm, color: c.text, fontFamily: "Almoni-Medium" },
    activeLabel: { color: c.primary },
  };
});
