import type { PropsWithChildren, ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/theme";
import { Text } from "./Text";

interface ScreenProps {
  title?: string;
  /** ‏כפתור או תג בצד שמאל של הכותרת (בצד ה„סוף” בפריסת RTL). */
  trailing?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** ‏מסך שמנהל גלילה בעצמו (FlatList) — בלי ScrollView מסביב. */
  scroll?: boolean;
}

/**
 * ‏המעטפת של כל מסך: אזור בטוח, רקע, כותרת, ומשיכה-לרענון.
 */
export function Screen({
  title,
  trailing,
  refreshing = false,
  onRefresh,
  scroll = true,
  children,
}: PropsWithChildren<ScreenProps>) {
  const header =
    title === undefined ? null : (
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {trailing}
      </View>
    );
  if (!scroll) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        {header}
        <View style={styles.fill}>{children}</View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
      >
        {header}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
  },
});
