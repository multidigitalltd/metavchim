import { useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { routeFor } from "@/lib/nav";
import { propertyAddressOr } from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { PropertyRow } from "@/lib/dtos";
import { formatPrice, roomsLabel } from "@/lib/format";
import {
  propertyStatusLabel,
  propertyStatusTone,
  propertyTypeLabel,
} from "@/lib/labels";
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
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  /*
   * ‏החיפוש רץ בשרת (`q=`), לא רק על 100 השורות שנטענו: משרד עם 400
   * ‏נכסים היה מקבל „לא נמצא” על נכס שפשוט אינו בעמוד הראשון. השאילתה
   * ‏יוצאת אחרי הפסקת הקלדה קצרה, ורק מ-2 תווים; הסינון המקומי נשאר
   * ‏למה שכבר על המסך. בלי חיפוש הרשימה נשמרת במטמון לצפייה בלי רשת.
   */
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const trimmed = search.trim();
    const next = trimmed.length >= 2 ? trimmed : "";
    const timer = setTimeout(() => setNeedle(next), 300);
    return () => clearTimeout(timer);
  }, [search]);
  /*
   * ‏הסטטוס הנבחר עובר לשרת יחד עם החיפוש, לפני התקרה של 100: אחרת
   * ‏נכס פעיל שמתאים לחיפוש היה נדחק מהעמוד בידי טיוטות ונכסים שנסגרו
   * ‏(ביקורת Codex). „נסגרו” הם שני סטטוסים — שתי שאילתות.
   */
  const statuses =
    filter === "all" ? [null] : filter === "closed" ? ["sold", "rented"] : [filter];
  const query = useQuery(
    async () => {
      const q = needle ? `&q=${encodeURIComponent(needle)}` : "";
      const pages = await Promise.all(
        statuses.map((status) =>
          apiGet<{ items: PropertyRow[] }>(
            `/properties?limit=100${status ? `&status=${status}` : ""}${q}`,
          ).then((r) => apiList(r.items, "items")),
        ),
      );
      return pages.flat();
    },
    [needle, filter],
    needle ? {} : { cacheKey: `properties:${filter}` },
  );

  const rows = useMemo(() => {
    // ‏כשהשרת חיפש — התוצאות שלו הן התשובה (הוא מחפש גם במה שאין כאן)
    const local = needle === "" ? search.trim() : "";
    return (query.data ?? []).filter(
      (p) =>
        matches(filter, p.status) &&
        (local === "" ||
          [p.city, p.neighborhood, p.street].some(
            (part) => part?.includes(local) ?? false,
          )),
    );
  }, [query.data, filter, search, needle]);

  return (
    <Screen
      title="נכסים"
      root
      scroll={false}
      trailing={
        can(user, "properties.create") ? (
          <Button
            title="+ נכס"
            kind="secondary"
            onPress={() => router.push(routeFor("/properties/new"))}
          />
        ) : undefined
      }
    >
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
                onPress={() => router.push(routeFor(`/properties/${p.id}`))}
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
