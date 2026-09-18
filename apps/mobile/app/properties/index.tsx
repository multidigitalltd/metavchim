import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { propertyAddressOr } from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import type { PropertyRow } from "@/lib/dtos";
import { formatPrice, roomsLabel } from "@/lib/format";
import {
  propertyStatusLabel,
  propertyStatusTone,
  propertyTypeLabel,
} from "@/lib/labels";
import { useQuery } from "@/lib/use-query";
import {
  CacheNotice,
  Chips,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Pill,
  Row,
  Screen,
  Text,
} from "@/components";
import { space } from "@/theme";
import { makeStyles } from "@/lib/theme";

type Filter = "active" | "draft" | "on_hold" | "closed" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "active", label: "פעילים" },
  { key: "draft", label: "טיוטות" },
  { key: "on_hold", label: "בהמתנה" },
  { key: "closed", label: "נסגרו" },
  { key: "all", label: "הכול" },
];

function matches(filter: Filter, status: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "closed":
      return status === "sold" || status === "rented";
    default:
      return status === filter;
  }
}

/** ‏מסך הנכסים — כתובת, סוג, חדרים ומחיר; המוכנות כאחוז. */
export default function PropertiesScreen() {
  const styles = useStyles();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const query = useQuery(
    () =>
      apiGet<{ items: PropertyRow[] }>("/properties?limit=100").then((r) =>
        apiList(r.items, "items"),
      ),
    [],
    { cacheKey: "properties" },
  );

  const rows = useMemo(() => {
    const needle = search.trim();
    return (query.data ?? []).filter(
      (p) =>
        matches(filter, p.status) &&
        (needle === "" ||
          [p.city, p.neighborhood, p.street].some(
            (part) => part?.includes(needle) ?? false,
          )),
    );
  }, [query.data, filter, search]);

  return (
    <Screen title="נכסים" root scroll={false}>
      <View style={styles.tools}>
        <Field
          label="חיפוש"
          placeholder="עיר, שכונה או רחוב"
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
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshing={query.refreshing}
          onRefresh={() => void query.refresh()}
          ListEmptyComponent={<EmptyState title="אין נכסים בסינון הזה" />}
          renderItem={({ item: p }) => {
            const address = propertyAddressOr(
              {
                street: p.street,
                houseNumber: p.houseNumber,
                neighborhood: p.neighborhood,
              },
              p.city ?? "ללא כתובת",
            );
            const details = [
              propertyTypeLabel(p.propertyType),
              roomsLabel(p.rooms),
              p.city,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Row
                title={address}
                subtitle={details}
                onPress={() => router.push(`/properties/${p.id}`)}
                trailing={
                  <>
                    <Text variant="body" style={styles.price}>
                      {formatPrice(p.priceAgorot)}
                    </Text>
                    <Pill tone={propertyStatusTone(p.status)}>
                      {propertyStatusLabel(p.status)}
                    </Pill>
                  </>
                }
              >
                {p.readinessScore < 100 ? (
                  <Text variant="small">
                    מוכנות {p.readinessScore}% · חסרים {p.missingFields.length}{" "}
                    פרטים
                  </Text>
                ) : null}
              </Row>
            );
          }}
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
    price: { fontWeight: "700" },
  };
});
