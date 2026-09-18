import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { family } from "@/lib/fonts";
import { colors, CONTROL_H, radius, space, type } from "@/theme";
import { Text } from "./Text";

interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  /** ‏השדה תופס את הרוחב הפנוי בשורה (לצד כפתור). */
  grow?: boolean;
}

/**
 * ‏שדה קלט עם תווית — `.mv-input` של ה-web: מסגרת פקד ב-3:1 לפחות,
 * ‏פינות 10, גובה `--control-h`, ימין-לשמאל.
 */
export function Field({ label, error, grow = false, style, ...input }: FieldProps) {
  return (
    <View style={[styles.wrap, grow && styles.grow]}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        {...input}
        accessibilityLabel={label || input.placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, input.multiline ? styles.multiline : null, error ? styles.inputError : null, style]}
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
  wrap: { gap: 5 },
  grow: { flex: 1 },
  input: {
    minHeight: CONTROL_H,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    fontSize: type.bodySm,
    fontFamily: family(400),
    color: colors.text,
    backgroundColor: colors.surface,
    textAlign: "right",
    writingDirection: "rtl",
  },
  multiline: { minHeight: CONTROL_H * 2, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: type.caption },
});
