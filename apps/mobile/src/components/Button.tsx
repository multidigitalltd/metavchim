import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colors, font, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";

type Kind = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps {
  title: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const KIND: Record<Kind, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.action, fg: colors.onAction, border: colors.action },
  secondary: { bg: colors.surface, fg: colors.primary, border: colors.primaryAccent },
  danger: { bg: colors.surface, fg: colors.danger, border: colors.danger },
  ghost: { bg: "transparent", fg: colors.textMuted, border: "transparent" },
};

/** ‏כפתור — 44pt לפחות, מצב טעינה, וניגודיות מהערכה. */
export function Button({
  title,
  onPress,
  kind = "primary",
  disabled = false,
  busy = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const palette = KIND[kind];
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[styles.label, { color: palette.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: font.md, fontWeight: "700", textAlign: "center" },
  pressed: { opacity: 0.8 },
  inactive: { opacity: 0.55 },
});
