import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiGet, apiList } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { BuyerDetail, MatchRow } from "@/lib/dtos";
import { formatBudget, formatPrice } from "@/lib/format";
import {
  buyerSourceLabel,
  dealTypeLabel,
  financingLabel,
  maturityLabel,
  maturityTone,
  propertyTypeLabel,
} from "@/lib/labels";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  CacheNotice,
  Card,
  ContactActions,
  ErrorState,
  Loading,
  Pill,
  Row,
  Screen,
  SectionTitle,
  Text,
} from "@/components";
import { space } from "@/theme";

const FEATURE_LABELS: Record<string, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: "ממ״ד",
  hasStorage: "מחסן",
};

/** ‏כרטיס לקוח: חיוג ווואטסאפ, מה הוא מחפש, וההתאמות שנמצאו לו. */
export default function BuyerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const canTasks = can(user, "calendar.manage");
  const canEdit = can(user, "buyers.edit");
  const query = useQuery(async () => {
    const buyer = await apiGet<BuyerDetail>(`/buyers/${id}`);
    const matches = await apiGet<MatchRow[]>(`/buyers/${id}/matches`)
      .then((rows) => apiList(rows, "matches"))
      .catch(() => null);
    return { buyer, matches };
  }, [id], { cacheKey: `buyer:${id}` });

  if (query.loading && query.data === null) return <Loading />;
  if (query.data === null) {
    return <ErrorState message={query.error ?? "הלקוח לא נטען"} onRetry={query.reload} />;
  }

  const { buyer: b, matches } = query.data;
  const r = b.requirements;
  const must = Object.entries(r.features ?? {})
    .filter(([, level]) => level === "must")
    .map(([key]) => FEATURE_LABELS[key] ?? key);
  const nice = Object.entries(r.features ?? {})
    .filter(([, level]) => level === "nice")
    .map(([key]) => FEATURE_LABELS[key] ?? key);
  const rooms =
    r.roomsMin === undefined && r.roomsMax === undefined
      ? ""
      : r.roomsMin !== undefined && r.roomsMax !== undefined
        ? `${r.roomsMin}–${r.roomsMax} חד׳`
        : r.roomsMin !== undefined
          ? `מ-${r.roomsMin} חד׳`
          : `עד ${r.roomsMax} חד׳`;
  const facts: [string, string][] = [
    ["עסקה", dealTypeLabel(r.dealType)],
    ["ערים", r.cities.join(", ")],
    ["שכונות", (r.neighborhoods ?? []).join(", ")],
    ["סוג נכס", (r.propertyTypes ?? []).map(propertyTypeLabel).join(", ")],
    ["תקציב", formatBudget(r.budgetMinAgorot, r.budgetMaxAgorot)],
    ["חדרים", rooms],
    ["שטח", r.areaSqmMin === undefined ? "" : `מ-${r.areaSqmMin} מ״ר`],
    ["חובה", must.join(", ")],
    ["יתרון", nice.join(", ")],
    ["מימון", financingLabel(b.financing)],
    ["גמישות", r.flexibilityNotes ?? ""],
  ];

  return (
    <Screen title={b.contact.name} refreshing={query.refreshing} onRefresh={() => void query.refresh()}>
      
      <CacheNotice query={query} />
      <Card>
        <View style={styles.headRow}>
          <Text variant="heading" style={styles.grow}>
            {b.contact.name}
          </Text>
          <Pill tone={maturityTone(b.maturity)}>{maturityLabel(b.maturity)}</Pill>
        </View>
        <Text variant="muted">
          {[b.contact.phone, buyerSourceLabel(b.source), b.agentName ? `מטפל: ${b.agentName}` : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <ContactActions phone={b.contact.phone} name={b.contact.name} />
        {canEdit ? (
          <Button
            title="עריכת הלקוח"
            kind="secondary"
            onPress={() => router.push(`/buyers/edit/${b.id}`)}
          />
        ) : null}
        {canTasks ? (
          <Button
            title="משימה על הלקוח"
            kind="ghost"
            onPress={() =>
              router.push({
                pathname: "/tasks/new",
                params: { entityType: "buyer", entityId: b.id, label: b.contact.name },
              })
            }
          />
        ) : null}
      </Card>

      <SectionTitle>מה מחפשים</SectionTitle>
      <Card>
        {facts
          .filter(([, value]) => value !== "")
          .map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <Text variant="label">{label}</Text>
              <Text style={styles.factValue}>{value}</Text>
            </View>
          ))}
      </Card>

      <SectionTitle count={matches?.length}>נכסים מתאימים</SectionTitle>
      {matches === null ? (
        <Card>
          <Text variant="muted">ההתאמות לא נטענו — משכו למטה כדי לנסות שוב.</Text>
        </Card>
      ) : matches.length === 0 ? (
        <Card>
          <Text variant="muted">עדיין אין התאמות ללקוח הזה.</Text>
        </Card>
      ) : (
        matches.slice(0, 10).map((m) => (
          <Row
            key={m.id}
            title={m.property.title ?? m.property.address}
            subtitle={[m.property.address, m.explanation].filter(Boolean).join(" · ")}
            onPress={() => router.push(`/properties/${m.propertyId}`)}
            trailing={
              <>
                <Pill tone="primary">{`${Math.round(m.score)}%`}</Pill>
                <Text variant="small">{formatPrice(m.property.priceAgorot)}</Text>
              </>
            }
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  grow: { flex: 1 },
  factRow: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  factValue: { flex: 1, textAlign: "left" },
});
