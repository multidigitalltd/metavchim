import { StyleSheet, View } from "react-native";
import { hebrewElapsed } from "@metavchim/shared";
import type { QueryState } from "@/lib/use-query";
import { colors, radius, space } from "@/theme";
import { Text } from "./Text";

/**
 * ‏„מוצג מהמטמון” — כשעל המסך נתונים ישנים ובקשת הרענון נכשלה.
 * ‏בזמן שהרענון עוד רץ אין הודעה: הנתונים הישנים הם רק הרגע שלפני.
 */
export function CacheNotice({ query }: { query: Pick<QueryState<unknown>, "stale" | "error" | "cachedAt"> }) {
  if (!query.stale || query.error === null) return null;
  const age = query.cachedAt === null ? null : hebrewElapsed(new Date(query.cachedAt), new Date());
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.text}>
        אין חיבור — מוצג מה שנטען {age ? `לפני ${age}` : "בפעם הקודמת"}. משכו למטה לרענון.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
  },
  text: { color: colors.warning, fontSize: 14 },
});
