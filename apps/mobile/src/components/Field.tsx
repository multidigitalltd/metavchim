import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";

interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  /** ‏השדה תופס את הרוחב הפנוי בשורה (לצד כפתור). */
  grow?: boolean;
}

/** ‏שדה קלט עם תווית — מסגרת בניגודיות 3:1 לפחות, ימין-לשמאל. */
export function Field({ label, error, grow = false, style, ...input }: FieldProps) {
  return (
    <View style={[styles.wrap, grow && styles.grow]}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        {...input}
        accessibilityLabel={label || input.placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  grow: { flex: 1 },
  input: {
    minHeight: TOUCH + 4,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlign: "right",
    writingDirection: "rtl",
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: font.xs },
});
