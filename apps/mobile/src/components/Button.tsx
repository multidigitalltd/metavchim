import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { family } from "@/lib/fonts";
import { CONTROL_H, radius, space, type, type Palette } from "@/theme";
import { useColors } from "@/lib/theme";
import { Text } from "./Text";

/**
 * ‏הכפתורים של המערכת, בשמות של `globals.css`:
 * ‏`primary` = `.mv-btn-primary` (ירוק הפעולה, טקסט כהה) ·
 * ‏`secondary` = `.mv-btn-soft` (ירוק רך, מסגרת ירוקה) ·
 * ‏`ghost` = `.mv-btn-ghost` (משטח לבן, מסגרת פקד) ·
 * ‏`danger` = מסגרת וטקסט בצבע הסכנה · `text` = טקסט בלבד.
 */
type Kind = "primary" | "secondary" | "ghost" | "danger" | "text";

interface ButtonProps {
  title: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  /** ‏סמל לפני התווית (Ionicons וכד'). */
  icon?: ReactNode;
  /** ‏כפתור קטן לשורת כלים — כמו `.mv-btn-ghost` (32px). */
  small?: boolean;
}

function kinds(
  c: Palette,
): Record<Kind, { bg: string; fg: string; border: string }> {
  return {
    primary: { bg: c.action, fg: c.onAction, border: c.action },
    secondary: { bg: c.primarySoft, fg: c.primary, border: c.primary },
    ghost: { bg: c.surface, fg: c.textSoft, border: c.inputBorder },
    danger: { bg: c.surface, fg: c.danger, border: c.danger },
    text: { bg: "transparent", fg: c.primary, border: "transparent" },
  };
}

/** ‏כפתור — 42pt (`--control-h`), מצב טעינה, וניגודיות מהערכה. */
export function Button({
  title,
  onPress,
  kind = "primary",
  disabled = false,
  busy = false,
  style,
  accessibilityHint,
  icon,
  small = false,
}: ButtonProps) {
  const palette = kinds(useColors())[kind];
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
        small && styles.small,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.inner}>
          {icon}
          <Text
            style={[
              styles.label,
              small && styles.smallLabel,
              { color: palette.fg, fontFamily: family(700) },
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: CONTROL_H,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  small: { minHeight: 34, paddingHorizontal: 11, borderRadius: radius.sm },
  inner: { flexDirection: "row", alignItems: "center", gap: 7 },
  label: { fontSize: type.body, textAlign: "center" },
  smallLabel: { fontSize: type.caption },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.55 },
});

export const buttonSpacing = space;
