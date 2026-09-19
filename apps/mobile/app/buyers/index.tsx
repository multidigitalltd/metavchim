import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { routeFor } from "@/lib/nav";
import { apiGet, apiList } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { BuyerRow } from "@/lib/dtos";
import { formatBudget } from "@/lib/format";
import { dealTypeLabel, maturityLabel, maturityTone } from "@/lib/labels";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  CacheNotice,
  Chips,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Pill,
  Row,
  Screen,
} from "@/components";
import { space } from "@/theme";
import { makeStyles } from "@/lib/theme";

type Filter = "all" | "very_hot" | "hot" | "interested" | "not_ripe";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "הכול" },
  { key: "very_hot", label: "חם מאוד" },
  { key: "hot", label: "חם" },
  { key: "interested", label: "מתעניין" },
  { key: "not_ripe", label: "לא בשל" },
];

const MATURITY_ORDER = ["very_hot", "hot", "interested", "not_ripe"];

/** ‏לקוחות (קונים ושוכרים) — החמים למעלה. */
export default function BuyersScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const query = useQuery(
    () =>
      apiGet<{ items: BuyerRow[] }>("/buyers?limit=100").then((r) =>
        apiList(r.items, "items"),
      ),
    [],
    { cacheKey: "buyers" },
  );

  const rows = useMemo(() => {
    const needle = search.trim();
    return (query.data ?? [])
      .filter((b) => filter === "all" || b.maturity === filter)
      .filter(
        (b) =>
          needle === "" ||
          b.contact.name.includes(needle) ||
          b.requirements.cities.some((c) => c.includes(needle)),
      )
      .sort(
        (a, b) =>
          MATURITY_ORDER.indexOf(a.maturity) -
          MATURITY_ORDER.indexOf(b.maturity),
      );
  }, [query.data, filter, search]);

  return (
    <Screen
      title="לקוחות"
      root
      scroll={false}
      trailing={
        can(user, "buyers.edit") ? (
          <Button
            title="+ לקוח"
            kind="secondary"
            onPress={() => router.push("/buyers/new")}
          />
        ) : undefined
      }
    >
      <View style={styles.tools}>
        <Field
          label="חיפוש"
          placeholder="שם או עיר"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </View>
      <CacheNotice query={query} />
      {query.loading && query.data === null ? <Loading /> : null}
      {query.error && query.data === null ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : null}
      {query.data !== null ? (
        <FlatList
          data={rows}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          refreshing={query.refreshing}
          onRefresh={() => void query.refresh()}
          ListEmptyComponent={<EmptyState title="אין לקוחות בסינון הזה" />}
          renderItem={({ item: b }) => (
            <Row
              title={b.contact.name}
              subtitle={[
                dealTypeLabel(b.requirements.dealType),
                b.requirements.cities.join(", "),
                formatBudget(
                  b.requirements.budgetMinAgorot,
                  b.requirements.budgetMaxAgorot,
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
              onPress={() => router.push(routeFor(`/buyers/${b.id}`))}
              trailing={
                <Pill tone={maturityTone(b.maturity)}>
                  {maturityLabel(b.maturity)}
                </Pill>
              }
            />
          )}
        />
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    tools: {
      paddingHorizontal: space.lg,
      gap: space.sm,
      backgroundColor: c.bg,
    },
    list: { padding: space.lg, gap: space.sm, paddingBottom: space.xl * 2 },
  };
});
