import { Text as RNText, StyleSheet, type TextProps } from "react-native";
import { colors, font } from "@/theme";

/**
 * ‏טקסט של האפליקציה — עברית, ימין-לשמאל, מהרצפה הטיפוגרפית ומעלה.
 *
 * ‏`writingDirection: "rtl"` נכתב במפורש ולא נשען על `I18nManager` לבדו:
 * ‏שורה מעורבת (שם ברחוב ומספר טלפון) חייבת להתחיל מימין גם במכשיר
 * ‏שה-RTL שלו טרם נכנס לתוקף (הוא דורש הפעלה מחדש).
 */
type Variant = "body" | "muted" | "title" | "heading" | "label" | "small";

const VARIANT = StyleSheet.create({
  body: { fontSize: font.md, color: colors.text },
  muted: { fontSize: font.sm, color: colors.textMuted },
  small: { fontSize: font.xs, color: colors.textMuted },
  label: { fontSize: font.sm, color: colors.textMuted, fontWeight: "600" },
  title: { fontSize: font.lg, color: colors.text, fontWeight: "700" },
  heading: { fontSize: font.xl, color: colors.text, fontWeight: "700" },
});

export function Text({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  return <RNText {...rest} style={[styles.base, VARIANT[variant], style]} />;
}

const styles = StyleSheet.create({
  base: { writingDirection: "rtl", textAlign: "right" },
});
