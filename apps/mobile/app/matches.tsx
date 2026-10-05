import { useMemo, useState } from "react";
import { Alert, Linking, SectionList, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { routeFor } from "@/lib/nav";
import { tapFeedback } from "@/lib/haptics";
import {
  DISMISS_REASONS,
  DISMISS_REASON_LABEL,
  type DismissReason,
} from "@metavchim/shared";
import {
  ApiError,
  apiGet,
  apiList,
  apiPatch,
  apiPost,
  errorMessage,
} from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { MatchRow, OfferInfo } from "@/lib/dtos";
import { formatPrice } from "@/lib/format";
import { useShell } from "@/lib/shell";
import { makeStyles } from "@/lib/theme";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  CacheNotice,
  Chips,
  EmptyState,
  ErrorState,
  Loading,
  Pill,
  Row,
  Screen,
  SectionTitle,
  Text,
} from "@/components";
import { space } from "@/theme";

type Direction = "byProperty" | "byBuyer";
type Threshold = "85" | "70" | "50";

const DIRECTIONS: { key: Direction; label: string }[] = [
  { key: "byProperty", label: "לפי נכס ← קונים" },
  { key: "byBuyer", label: "לפי קונה ← נכסים" },
];

const THRESHOLDS: { key: Threshold; label: string }[] = [
  { key: "85", label: "85%+ מומלץ" },
  { key: "70", label: "70%+ ייתכן" },
  { key: "50", label: "50%+ הכול" },
];

const LIST_LIMIT = 200;

const REASON_CHIPS = DISMISS_REASONS.map((key) => ({
  key,
  label: DISMISS_REASON_LABEL[key],
}));

function scoreTone(score: number): "success" | "amber" | "neutral" {
  return score >= 85 ? "success" : score >= 70 ? "amber" : "neutral";
}

interface Group {
  key: string;
  title: string;
  sub: string;
  href: string | null;
  data: MatchRow[];
}

/** ‏אותו קיבוץ כמו `groupMatches` ב-web: הקבוצה עם ההתאמה החזקה ביותר ראשונה. */
function groupMatches(
  items: readonly MatchRow[],
  direction: Direction,
): Group[] {
  const map = new Map<string, Group>();
  for (const m of items) {
    const key = direction === "byProperty" ? m.propertyId : m.buyerId;
    let group = map.get(key);
    if (group === undefined) {
      group =
        direction === "byProperty"
          ? {
              key,
              title: m.property.title ?? m.property.address,
              sub:
                m.property.priceAgorot === undefined
                  ? ""
                  : formatPrice(m.property.priceAgorot),
              href: `/properties/${m.propertyId}`,
              data: [],
            }
          : {
              key,
              title: m.buyerName ?? "קונה של סוכן אחר",
              sub: "",
              href: m.buyerName ? `/buyers/${m.buyerId}` : null,
              data: [],
            };
      map.set(key, group);
    }
    group.data.push(m);
  }
  const groups = [...map.values()];
  for (const g of groups) g.data.sort((a, b) => b.score - a.score);
  groups.sort((a, b) => (b.data[0]?.score ?? 0) - (a.data[0]?.score ?? 0));
  return groups;
}

/**
 * ‏ההתאמות — מסך 4 באפיון, כמו `/matches` ב-web: לפי נכס ← קונים או
 * ‏לפי קונה ← נכסים, סף התאמה, ציון והסבר לכל שורה. „לא רלוונטי”
 * ‏עם סיבה (זה מה שמכייל את המשקלים), ו„הצעה בוואטסאפ” — יצירת
 * ‏ההצעה ופתיחת wa.me עם ההודעה המוכנה, או במייל — כמו ב-web. „‎?property=”
 * ‏מגיע מ„N קונים מתאימים” בכרטיס הנכס.
 */
export default function MatchesScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const { hasFeature, refreshCounts } = useShell();
  const params = useLocalSearchParams<{ property?: string }>();
  const propertyId =
    typeof params.property === "string" && params.property !== ""
      ? params.property
      : null;
  const [direction, setDirection] = useState<Direction>("byProperty");
  const [threshold, setThreshold] = useState<Threshold>("70");
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offers, setOffers] = useState<Record<string, OfferInfo>>({});
  const canManage = can(user, "matches.manage");
  const canOffer = can(user, "offers.send");
  const canWhatsApp = canOffer && hasFeature("whatsapp");

  const query = useQuery(
    () =>
      apiGet<MatchRow[]>(
        `/matches?minScore=${threshold}&limit=${LIST_LIMIT}${propertyId ? `&propertyId=${encodeURIComponent(propertyId)}` : ""}`,
      ).then((r) => apiList(r, "matches")),
    [threshold, propertyId],
    { cacheKey: `matches:${threshold}:${propertyId ?? "all"}` },
  );

  const sections = useMemo(
    () => groupMatches(query.data ?? [], direction),
    [query.data, direction],
  );
  const total = query.data?.length ?? 0;

  async function dismiss(match: MatchRow, reason: DismissReason) {
    setDismissing(null);
    setBusy(match.id);
    try {
      await apiPatch(`/matches/${match.id}/dismiss`, { reason });
      tapFeedback();
      await query.refresh();
      refreshCounts();
    } catch (err: unknown) {
      Alert.alert("ההתאמה לא סומנה", errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** ‏ההצעה של השורה — קיימת מהסבב הזה, או נוצרת עכשיו. */
  async function ensureOffer(match: MatchRow): Promise<OfferInfo> {
    const existing = offers[match.id];
    if (existing !== undefined) return existing;
    const offer = await apiPost<OfferInfo>("/offers", { matchId: match.id });
    setOffers((prev) => ({ ...prev, [match.id]: offer }));
    return offer;
  }

  async function sendEmail(match: MatchRow) {
    setBusy(match.id);
    try {
      const offer = await ensureOffer(match);
      const { sentTo } = await apiPost<{ sentTo: string }>(
        `/offers/${offer.id}/email`,
        {},
      );
      Alert.alert("ההצעה נשלחה במייל", `נשלחה אל ${sentTo}`);
    } catch (err: unknown) {
      Alert.alert(
        "ההצעה לא נשלחה",
        err instanceof ApiError && err.status === 403
          ? "אין הרשאה לשלוח הצעות מהחשבון הזה."
          : errorMessage(err, "לקונה אין כתובת מייל, או שהשליחה נכשלה"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendWhatsApp(match: MatchRow) {
    setBusy(match.id);
    try {
      const offer = await ensureOffer(match);
      const { waUrl } = await apiPost<{ waUrl: string }>(
        `/offers/${offer.id}/whatsapp`,
        {},
      );
      const opened = await Linking.openURL(waUrl).then(
        () => true,
        () => false,
      );
      if (!opened)
        Alert.alert(
          "וואטסאפ לא נפתח",
          "אפשר לשלוח את הקישור להצעה ידנית:\n" + offer.url,
        );
    } catch (err: unknown) {
      Alert.alert(
        "ההצעה לא נשלחה",
        err instanceof ApiError && err.status === 403
          ? "אין הרשאה לשלוח הצעות מהחשבון הזה."
          : errorMessage(err),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="התאמות" root scroll={false}>
      <View style={styles.tools}>
        <Chips options={DIRECTIONS} value={direction} onChange={setDirection} />
        <Chips options={THRESHOLDS} value={threshold} onChange={setThreshold} />
        {propertyId ? (
          <View style={styles.filterRow}>
            <Pill tone="primary">מסונן להתאמות של נכס אחד</Pill>
            <Button
              title="כל ההתאמות"
              kind="text"
              small
              onPress={() => router.replace("/matches")}
            />
          </View>
        ) : null}
      </View>
      <CacheNotice query={query} />
      {query.loading && query.data === null ? <Loading /> : null}
      {query.error && query.data === null ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : null}
      {query.data !== null ? (
        <SectionList
          sections={sections}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshing={query.refreshing}
          onRefresh={() => void query.refresh()}
          ListEmptyComponent={
            <EmptyState
              title="אין התאמות בסף הזה"
              hint={
                propertyId
                  ? "אפשר להוריד את סף ההתאמה, או לחזור לכל ההתאמות."
                  : "הוסיפו נכסים וקונים — ההתאמות מחושבות אוטומטית."
              }
            />
          }
          ListFooterComponent={
            total >= LIST_LIMIT ? (
              <Text variant="small">
                מוצגות {LIST_LIMIT} ההתאמות החזקות ביותר — הסף הגבוה יותר מצמצם.
              </Text>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <SectionTitle
              count={section.data.length}
              trailing={
                section.href ? (
                  <Button
                    title={section.sub || "לכרטיס"}
                    kind="text"
                    small
                    onPress={() => router.push(routeFor(section.href as string))}
                  />
                ) : section.sub ? (
                  <Text variant="small">{section.sub}</Text>
                ) : undefined
              }
            >
              {section.title}
            </SectionTitle>
          )}
          renderItem={({ item: m }) => {
            const title =
              direction === "byProperty"
                ? (m.buyerName ?? "קונה של סוכן אחר")
                : (m.property.title ?? m.property.address);
            const href =
              direction === "byProperty"
                ? m.buyerName
                  ? `/buyers/${m.buyerId}`
                  : null
                : `/properties/${m.propertyId}`;
            const offer = offers[m.id];
            return (
              <Row
                title={title}
                subtitle={m.explanation}
                onPress={href === null ? undefined : () => router.push(routeFor(href))}
                trailing={
                  <Pill tone={scoreTone(m.score)}>{`${m.score}%`}</Pill>
                }
              >
                {canManage || canOffer ? (
                  <View style={styles.actions}>
                    {canWhatsApp ? (
                      <Button
                        title={
                          offer === undefined ? "הצעה בוואטסאפ" : "שוב בוואטסאפ"
                        }
                        kind="secondary"
                        small
                        busy={busy === m.id}
                        onPress={() => void sendWhatsApp(m)}
                        accessibilityHint={`יוצר הצעה ל${title} ופותח את וואטסאפ עם ההודעה`}
                      />
                    ) : null}
                    {canOffer ? (
                      <Button
                        title="במייל"
                        kind="ghost"
                        small
                        busy={busy === m.id && !canWhatsApp}
                        disabled={busy === m.id}
                        onPress={() => void sendEmail(m)}
                        accessibilityHint={`יוצר הצעה ל${title} ושולח אותה במייל לקונה`}
                      />
                    ) : null}
                    {canManage ? (
                      <Button
                        title="לא רלוונטי"
                        kind="ghost"
                        small
                        disabled={busy === m.id}
                        onPress={() =>
                          setDismissing(dismissing === m.id ? null : m.id)
                        }
                      />
                    ) : null}
                  </View>
                ) : null}
                {dismissing === m.id ? (
                  <View style={styles.reasons}>
                    <Text variant="small">
                      למה לא מתאים? הסיבה מכיילת את ההתאמות הבאות.
                    </Text>
                    <Chips
                      options={REASON_CHIPS}
                      value={null}
                      onChange={(reason) => void dismiss(m, reason)}
                    />
                  </View>
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
    filterRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    list: { padding: space.lg, gap: space.sm, paddingBottom: space.xl * 2 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: space.sm,
      marginTop: space.xs,
    },
    reasons: { marginTop: space.xs, gap: space.xs },
  };
});
