import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { colors, radius, shadowCard, space } from "@/theme";
import { Text } from "./Text";

/**
 * ‏כרטיס — `.mv-card`: משטח לבן, מסגרת `line`, פינות 22 והצללה
 * ‏אחת במנוחה. התוכן לעולם אינו נוגע במסגרת.
 */
export function Card({ style, children, ...rest }: PropsWithChildren<ViewProps>) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

/** ‏כותרת כרטיס/פאנל — `.mv-card-head`: כותרת, מונה, וקישור בקצה. */
export function SectionTitle({
  children,
  count,
  trailing,
}: {
  children: string;
  count?: number;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionMain}>
        <Text variant="title" accessibilityRole="header">
          {children}
        </Text>
        {count === undefined ? null : (
          <Text variant="muted" weight={700}>
            {count}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: space.sm,
    ...shadowCard,
  },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.sm,
    gap: space.sm,
  },
  sectionMain: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
});
