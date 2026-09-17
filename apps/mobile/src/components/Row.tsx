import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, radius, space, TOUCH } from "@/theme";
import { Text } from "./Text";

interface RowProps {
  title: string;
  subtitle?: string;
  /** ‏גלולה או טקסט קצר בקצה השורה. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** ‏שורת רשימה — כרטיס נמוך, לחיץ, שורת כותרת ושורת משנה. */
export function Row({
  title,
  subtitle,
  trailing,
  onPress,
  accessibilityLabel,
  children,
}: PropsWithChildren<RowProps>) {
  return (
    <Pressable
      onPress={onPress}
      disabled={onPress === undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ""}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.main}>
        <Text variant="body" style={styles.title} numberOfLines={1}>
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH + 12,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rowBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pressed: { backgroundColor: colors.surfaceSunken },
  main: { flex: 1, gap: 2 },
  title: { fontWeight: "600" },
  trailing: { alignItems: "flex-end", gap: space.xs },
});
