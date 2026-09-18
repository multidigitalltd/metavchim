import { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { compareLeadsByUrgency, leadWaiting } from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { LeadRow } from "@/lib/dtos";
import { leadIntentLabel, leadSourceLabel, leadStatusLabel, leadStatusTone } from "@/lib/labels";
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
import { colors, space } from "@/theme";

type Filter = "open" | "new" | "in_progress" | "waiting_customer" | "converted" | "closed" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "לטיפול" },
  { key: "new", label: "חדש" },
  { key: "in_progress", label: "בטיפול" },
  { key: "waiting_customer", label: "ממתין ללקוח" },
  { key: "converted", label: "הומר" },
  { key: "closed", label: "סגור" },
  { key: "all", label: "הכול" },
];

/** ‏שם או טלפון: ספרות מושוות מול ספרות, טקסט מול השם. */
function leadMatches(lead: LeadRow, needle: string): boolean {
  if (needle === "") return true;
  if (lead.contact.name.includes(needle)) return true;
  const digits = needle.replace(/\D/gu, "");
  return digits !== "" && lead.contact.phone.replace(/\D/gu, "").includes(digits);
}

/** ‏מסך הלידים — מי ממתין הכי הרבה זמן למעלה, כמו ב-web. */
export default function LeadsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  /*
   * ‏הסינון במסד ולא על העמוד שחזר, כמו במסך ה-web: „לטיפול” הוא
   * ‏`open=true` ולא „מה שנשאר אחרי שסיננו 100 חדשים”. החיפוש נשאר
   * ‏מקומי — הוא מצמצם בתוך העמוד שכבר נטען.
   */
  const scope =
    filter === "all" ? "" : filter === "open" ? "&open=true" : `&status=${filter}`;
  const query = useQuery(
    () =>
      apiGet<{ items: LeadRow[] }>(`/leads?limit=100${scope}`).then((r) =>
        apiList(r.items, "items"),
      ),
    [scope],
    { cacheKey: `leads:${filter}` },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);
  const rows = useMemo(() => {
    const needle = search.trim();
    return (query.data ?? [])
      .filter((lead) => leadMatches(lead, needle))
      .sort(compareLeadsByUrgency);
  }, [query.data, search]);

  return (
    <Screen
      title="לידים"
      scroll={false}
      trailing={
        can(user, "leads.edit") ? (
          <Button title="+ ליד" kind="secondary" onPress={() => router.push("/leads/new")} />
        ) : undefined
      }
    >
      <View style={styles.tools}>
        <Field
          label="חיפוש"
          placeholder="שם או טלפון"
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
          keyExtractor={(lead) => lead.id}
          contentContainerStyle={styles.list}
          refreshing={query.refreshing}
          onRefresh={() => void query.refresh()}
          ListEmptyComponent={
            <EmptyState
              title={search ? "לא נמצא ליד כזה" : "אין לידים בסינון הזה"}
              hint={filter === "open" && !search ? "כל הלידים טופלו." : undefined}
            />
          }
          renderItem={({ item: lead }) => {
            const waiting = leadWaiting(lead.createdAt, lead.status, now);
            const subtitleParts = [
              leadIntentLabel(lead.intent),
              leadSourceLabel(lead.source, lead.sourceNote),
              waiting ? `ממתין ${waiting.label}` : null,
            ].filter(Boolean);
            return (
              <Row
                title={lead.contact.name}
                subtitle={subtitleParts.join(" · ")}
                onPress={() => router.push(`/leads/${lead.id}`)}
                trailing={
                  <>
                    <Pill tone={lead.requiresHuman ? "danger" : leadStatusTone(lead.status)}>
                      {lead.requiresHuman ? "דורש טיפול" : leadStatusLabel(lead.status)}
                    </Pill>
                    {waiting?.level === "late" ? <Pill tone="danger">מעל יממה</Pill> : null}
                  </>
                }
              />
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tools: { paddingHorizontal: space.lg, gap: space.sm, backgroundColor: colors.bg },
  list: { padding: space.lg, gap: space.sm, paddingBottom: space.xl * 2 },
});
