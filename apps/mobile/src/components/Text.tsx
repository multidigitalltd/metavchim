import { Text as RNText, StyleSheet, type TextProps } from "react-native";
import { family, type Weight } from "@/lib/fonts";
import { colors, type } from "@/theme";

/**
 * ‏טקסט של האפליקציה — Almoni, עברית, ימין-לשמאל, מהרצפה הטיפוגרפית
 * ‏ומעלה. הדרגות הן `--type-*` של ה-web (חבילת העיצוב §1).
 *
 * ‏`writingDirection: "rtl"` נכתב במפורש ולא נשען על `I18nManager` לבדו:
 * ‏שורה מעורבת (שם ברחוב ומספר טלפון) חייבת להתחיל מימין גם במכשיר
 * ‏שה-RTL שלו טרם נכנס לתוקף (הוא דורש הפעלה מחדש).
 */
type Variant = "body" | "muted" | "small" | "label" | "title" | "heading" | "h1" | "eyebrow";

const VARIANT: Record<Variant, { size: number; color: string; weight: Weight; spacing?: number }> = {
  body: { size: type.body, color: colors.text, weight: 400 },
  muted: { size: type.bodySm, color: colors.textMuted, weight: 400 },
  small: { size: type.caption, color: colors.textMuted, weight: 400 },
  label: { size: type.caption, color: colors.text, weight: 700 },
  /* ‏כותרת כרטיס — 18.5/700/-0.02em */
  title: { size: type.cardTitle, color: colors.text, weight: 700, spacing: -0.3 },
  /* ‏כותרת פאנל — 22/800/-0.025em */
  heading: { size: type.panel, color: colors.text, weight: 800, spacing: -0.5 },
  /* ‏ברכת העמוד — 38/900/-0.035em */
  h1: { size: type.h1, color: colors.text, weight: 900, spacing: -1.2 },
  /* ‏עינית — 14/700, מרווח 0.09em */
  eyebrow: { size: type.caption, color: colors.textMuted, weight: 700, spacing: 1.2 },
};

export function Text({
  variant = "body",
  weight,
  style,
  ...rest
}: TextProps & { variant?: Variant; weight?: Weight }) {
  const v = VARIANT[variant];
  const w = weight ?? v.weight;
  return (
    <RNText
      {...rest}
      style={[
        styles.base,
        {
          fontSize: v.size,
          color: v.color,
          fontFamily: family(w),
          lineHeight: Math.round(v.size * (variant === "h1" ? 1.15 : 1.45)),
          ...(v.spacing === undefined ? {} : { letterSpacing: v.spacing }),
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { writingDirection: "rtl", textAlign: "right" },
});
