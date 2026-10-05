import { ActivityIndicator, View } from "react-native";
import { space } from "@/theme";
import { Button } from "./Button";
import { Text } from "./Text";
import { makeStyles, useColors } from "@/lib/theme";

export function Loading({ label = "טוען…" }: { label?: string }) {
  const styles = useStyles();
  const c = useColors();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={c.primary} size="large" />
      <Text variant="muted">{label}</Text>
    </View>
  );
}

/** ‏כישלון טעינה — נאמר במפורש, עם דרך לנסות שוב. לעולם לא „ריק”. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.center} accessibilityLiveRegion="assertive">
      <Text style={styles.error}>{message}</Text>
      {onRetry ? (
        <Button title="נסו שוב" kind="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.center}>
      <Text variant="title" style={styles.centerText}>
        {title}
      </Text>
      {hint ? (
        <Text variant="muted" style={styles.centerText}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    center: {
      alignItems: "center",
      justifyContent: "center",
      padding: space.xl,
      gap: space.md,
    },
    centerText: { textAlign: "center" },
    error: { color: c.danger, textAlign: "center" },
  };
});
