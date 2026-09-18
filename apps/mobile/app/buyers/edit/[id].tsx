import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  DEAL_TYPE_LABELS,
  FINANCING_LABELS,
  MATURITY_LABELS,
  PROPERTY_TYPE_LABELS,
  type BuyerMaturity,
  type FinancingStatus,
} from "@metavchim/shared";
import { apiGet, apiPatch, errorMessage } from "@/lib/api";
import type { BuyerDetail } from "@/lib/dtos";
import { agorotToShekelsInput, numberInput, shekelsInputToAgorot } from "@/lib/format";
import { Button, Card, Chips, ErrorState, Field, Loading, MultiChips, Screen, Text } from "@/components";
import { colors, space } from "@/theme";

type Level = "must" | "nice" | "none";
const LEVELS: { key: Level; label: string }[] = [
  { key: "none", label: "לא משנה" },
  { key: "nice", label: "יתרון" },
  { key: "must", label: "חובה" },
];
/** ‏חמשת המאפיינים הקבועים; מאפיין מותאם שכבר על הכרטיס מצטרף אליהם. */
const BUILTIN_FEATURES: [string, string][] = [
  ["hasElevator", "מעלית"],
  ["hasParking", "חניה"],
  ["hasBalcony", "מרפסת"],
  ["hasSafeRoom", "ממ״ד"],
  ["hasStorage", "מחסן"],
];
const DEALS = Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => ({ key, label }));
const TYPES = Object.entries(PROPERTY_TYPE_LABELS).map(([key, label]) => ({ key, label }));
const FINANCING = (Object.keys(FINANCING_LABELS) as FinancingStatus[]).map((key) => ({ key, label: FINANCING_LABELS[key] }));
const MATURITY = (Object.keys(MATURITY_LABELS) as BuyerMaturity[]).map((key) => ({ key, label: MATURITY_LABELS[key] }));
const ENTRY = [
  { key: "none", label: "לא צוין" },
  { key: "immediate", label: "מיידי" },
  { key: "flexible", label: "גמיש" },
  { key: "by_date", label: "עד תאריך" },
];

const splitList = (text: string): string[] =>
  text.split(",").map((s) => s.trim()).filter(Boolean);

/**
 * ‏עריכת קונה — אותו `PATCH /buyers/:id` כמו ב-web: הדרישות נשלחות
 * ‏במלואן (הסכימה `strict`), על בסיס מה שיש בכרטיס, כך שאזורי המפה
 * ‏והעדפת הקומה — שאין להם עריכה כאן — נשארים כפי שהם.
 */
export default function EditBuyerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loaded, setLoaded] = useState<BuyerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<string[]>([]);
  const [features, setFeatures] = useState<Record<string, Level>>({});
  const [financing, setFinancing] = useState<FinancingStatus>("unknown");
  const [maturity, setMaturity] = useState<BuyerMaturity>("interested");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<BuyerDetail>(`/buyers/${id}`)
      .then((b) => {
        const r = b.requirements;
        setLoaded(b);
        setForm({
          dealType: r.dealType ?? "sale",
          cities: r.cities.join(", "),
          neighborhoods: (r.neighborhoods ?? []).join(", "),
          budgetMin: agorotToShekelsInput(r.budgetMinAgorot),
          budgetMax: agorotToShekelsInput(r.budgetMaxAgorot),
          roomsMin: r.roomsMin === undefined ? "" : String(r.roomsMin),
          roomsMax: r.roomsMax === undefined ? "" : String(r.roomsMax),
          areaSqmMin: r.areaSqmMin === undefined ? "" : String(r.areaSqmMin),
          entryType: r.entryType ?? "none",
          flexibilityNotes: r.flexibilityNotes ?? "",
          agentNotes: b.agentNotes ?? "",
        });
        setTypes(r.propertyTypes ?? []);
        setFeatures({ ...(r.features ?? {}) });
        setFinancing((b.financing as FinancingStatus) ?? "unknown");
        setMaturity(b.maturity as BuyerMaturity);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err, "הלקוח לא נטען")));
  }, [id]);

  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const featureKeys = [
    ...BUILTIN_FEATURES,
    ...Object.keys(features)
      .filter((key) => !BUILTIN_FEATURES.some(([k]) => k === key))
      .map((key): [string, string] => [key, key]),
  ];

  async function save() {
    if (loaded === null) return;
    setError(null);
    setBusy(true);
    const cleanFeatures: Record<string, "must" | "nice"> = {};
    for (const [key, level] of Object.entries(features)) {
      if (level === "must" || level === "nice") cleanFeatures[key] = level;
    }
    const text = (key: string): string | undefined => {
      const v = (form[key] ?? "").trim();
      return v === "" ? undefined : v;
    };
    const requirements: Record<string, unknown> = {
      ...loaded.requirements,
      dealType: form["dealType"],
      cities: splitList(form["cities"] ?? ""),
      neighborhoods: splitList(form["neighborhoods"] ?? ""),
      propertyTypes: types,
      budgetMinAgorot: shekelsInputToAgorot(form["budgetMin"] ?? ""),
      budgetMaxAgorot: shekelsInputToAgorot(form["budgetMax"] ?? ""),
      roomsMin: numberInput(form["roomsMin"] ?? ""),
      roomsMax: numberInput(form["roomsMax"] ?? ""),
      areaSqmMin: numberInput(form["areaSqmMin"] ?? ""),
      entryType: form["entryType"] === "none" ? undefined : form["entryType"],
      flexibilityNotes: text("flexibilityNotes"),
      features: cleanFeatures,
    };
    for (const key of Object.keys(requirements)) if (requirements[key] === undefined) delete requirements[key];
    try {
      await apiPatch(`/buyers/${id}`, {
        requirements,
        financing,
        maturity,
        // ריק נשלח כמחרוזת ריקה — מחיקה מכוונת של הערה קיימת, כמו ב-web
        agentNotes: (form["agentNotes"] ?? "").trim(),
      });
      router.back();
    } catch (err: unknown) {
      setError(errorMessage(err, "שמירת השינויים נכשלה"));
      setBusy(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => router.back()} />;
  if (loaded === null) return <Loading />;

  return (
    <Screen title={`עריכה — ${loaded.contact.name}`}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Card>
          <Text variant="title">מה מחפשים</Text>
          <Text variant="label">עסקה</Text>
          <Chips options={DEALS} value={form["dealType"] ?? "sale"} onChange={set("dealType")} />
          <Field label="ערים (מופרדות בפסיק)" value={form["cities"] ?? ""} onChangeText={set("cities")} />
          <Field label="שכונות (מופרדות בפסיק)" value={form["neighborhoods"] ?? ""} onChangeText={set("neighborhoods")} />
          <Text variant="label">סוגי נכס</Text>
          <MultiChips options={TYPES} value={types} onChange={setTypes} />
          <View style={styles.row}>
            <Field grow label="תקציב מ-(₪)" value={form["budgetMin"] ?? ""} onChangeText={set("budgetMin")} keyboardType="number-pad" />
            <Field grow label="עד (₪)" value={form["budgetMax"] ?? ""} onChangeText={set("budgetMax")} keyboardType="number-pad" />
          </View>
          <View style={styles.row}>
            <Field grow label="חדרים מ-" value={form["roomsMin"] ?? ""} onChangeText={set("roomsMin")} keyboardType="decimal-pad" />
            <Field grow label="עד" value={form["roomsMax"] ?? ""} onChangeText={set("roomsMax")} keyboardType="decimal-pad" />
          </View>
          <Field label="שטח מינימלי (מ״ר)" value={form["areaSqmMin"] ?? ""} onChangeText={set("areaSqmMin")} keyboardType="number-pad" />
          <Text variant="label">כניסה</Text>
          <Chips options={ENTRY} value={form["entryType"] ?? "none"} onChange={set("entryType")} />
        </Card>

        <Card style={styles.card}>
          <Text variant="title">מאפיינים</Text>
          {featureKeys.map(([key, label]) => (
            <View key={key}>
              <Text variant="label">{label}</Text>
              <Chips options={LEVELS} value={features[key] ?? "none"} onChange={(v) => setFeatures((f) => ({ ...f, [key]: v }))} />
            </View>
          ))}
          <Field label="גמישות והערות לדרישות" value={form["flexibilityNotes"] ?? ""} onChangeText={set("flexibilityNotes")} multiline numberOfLines={3} maxLength={1000} style={styles.multiline} />
        </Card>

        <Card style={styles.card}>
          <Text variant="title">הלקוח</Text>
          <Text variant="label">מימון</Text>
          <Chips options={FINANCING} value={financing} onChange={setFinancing} />
          <Text variant="label">בשלות</Text>
          <Chips options={MATURITY} value={maturity} onChange={setMaturity} />
          <Field label="הערות הסוכן" value={form["agentNotes"] ?? ""} onChangeText={set("agentNotes")} multiline numberOfLines={3} maxLength={4000} style={styles.multiline} />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="שמירת השינויים" onPress={() => void save()} busy={busy} style={styles.card} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.md },
  row: { flexDirection: "row", gap: space.sm },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
  error: { color: colors.danger, marginTop: space.md },
});
