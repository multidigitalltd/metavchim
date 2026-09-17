import { useMemo } from "react";
import { Alert, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { apiGet, apiList, apiPatch, errorMessage } from "@/lib/api";
import type { NotificationRow } from "@/lib/dtos";
import { formatWhen } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Button, EmptyState, ErrorState, Loading, Row, Screen, Text } from "@/components";
import { colors } from "@/theme";

/** ‏לאן מובילה התראה — רק לישויות שיש להן מסך באפליקציה. */
function targetOf(n: NotificationRow): string | null {
  if (!n.entityType || !n.entityId) return null;
  switch (n.entityType) {
    case "lead":
      return `/leads/${n.entityId}`;
    case "property":
      return `/properties/${n.entityId}`;
    case "buyer":
      return `/buyers/${n.entityId}`;
    default:
      return null;
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const query = useQuery(
    () =>
      apiGet<{ items: NotificationRow[]; unreadCount: number }>("/notifications?limit=50").then(
        (r) => ({ items: apiList(r.items, "items"), unreadCount: r.unreadCount }),
      ),
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);

  async function open(n: NotificationRow) {
    if (!n.readAt) {
      // סימון כנקרא הוא נוחות — הניווט אינו ממתין לו ואינו נכשל בגללו
      void apiPatch(`/notifications/${n.id}/read`, {}).then(
        () => query.refresh(),
        () => undefined,
      );
    }
    const target = targetOf(n);
    if (target !== null) router.push(target);
  }

  async function readAll() {
    try {
      await apiPatch("/notifications/read-all", {});
      await query.refresh();
    } catch (err: unknown) {
      Alert.alert("לא הצלחנו לסמן", errorMessage(err));
    }
  }

  return (
    <Screen
      refreshing={query.refreshing}
      onRefresh={() => void query.refresh()}
      trailing={
        query.data && query.data.unreadCount > 0 ? (
          <Button title="סמן הכול כנקרא" kind="ghost" onPress={() => void readAll()} />
        ) : undefined
      }
      title="התראות"
    >
      {query.loading && query.data === null ? <Loading /> : null}
      {query.error && query.data === null ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : null}
      {query.data?.items.length === 0 ? (
        <EmptyState title="אין התראות" hint="כשמשהו יקרה — הוא יופיע כאן." />
      ) : null}
      {query.data?.items.map((n) => (
        <Row
          key={n.id}
          title={n.title}
          subtitle={n.body}
          onPress={() => void open(n)}
          trailing={
            <Text variant="small" style={n.readAt ? undefined : styles.unread}>
              {formatWhen(n.createdAt, now)}
            </Text>
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  unread: { color: colors.primary, fontWeight: "700" },
});
