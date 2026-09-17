import { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { apiGet, apiList } from "@/lib/api";
import type { BuyerRow } from "@/lib/dtos";
import { formatBudget } from "@/lib/format";
import { dealTypeLabel, maturityLabel, maturityTone } from "@/lib/labels";
import { useQuery } from "@/lib/use-query";
import { Chips, EmptyState, ErrorState, Field, Loading, Pill, Row, Screen } from "@/components";
import { colors, space } from "@/theme";

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
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const query = useQuery(
    () =>
      apiGet<{ items: BuyerRow[] }>("/buyers?limit=100").then((r) => apiList(r.items, "items")),
    [],
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
      .sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));
  }, [query.data, filter, search]);

  return (
    <Screen title="לקוחות" scroll={false}>
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
                formatBudget(b.requirements.budgetMinAgorot, b.requirements.budgetMaxAgorot),
              ]
                .filter(Boolean)
                .join(" · ")}
              onPress={() => router.push(`/buyers/${b.id}`)}
              trailing={<Pill tone={maturityTone(b.maturity)}>{maturityLabel(b.maturity)}</Pill>}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tools: { paddingHorizontal: space.lg, gap: space.sm, backgroundColor: colors.bg },
  list: { padding: space.lg, gap: space.sm, paddingBottom: space.xl * 2 },
});
