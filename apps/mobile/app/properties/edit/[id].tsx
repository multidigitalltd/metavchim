import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  DEAL_TYPE_LABELS,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_FACING_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type PropertyStatus,
} from "@metavchim/shared";
import { apiGet, apiPatch, errorMessage } from "@/lib/api";
import type { PropertyDetail } from "@/lib/dtos";
import { agorotToShekelsInput, numberInput, shekelsInputToAgorot } from "@/lib/format";
import { Button, Card, Chips, ErrorState, Field, Loading, Screen, Text } from "@/components";
import { space } from "@/theme";

type Tri = "yes" | "no" | "unknown";
const TRI: { key: Tri; label: string }[] = [
  { key: "yes", label: "כן" },
  { key: "no", label: "לא" },
  { key: "unknown", label: "טרם נשאל" },
];
const triOf = (value: boolean | undefined): Tri =>
  value === true ? "yes" : value === false ? "no" : "unknown";
const boolOf = (tri: Tri): boolean | undefined =>
  tri === "yes" ? true : tri === "no" ? false : undefined;

const FEATURES: { key: keyof Pick<PropertyDetail, "hasElevator" | "hasParking" | "hasBalcony" | "hasSafeRoom" | "hasStorage">; label: string }[] = [
  { key: "hasElevator", label: "מעלית" },
  { key: "hasParking", label: "חניה" },
  { key: "hasBalcony", label: "מרפסת" },
  { key: "hasSafeRoom", label: "ממ״ד" },
  { key: "hasStorage", label: "מחסן" },
];

const NONE = "__none__";
const withNone = (map: Record<string, string>) => [
  { key: NONE, label: "לא צוין" },
  ...Object.entries(map).map(([key, label]) => ({ key, label })),
];
const TYPES = Object.entries(PROPERTY_TYPE_LABELS).map(([key, label]) => ({ key, label }));
const DEALS = Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => ({ key, label }));
const CONDITIONS = withNone(PROPERTY_CONDITION_LABELS);
const FACINGS = withNone(PROPERTY_FACING_LABELS);
const STATUSES = (Object.keys(PROPERTY_STATUS_LABELS) as PropertyStatus[]).map((key) => ({
  key,
  label: PROPERTY_STATUS_LABELS[key],
}));
const ENTRY: { key: string; label: string }[] = [
  { key: NONE, label: "לא צוין" },
  { key: "immediate", label: "מיידי" },
  { key: "flexible", label: "גמיש" },
  { key: "on_date", label: "בתאריך" },
  { key: "from_date", label: "מתאריך" },
];

/**
 * ‏עריכת נכס — אותו `PATCH /properties/:id` כמו ב-web, ואותם כללים:
 * ‏שדה שלא נשלח הוא „בלי שינוי”; מספר בית, מצב וכיוון נשלחים כ-`null`
 * ‏כשרוקנו, כי ריקון בעריכה הוא מחיקה מכוונת. הטופס נטען מהכרטיס
 * ‏ושולח רק מה שיש לו — המפה והבעלים נשארים למסך המלא.
 */
export default function EditPropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loaded, setLoaded] = useState<PropertyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [tri, setTri] = useState<Record<string, Tri>>({});
  const [status, setStatus] = useState<PropertyStatus>("active");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<PropertyDetail>(`/properties/${id}`)
      .then((p) => {
        setLoaded(p);
        setStatus(p.status);
        setForm({
          city: p.city ?? "",
          neighborhood: p.neighborhood ?? "",
          street: p.street ?? "",
          houseNumber: p.houseNumber ?? "",
          propertyType: p.propertyType ?? NONE,
          dealType: p.dealType ?? "sale",
          rooms: p.rooms === undefined ? "" : String(p.rooms),
          areaSqm: p.areaSqm === undefined ? "" : String(p.areaSqm),
          floor: p.floor === undefined ? "" : String(p.floor),
          totalFloors: p.totalFloors === undefined ? "" : String(p.totalFloors),
          price: agorotToShekelsInput(p.priceAgorot),
          condition: p.condition ?? NONE,
          facing: p.facing ?? NONE,
          entryType: p.entryType ?? NONE,
          entryNote: p.entryNote ?? "",
          marketingTitle: p.marketingTitle ?? "",
          internalNotes: p.internalNotes ?? "",
          sharedTabu: p.sharedTabu ? "yes" : "no",
        });
        setTri(Object.fromEntries(FEATURES.map((f) => [f.key, triOf(p[f.key])])));
      })
      .catch((err: unknown) => setLoadError(errorMessage(err, "הנכס לא נטען")));
  }, [id]);

  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setError(null);
    if (form["city"]?.trim() === "") {
      setError("עיר — חובה");
      return;
    }
    setBusy(true);
    const text = (key: string): string | undefined => {
      const v = (form[key] ?? "").trim();
      return v === "" ? undefined : v;
    };
    const patch: Record<string, unknown> = {
      city: text("city"),
      neighborhood: text("neighborhood") ?? "",
      street: text("street") ?? "",
      houseNumber: text("houseNumber") ?? null,
      propertyType: form["propertyType"] === NONE ? undefined : form["propertyType"],
      dealType: form["dealType"],
      rooms: numberInput(form["rooms"] ?? ""),
      areaSqm: numberInput(form["areaSqm"] ?? ""),
      floor: numberInput(form["floor"] ?? ""),
      totalFloors: numberInput(form["totalFloors"] ?? ""),
      priceAgorot: shekelsInputToAgorot(form["price"] ?? ""),
      condition: form["condition"] === NONE ? null : form["condition"],
      facing: form["facing"] === NONE ? null : form["facing"],
      entryType: form["entryType"] === NONE ? undefined : form["entryType"],
      entryNote: text("entryNote"),
      marketingTitle: text("marketingTitle"),
      internalNotes: text("internalNotes"),
      sharedTabu: form["sharedTabu"] === "yes",
      status,
      ...Object.fromEntries(FEATURES.map((f) => [f.key, boolOf(tri[f.key] ?? "unknown")])),
    };
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
    try {
      await apiPatch(`/properties/${id}`, patch);
      router.back();
    } catch (err: unknown) {
      setError(errorMessage(err, "שמירת השינויים נכשלה"));
      setBusy(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => router.back()} />;
  if (loaded === null) return <Loading />;

  return (
    <Screen title="עריכת נכס">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Card>
          <Text variant="title">כתובת</Text>
          <Field label="עיר" value={form["city"] ?? ""} onChangeText={set("city")} />
          <Field label="שכונה" value={form["neighborhood"] ?? ""} onChangeText={set("neighborhood")} />
          <Field label="רחוב" value={form["street"] ?? ""} onChangeText={set("street")} />
          <Field label="מספר בית" value={form["houseNumber"] ?? ""} onChangeText={set("houseNumber")} maxLength={10} />
        </Card>

        <Card style={styles.card}>
          <Text variant="title">הנכס</Text>
          <Text variant="label">סוג</Text>
          <Chips options={[{ key: NONE, label: "לא צוין" }, ...TYPES]} value={form["propertyType"] ?? NONE} onChange={set("propertyType")} />
          <Text variant="label">עסקה</Text>
          <Chips options={DEALS} value={form["dealType"] ?? "sale"} onChange={set("dealType")} />
          <Field label="חדרים" value={form["rooms"] ?? ""} onChangeText={set("rooms")} keyboardType="decimal-pad" placeholder="3.5" />
          <Field label="שטח (מ״ר)" value={form["areaSqm"] ?? ""} onChangeText={set("areaSqm")} keyboardType="number-pad" />
          <Field label="קומה" value={form["floor"] ?? ""} onChangeText={set("floor")} keyboardType="numbers-and-punctuation" />
          <Field label="קומות בבניין" value={form["totalFloors"] ?? ""} onChangeText={set("totalFloors")} keyboardType="number-pad" />
          <Field label="מחיר (₪)" value={form["price"] ?? ""} onChangeText={set("price")} keyboardType="number-pad" />
          <Text variant="label">מצב</Text>
          <Chips options={CONDITIONS} value={form["condition"] ?? NONE} onChange={set("condition")} />
          <Text variant="label">כיוון</Text>
          <Chips options={FACINGS} value={form["facing"] ?? NONE} onChange={set("facing")} />
        </Card>

        <Card style={styles.card}>
          <Text variant="title">מאפיינים</Text>
          {FEATURES.map((f) => (
            <Text key={f.key} variant="label">
              {f.label}
              {"\n"}
              <Chips options={TRI} value={tri[f.key] ?? "unknown"} onChange={(v) => setTri((t) => ({ ...t, [f.key]: v }))} />
            </Text>
          ))}
          <Text variant="label">טאבו משותף</Text>
          <Chips
            options={[{ key: "no", label: "לא" }, { key: "yes", label: "כן" }]}
            value={form["sharedTabu"] ?? "no"}
            onChange={set("sharedTabu")}
          />
        </Card>

        <Card style={styles.card}>
          <Text variant="title">כניסה ושיווק</Text>
          <Text variant="label">מועד כניסה</Text>
          <Chips options={ENTRY} value={form["entryType"] ?? NONE} onChange={set("entryType")} />
          <Field label="הערת כניסה" value={form["entryNote"] ?? ""} onChangeText={set("entryNote")} maxLength={160} placeholder="אחרי הפסח / גמיש ±חודש" />
          <Field label="כותרת שיווקית" value={form["marketingTitle"] ?? ""} onChangeText={set("marketingTitle")} maxLength={160} />
          <Field label="הערות פנימיות" value={form["internalNotes"] ?? ""} onChangeText={set("internalNotes")} multiline numberOfLines={3} maxLength={4000} style={styles.multiline} />
          <Text variant="label">סטטוס</Text>
          <Chips options={STATUSES} value={status} onChange={setStatus} />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="שמירת השינויים" onPress={() => void save()} busy={busy} style={styles.card} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.md },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
  error: { color: "#b0512c", marginTop: space.md },
});
