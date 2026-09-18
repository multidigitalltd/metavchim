import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { chrome, colors, radius, space, type } from "@/theme";
import { Text } from "./Text";

interface RowProps {
  title: string;
  subtitle?: string;
  /** ‏גלולה או טקסט קצר בקצה השורה. */
  trailing?: ReactNode;
  /** ‏סמל בתחילת השורה (Ionicons) — כמו אריח הסמל בשורות ה-web. */
  leading?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** ‏`.mv-list-row--new` / `--highlight` */
  tone?: "new" | "highlight";
  /** ‏חץ המשך בקצה — שורה שמובילה למסך. */
  chevron?: boolean;
}

/**
 * ‏שורת רשימה — `.mv-row` / `.mv-list-row` של ה-web: משטח לבן, כותרת
 * ‏17.5/700 ושורת משנה 15, גובה 66 לפחות, פינות 15 כשהיא עומדת לבדה.
 */
export function Row({
  title,
  subtitle,
  trailing,
  leading,
  onPress,
  accessibilityLabel,
  tone,
  chevron = false,
  children,
}: PropsWithChildren<RowProps>) {
  return (
    <Pressable
      onPress={onPress}
      disabled={onPress === undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ""}`}
      style={({ pressed }) => [
        styles.row,
        tone === "new" && styles.new,
        tone === "highlight" && styles.highlight,
        pressed && styles.pressed,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.main}>
        <Text style={styles.title} weight={700} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <Ionicons name="chevron-back" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rowBorder,
    borderRadius: radius.row,
    paddingHorizontal: space.lg,
    paddingVertical: 13,
  },
  new: { backgroundColor: chrome.rowNewBg },
  highlight: { backgroundColor: chrome.rowHighlightBg },
  pressed: { backgroundColor: colors.surfaceSunken },
  leading: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: 2 },
  title: { fontSize: type.rowTitle, letterSpacing: -0.26 },
  trailing: { alignItems: "flex-end", gap: space.xs },
});
