import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";

interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
}

/** ‏שדה קלט עם תווית — מסגרת בניגודיות 3:1 לפחות, ימין-לשמאל. */
export function Field({ label, error, style, ...input }: FieldProps) {
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
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
