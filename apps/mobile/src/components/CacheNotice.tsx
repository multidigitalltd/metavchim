import { View } from "react-native";
import { hebrewElapsed } from "@metavchim/shared";
import type { QueryState } from "@/lib/use-query";
import { radius, space } from "@/theme";
import { Text } from "./Text";
import { makeStyles } from "@/lib/theme";

/**
 * ‏„מוצג מהמטמון” — כשעל המסך נתונים ישנים ובקשת הרענון נכשלה.
 * ‏בזמן שהרענון עוד רץ אין הודעה: הנתונים הישנים הם רק הרגע שלפני.
 */
export function CacheNotice({
  query,
}: {
  query: Pick<QueryState<unknown>, "stale" | "error" | "cachedAt">;
}) {
  const styles = useStyles();
  if (!query.stale || query.error === null) return null;
  const age =
    query.cachedAt === null
      ? null
      : hebrewElapsed(new Date(query.cachedAt), new Date());
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.text}>
        אין חיבור — מוצג מה שנטען {age ? `לפני ${age}` : "בפעם הקודמת"}. משכו
        למטה לרענון.
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    notice: {
      backgroundColor: c.warningBg,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      marginHorizontal: space.lg,
      marginBottom: space.sm,
    },
    text: { color: c.warning, fontSize: 14 },
  };
});
