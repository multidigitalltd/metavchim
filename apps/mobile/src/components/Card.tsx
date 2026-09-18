import type { PropsWithChildren } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { colors, radius, space } from "@/theme";
import { Text } from "./Text";

/** ‏כרטיס — משטח לבן, מסגרת, ריפוד. התוכן לעולם אינו נוגע במסגרת. */
export function Card({ style, children, ...rest }: PropsWithChildren<ViewProps>) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <View style={styles.section}>
      <Text variant="title" accessibilityRole="header">
        {children}
      </Text>
      {count === undefined ? null : <Text variant="muted">{count}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  section: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: space.sm,
  },
});
