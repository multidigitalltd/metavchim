import { useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { routeFor } from "@/lib/nav";
import { apiGet, apiList } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { BuyerDetail, BuyerRow } from "@/lib/dtos";
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
   * ‏הבשלות הנבחרת עוברת לשרת לפני התקרה (ביקורת Codex), והחיפוש רץ
   * ‏בשני מקורות: `q=` של הרשימה (ערים, הערות, סיכומים) ו-`/search`
   * ‏של המערכת — היחיד שמחפש **בשם** (השם מוצפן, והחיפוש הכללי הולך
   * ‏באינדקס העיוור). מי שנמצא רק בשם נשלף בכרטיסו, עד עשרה.
   */
  const query = useQuery(
    async () => {
      const maturity = filter === "all" ? "" : `&maturity=${filter}`;
      const q = needle ? `&q=${encodeURIComponent(needle)}` : "";
      const listed = await apiGet<{ items: BuyerRow[] }>(
        `/buyers?limit=100${maturity}${q}`,
      ).then((r) => apiList(r.items, "items"));
      if (!needle) return listed;
      const seen = new Set(listed.map((b) => b.id));
      const hits = await apiGet<{ buyers: { id: string; maturity: string }[] }>(
        `/search?q=${encodeURIComponent(needle)}`,
      )
        .then((r) => apiList(r.buyers, "buyers"))
        .catch(() => []);
      const byName = await Promise.all(
        hits
          .filter((hit) => !seen.has(hit.id) && (filter === "all" || hit.maturity === filter))
          .slice(0, 10)
          .map((hit) => apiGet<BuyerDetail>(`/buyers/${hit.id}`).catch(() => null)),
      );
      // ‏מי שנמצא בשם — ראשון: זה מה שחיפשו
      return [...byName.filter((b): b is BuyerDetail => b !== null), ...listed];
    },
    [needle, filter],
    needle ? {} : { cacheKey: `buyers:${filter}` },
  );

  const rows = useMemo(() => {
    // ‏כשהשרת חיפש — התוצאות שלו הן התשובה (הוא מחפש גם בהערות ובסיכומים)
    const local = needle === "" ? search.trim() : "";
    return (query.data ?? [])
      .filter((b) => filter === "all" || b.maturity === filter)
      .filter(
        (b) =>
          local === "" ||
          b.contact.name.includes(local) ||
          b.requirements.cities.some((c) => c.includes(local)),
      )
      .sort(
        (a, b) =>
          MATURITY_ORDER.indexOf(a.maturity) -
          MATURITY_ORDER.indexOf(b.maturity),
      );
  }, [query.data, filter, search, needle]);

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
