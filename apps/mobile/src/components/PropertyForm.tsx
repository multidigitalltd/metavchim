import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import {
  DEAL_TYPE_LABELS,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_FACING_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type PropertyStatus,
} from "@metavchim/shared";
import type { PropertyDetail } from "@/lib/dtos";
import {
  agorotToShekelsInput,
  numberInput,
  shekelsInputToAgorot,
} from "@/lib/format";
import { makeStyles } from "@/lib/theme";
import { space } from "@/theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chips } from "./Chips";
import { Field } from "./Field";
import { Text } from "./Text";

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

type FeatureKey = keyof Pick<
  PropertyDetail,
  "hasElevator" | "hasParking" | "hasBalcony" | "hasSafeRoom" | "hasStorage"
>;
const FEATURES: { key: FeatureKey; label: string }[] = [
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
const TYPES = Object.entries(PROPERTY_TYPE_LABELS).map(([key, label]) => ({
  key,
  label,
}));
const DEALS = Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => ({
  key,
  label,
}));
const CONDITIONS = withNone(PROPERTY_CONDITION_LABELS);
const FACINGS = withNone(PROPERTY_FACING_LABELS);
const STATUSES = (Object.keys(PROPERTY_STATUS_LABELS) as PropertyStatus[]).map(
  (key) => ({
    key,
    label: PROPERTY_STATUS_LABELS[key],
  }),
);
const ENTRY: { key: string; label: string }[] = [
  { key: NONE, label: "לא צוין" },
  { key: "immediate", label: "מיידי" },
  { key: "flexible", label: "גמיש" },
  { key: "on_date", label: "בתאריך" },
  { key: "from_date", label: "מתאריך" },
];

function initialForm(p: PropertyDetail | null): Record<string, string> {
  return {
    city: p?.city ?? "",
    neighborhood: p?.neighborhood ?? "",
    street: p?.street ?? "",
    houseNumber: p?.houseNumber ?? "",
    propertyType: p?.propertyType ?? NONE,
    dealType: p?.dealType ?? "sale",
    rooms: p?.rooms === undefined ? "" : String(p.rooms),
    areaSqm: p?.areaSqm === undefined ? "" : String(p.areaSqm),
    floor: p?.floor === undefined ? "" : String(p.floor),
    totalFloors: p?.totalFloors === undefined ? "" : String(p.totalFloors),
    price: agorotToShekelsInput(p?.priceAgorot),
    condition: p?.condition ?? NONE,
    facing: p?.facing ?? NONE,
    entryType: p?.entryType ?? NONE,
    entryNote: p?.entryNote ?? "",
    marketingTitle: p?.marketingTitle ?? "",
    internalNotes: p?.internalNotes ?? "",
    sharedTabu: p?.sharedTabu ? "yes" : "no",
    ownerName: "",
    ownerPhone: "",
  };
}

/**
 * ‏טופס הנכס — אחד לקליטה ולעריכה, כמו ב-web (אותם שדות ב-`/properties/new`
 * ‏וב-`/properties/:id/edit`). בקליטה (`initial === null`) יש גם בעל
 * ‏הנכס, והריקים פשוט אינם נשלחים; בעריכה מספר בית, מצב וכיוון
 * ‏נשלחים כ-`null` כשרוקנו, כי ריקון בעריכה הוא מחיקה מכוונת.
 * ‏המפה והמאפיינים המותאמים של המשרד נשארים למסך המלא.
 */
export function PropertyForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: PropertyDetail | null;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const styles = useStyles();
  const creating = initial === null;
  const [form, setForm] = useState<Record<string, string>>(() =>
    initialForm(initial),
  );
  const [tri, setTri] = useState<Record<string, Tri>>(() =>
    Object.fromEntries(FEATURES.map((f) => [f.key, triOf(initial?.[f.key])])),
  );
  const [status, setStatus] = useState<PropertyStatus>(
    initial?.status ?? "active",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: string) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setError(null);
    if ((form["city"] ?? "").trim() === "") {
      setError("עיר — חובה");
      return;
    }
    const ownerName = (form["ownerName"] ?? "").trim();
    const ownerPhone = (form["ownerPhone"] ?? "").trim();
    if (creating && (ownerName !== "") !== (ownerPhone !== "")) {
      setError("בעל הנכס — שם וטלפון יחד, או בלי שניהם");
      return;
    }
    setBusy(true);
    const text = (key: string): string | undefined => {
      const v = (form[key] ?? "").trim();
      return v === "" ? undefined : v;
    };
    // ‏בקליטה אין מה למחוק — ריק אינו נשלח; בעריכה ריק הוא `null`
    const cleared = creating ? undefined : null;
    const body: Record<string, unknown> = {
      city: text("city"),
      neighborhood: text("neighborhood") ?? (creating ? undefined : ""),
      street: text("street") ?? (creating ? undefined : ""),
      houseNumber: text("houseNumber") ?? cleared,
      propertyType:
        form["propertyType"] === NONE ? undefined : form["propertyType"],
      dealType: form["dealType"],
      rooms: numberInput(form["rooms"] ?? ""),
      areaSqm: numberInput(form["areaSqm"] ?? ""),
      floor: numberInput(form["floor"] ?? ""),
      totalFloors: numberInput(form["totalFloors"] ?? ""),
      priceAgorot: shekelsInputToAgorot(form["price"] ?? ""),
      condition: form["condition"] === NONE ? cleared : form["condition"],
      facing: form["facing"] === NONE ? cleared : form["facing"],
      entryType: form["entryType"] === NONE ? undefined : form["entryType"],
      entryNote: text("entryNote"),
      marketingTitle: text("marketingTitle"),
      internalNotes: text("internalNotes"),
      sharedTabu: form["sharedTabu"] === "yes",
      status,
      ...Object.fromEntries(
        FEATURES.map((f) => [f.key, boolOf(tri[f.key] ?? "unknown")]),
      ),
      ...(creating && ownerName !== "" ? { ownerName, ownerPhone } : {}),
    };
    for (const key of Object.keys(body))
      if (body[key] === undefined) delete body[key];
    try {
      await onSubmit(body);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה — נסו שוב");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Card>
        <Text variant="title">כתובת</Text>
        <Field
          label="עיר"
          value={form["city"] ?? ""}
          onChangeText={set("city")}
          autoFocus={creating}
        />
        <Field
          label="שכונה"
          value={form["neighborhood"] ?? ""}
          onChangeText={set("neighborhood")}
        />
        <Field
          label="רחוב"
          value={form["street"] ?? ""}
          onChangeText={set("street")}
        />
        <Field
          label="מספר בית"
          value={form["houseNumber"] ?? ""}
          onChangeText={set("houseNumber")}
          maxLength={10}
        />
      </Card>

      <Card style={styles.card}>
        <Text variant="title">הנכס</Text>
        <Text variant="label">סוג</Text>
        <Chips
          options={[{ key: NONE, label: "לא צוין" }, ...TYPES]}
          value={form["propertyType"] ?? NONE}
          onChange={set("propertyType")}
        />
        <Text variant="label">עסקה</Text>
        <Chips
          options={DEALS}
          value={form["dealType"] ?? "sale"}
          onChange={set("dealType")}
        />
        <Field
          label="חדרים"
          value={form["rooms"] ?? ""}
          onChangeText={set("rooms")}
          keyboardType="decimal-pad"
          placeholder="3.5"
        />
        <Field
          label="שטח (מ״ר)"
          value={form["areaSqm"] ?? ""}
          onChangeText={set("areaSqm")}
          keyboardType="number-pad"
        />
        <Field
          label="קומה"
          value={form["floor"] ?? ""}
          onChangeText={set("floor")}
          keyboardType="numbers-and-punctuation"
        />
        <Field
          label="קומות בבניין"
          value={form["totalFloors"] ?? ""}
          onChangeText={set("totalFloors")}
          keyboardType="number-pad"
        />
        <Field
          label="מחיר (₪)"
          value={form["price"] ?? ""}
          onChangeText={set("price")}
          keyboardType="number-pad"
        />
        <Text variant="label">מצב</Text>
        <Chips
          options={CONDITIONS}
          value={form["condition"] ?? NONE}
          onChange={set("condition")}
        />
        <Text variant="label">כיוון</Text>
        <Chips
          options={FACINGS}
          value={form["facing"] ?? NONE}
          onChange={set("facing")}
        />
      </Card>

      <Card style={styles.card}>
        <Text variant="title">מאפיינים</Text>
        {FEATURES.map((f) => (
          <Text key={f.key} variant="label">
            {f.label}
            {"\n"}
            <Chips
              options={TRI}
              value={tri[f.key] ?? "unknown"}
              onChange={(v) => setTri((t) => ({ ...t, [f.key]: v }))}
            />
          </Text>
        ))}
        <Text variant="label">טאבו משותף</Text>
        <Chips
          options={[
            { key: "no", label: "לא" },
            { key: "yes", label: "כן" },
          ]}
          value={form["sharedTabu"] ?? "no"}
          onChange={set("sharedTabu")}
        />
      </Card>

      {creating ? (
        <Card style={styles.card}>
          <Text variant="title">בעל הנכס</Text>
          <Text variant="muted">לא חובה עכשיו — אפשר להוסיף מהכרטיס.</Text>
          <Field
            label="שם"
            value={form["ownerName"] ?? ""}
            onChangeText={set("ownerName")}
            maxLength={120}
          />
          <Field
            label="טלפון"
            value={form["ownerPhone"] ?? ""}
            onChangeText={set("ownerPhone")}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            maxLength={25}
          />
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text variant="title">כניסה ושיווק</Text>
        <Text variant="label">מועד כניסה</Text>
        <Chips
          options={ENTRY}
          value={form["entryType"] ?? NONE}
          onChange={set("entryType")}
        />
        <Field
          label="הערת כניסה"
          value={form["entryNote"] ?? ""}
          onChangeText={set("entryNote")}
          maxLength={160}
          placeholder="אחרי הפסח / גמיש ±חודש"
        />
        <Field
          label="כותרת שיווקית"
          value={form["marketingTitle"] ?? ""}
          onChangeText={set("marketingTitle")}
          maxLength={160}
        />
        <Field
          label="הערות פנימיות"
          value={form["internalNotes"] ?? ""}
          onChangeText={set("internalNotes")}
          multiline
          numberOfLines={3}
          maxLength={4000}
          style={styles.multiline}
        />
        <Text variant="label">סטטוס</Text>
        <Chips options={STATUSES} value={status} onChange={setStatus} />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        title={submitLabel}
        onPress={() => void save()}
        busy={busy}
        style={styles.card}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    card: { marginTop: space.md },
    multiline: {
      minHeight: 88,
      textAlignVertical: "top",
      paddingTop: space.md,
    },
    error: { color: c.danger, marginTop: space.md },
  };
});
