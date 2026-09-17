import { StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { PROPERTY_READINESS_LABELS, propertyAddressOr } from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import type { MatchRow, PropertyDetail } from "@/lib/dtos";
import { formatPrice, roomsLabel } from "@/lib/format";
import {
  dealTypeLabel,
  maturityLabel,
  maturityTone,
  propertyStatusLabel,
  propertyStatusTone,
  propertyTypeLabel,
} from "@/lib/labels";
import { useQuery } from "@/lib/use-query";
import {
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

/** ‏ההתאמות מצד הנכס — שם הקונה ובשלותו, כפי שהשרת פותר אותם. */
interface PropertyMatch extends Omit<MatchRow, "property" | "propertyId"> {
  buyerId: string;
  buyerName: string | null;
  buyerMaturity: string | null;
}

function readinessLabel(field: string): string {
  return (PROPERTY_READINESS_LABELS as Record<string, string>)[field] ?? field;
}

/** ‏כרטיס נכס: הכתובת, המספרים, מה חסר, בעל הנכס וההתאמות. */
export default function PropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useQuery(async () => {
    const property = await apiGet<PropertyDetail>(`/properties/${id}`);
    // ההתאמות נטענות בנפרד: כישלון שלהן אינו מסתיר את הנכס
    const matches = await apiGet<PropertyMatch[]>(`/properties/${id}/matches`)
      .then((rows) => apiList(rows, "matches"))
      .catch(() => null);
    return { property, matches };
  }, [id]);

  if (query.loading && query.data === null) return <Loading />;
  if (query.data === null) {
    return <ErrorState message={query.error ?? "הנכס לא נטען"} onRetry={query.reload} />;
  }

  const { property: p, matches } = query.data;
  const address = propertyAddressOr(
    { street: p.street, houseNumber: p.houseNumber, neighborhood: p.neighborhood },
    p.city ?? "ללא כתובת",
  );
  const facts: [string, string][] = [
    ["סוג", propertyTypeLabel(p.propertyType)],
    ["עסקה", dealTypeLabel(p.dealType)],
    ["חדרים", roomsLabel(p.rooms)],
    ["שטח", p.areaSqm === undefined ? "" : `${p.areaSqm} מ״ר`],
    [
      "קומה",
      p.floor === undefined ? "" : p.totalFloors === undefined ? `${p.floor}` : `${p.floor} מתוך ${p.totalFloors}`,
    ],
    [
      "יש",
      [
        p.hasElevator ? "מעלית" : null,
        p.hasParking ? "חניה" : null,
        p.hasBalcony ? "מרפסת" : null,
        p.hasSafeRoom ? "ממ״ד" : null,
      ]
        .filter(Boolean)
        .join(", "),
    ],
    ["כניסה", p.entryNote ?? ""],
  ];

  return (
    <Screen refreshing={query.refreshing} onRefresh={() => void query.refresh()}>
      <Stack.Screen options={{ title: address }} />
      <Card>
        <View style={styles.headRow}>
          <Text variant="heading" style={styles.grow}>
            {address}
          </Text>
          <Pill tone={propertyStatusTone(p.status)}>{propertyStatusLabel(p.status)}</Pill>
        </View>
        {p.city ? <Text variant="muted">{p.city}</Text> : null}
        <Text variant="title">{formatPrice(p.priceAgorot) || "מחיר לא צוין"}</Text>
        {p.marketingTitle ? <Text>{p.marketingTitle}</Text> : null}
        {p.agentName ? <Text variant="small">מטפל: {p.agentName}</Text> : null}
      </Card>

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

      {p.readinessScore < 100 ? (
        <Card>
          <Text variant="label">מוכנות {p.readinessScore}%</Text>
          <Text variant="muted">
            חסר: {p.missingFields.map(readinessLabel).join(", ") || "פרטים"}. ההשלמה — מהמחשב.
          </Text>
        </Card>
      ) : null}

      {p.ownerContact ? (
        <>
          <SectionTitle>בעל הנכס</SectionTitle>
          <Card>
            <Text variant="title">{p.ownerContact.name}</Text>
            <Text variant="muted">{p.ownerContact.phone}</Text>
            <ContactActions phone={p.ownerContact.phone} name={p.ownerContact.name} />
          </Card>
        </>
      ) : p.ownerRedacted ? (
        <Card>
          <Text variant="muted">פרטי בעל הנכס אינם מוצגים למשתמש הזה.</Text>
        </Card>
      ) : null}

      {p.internalNotes ? (
        <Card>
          <Text variant="label">הערות פנימיות</Text>
          <Text>{p.internalNotes}</Text>
        </Card>
      ) : null}

      <SectionTitle count={matches?.length}>לקוחות מתאימים</SectionTitle>
      {matches === null ? (
        <Card>
          <Text variant="muted">ההתאמות לא נטענו — משכו למטה כדי לנסות שוב.</Text>
        </Card>
      ) : matches.length === 0 ? (
        <Card>
          <Text variant="muted">עדיין אין התאמות לנכס הזה.</Text>
        </Card>
      ) : (
        matches.slice(0, 10).map((m) => (
          <Row
            key={m.id}
            title={m.buyerName ?? "לקוח"}
            subtitle={m.explanation}
            onPress={() => router.push(`/buyers/${m.buyerId}`)}
            trailing={
              <>
                <Pill tone="primary">{`${Math.round(m.score)}%`}</Pill>
                {m.buyerMaturity ? (
                  <Pill tone={maturityTone(m.buyerMaturity)}>{maturityLabel(m.buyerMaturity)}</Pill>
                ) : null}
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
