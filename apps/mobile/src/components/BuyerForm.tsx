import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import {
  BUYER_SOURCE_LABELS,
  DEAL_TYPE_LABELS,
  FINANCING_LABELS,
  MATURITY_LABELS,
  PROPERTY_TYPE_LABELS,
  type BuyerMaturity,
  type FinancingStatus,
} from "@metavchim/shared";
import type { BuyerDetail } from "@/lib/dtos";
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
import { MultiChips } from "./MultiChips";
import { Text } from "./Text";

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
const DEALS = Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => ({
  key,
  label,
}));
const TYPES = Object.entries(PROPERTY_TYPE_LABELS).map(([key, label]) => ({
  key,
  label,
}));
const FINANCING = (Object.keys(FINANCING_LABELS) as FinancingStatus[]).map(
  (key) => ({ key, label: FINANCING_LABELS[key] }),
);
const MATURITY = (Object.keys(MATURITY_LABELS) as BuyerMaturity[]).map(
  (key) => ({ key, label: MATURITY_LABELS[key] }),
);
/* ‏„סוכן קולי” נכתב רק בידי הסוכן הקולי — לא בחירה של אדם */
const SOURCES = Object.entries(BUYER_SOURCE_LABELS)
  .filter(([key]) => key !== "voice")
  .map(([key, label]) => ({ key, label }));
const ENTRY = [
  { key: "none", label: "לא צוין" },
  { key: "immediate", label: "מיידי" },
  { key: "flexible", label: "גמיש" },
  { key: "by_date", label: "עד תאריך" },
];

const splitList = (text: string): string[] =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function initialForm(b: BuyerDetail | null): Record<string, string> {
  const r = b?.requirements;
  return {
    name: "",
    phone: "",
    email: "",
    source: "phone",
    dealType: r?.dealType ?? "sale",
    cities: (r?.cities ?? []).join(", "),
    neighborhoods: (r?.neighborhoods ?? []).join(", "),
    budgetMin: agorotToShekelsInput(r?.budgetMinAgorot),
    budgetMax: agorotToShekelsInput(r?.budgetMaxAgorot),
    roomsMin: r?.roomsMin === undefined ? "" : String(r.roomsMin),
    roomsMax: r?.roomsMax === undefined ? "" : String(r.roomsMax),
    areaSqmMin: r?.areaSqmMin === undefined ? "" : String(r.areaSqmMin),
    entryType: r?.entryType ?? "none",
    flexibilityNotes: r?.flexibilityNotes ?? "",
    agentNotes: b?.agentNotes ?? "",
  };
}

/**
 * ‏טופס הלקוח — אחד לקליטה ולעריכה, כמו ב-web. בקליטה (`initial === null`)
 * ‏יש גם פרטי הקשר והמקור; הדרישות נשלחות במלואן (הסכימה `strict`),
 * ‏ובעריכה על בסיס מה שיש בכרטיס, כך שאזורי המפה — שאין להם עריכה
 * ‏כאן — נשארים כפי שהם.
 */
export function BuyerForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: BuyerDetail | null;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const styles = useStyles();
  const creating = initial === null;
  const [form, setForm] = useState<Record<string, string>>(() =>
    initialForm(initial),
  );
  const [types, setTypes] = useState<string[]>(
    initial?.requirements.propertyTypes ?? [],
  );
  const [features, setFeatures] = useState<Record<string, Level>>({
    ...(initial?.requirements.features ?? {}),
  });
  const [financing, setFinancing] = useState<FinancingStatus>(
    (initial?.financing as FinancingStatus | undefined) ?? "unknown",
  );
  const [maturity, setMaturity] = useState<BuyerMaturity>(
    (initial?.maturity as BuyerMaturity | undefined) ?? "interested",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: string) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const featureKeys = [
    ...BUILTIN_FEATURES,
    ...Object.keys(features)
      .filter((key) => !BUILTIN_FEATURES.some(([k]) => k === key))
      .map((key): [string, string] => [key, key]),
  ];

  async function save() {
    setError(null);
    const name = (form["name"] ?? "").trim();
    const phone = (form["phone"] ?? "").trim();
    const email = (form["email"] ?? "").trim();
    if (creating) {
      if (name.length < 2) {
        setError("שם — שני תווים לפחות");
        return;
      }
      if (phone.replace(/\D/gu, "").length < 9) {
        setError("טלפון — 9 ספרות לפחות");
        return;
      }
    }
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
      ...(initial?.requirements ?? {}),
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
    for (const key of Object.keys(requirements))
      if (requirements[key] === undefined) delete requirements[key];
    const agentNotes = (form["agentNotes"] ?? "").trim();
    const body: Record<string, unknown> = creating
      ? {
          contactName: name,
          contactPhone: phone,
          ...(email === "" ? {} : { contactEmail: email }),
          source: form["source"] ?? "phone",
          requirements,
          financing,
          maturity,
          ...(agentNotes === "" ? {} : { agentNotes }),
        }
      : {
          requirements,
          financing,
          maturity,
          // ‏ריק נשלח כמחרוזת ריקה — מחיקה מכוונת של הערה קיימת, כמו ב-web
          agentNotes,
        };
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
      {creating ? (
        <Card>
          <Text variant="title">מי</Text>
          <Field
            label="שם"
            value={form["name"] ?? ""}
            onChangeText={set("name")}
            autoFocus
            maxLength={120}
            textContentType="name"
          />
          <Field
            label="טלפון"
            value={form["phone"] ?? ""}
            onChangeText={set("phone")}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            maxLength={25}
          />
          <Field
            label="אימייל (לא חובה)"
            value={form["email"] ?? ""}
            onChangeText={set("email")}
            keyboardType="email-address"
            autoCapitalize="none"
            textContentType="emailAddress"
            maxLength={254}
          />
          <Text variant="label">מאיפה הגיע</Text>
          <Chips
            options={SOURCES}
            value={form["source"] ?? "phone"}
            onChange={set("source")}
          />
        </Card>
      ) : null}

      <Card style={creating ? styles.card : undefined}>
        <Text variant="title">מה מחפשים</Text>
        <Text variant="label">עסקה</Text>
        <Chips
          options={DEALS}
          value={form["dealType"] ?? "sale"}
          onChange={set("dealType")}
        />
        <Field
          label="ערים (מופרדות בפסיק)"
          value={form["cities"] ?? ""}
          onChangeText={set("cities")}
        />
        <Field
          label="שכונות (מופרדות בפסיק)"
          value={form["neighborhoods"] ?? ""}
          onChangeText={set("neighborhoods")}
        />
        <Text variant="label">סוגי נכס</Text>
        <MultiChips options={TYPES} value={types} onChange={setTypes} />
        <View style={styles.row}>
          <Field
            grow
            label="תקציב מ-(₪)"
            value={form["budgetMin"] ?? ""}
            onChangeText={set("budgetMin")}
            keyboardType="number-pad"
          />
          <Field
            grow
            label="עד (₪)"
            value={form["budgetMax"] ?? ""}
            onChangeText={set("budgetMax")}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.row}>
          <Field
            grow
            label="חדרים מ-"
            value={form["roomsMin"] ?? ""}
            onChangeText={set("roomsMin")}
            keyboardType="decimal-pad"
          />
          <Field
            grow
            label="עד"
            value={form["roomsMax"] ?? ""}
            onChangeText={set("roomsMax")}
            keyboardType="decimal-pad"
          />
        </View>
        <Field
          label="שטח מינימלי (מ״ר)"
          value={form["areaSqmMin"] ?? ""}
          onChangeText={set("areaSqmMin")}
          keyboardType="number-pad"
        />
        <Text variant="label">כניסה</Text>
        <Chips
          options={ENTRY}
          value={form["entryType"] ?? "none"}
          onChange={set("entryType")}
        />
      </Card>

      <Card style={styles.card}>
        <Text variant="title">מאפיינים</Text>
        {featureKeys.map(([key, label]) => (
          <View key={key}>
            <Text variant="label">{label}</Text>
            <Chips
              options={LEVELS}
              value={features[key] ?? "none"}
              onChange={(v) => setFeatures((f) => ({ ...f, [key]: v }))}
            />
          </View>
        ))}
        <Field
          label="גמישות והערות לדרישות"
          value={form["flexibilityNotes"] ?? ""}
          onChangeText={set("flexibilityNotes")}
          multiline
          numberOfLines={3}
          maxLength={1000}
          style={styles.multiline}
        />
      </Card>

      <Card style={styles.card}>
        <Text variant="title">הלקוח</Text>
        <Text variant="label">מימון</Text>
        <Chips options={FINANCING} value={financing} onChange={setFinancing} />
        <Text variant="label">בשלות</Text>
        <Chips options={MATURITY} value={maturity} onChange={setMaturity} />
        <Field
          label="הערות הסוכן"
          value={form["agentNotes"] ?? ""}
          onChangeText={set("agentNotes")}
          multiline
          numberOfLines={3}
          maxLength={4000}
          style={styles.multiline}
        />
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
    row: { flexDirection: "row", gap: space.sm },
    multiline: {
      minHeight: 88,
      textAlignVertical: "top",
      paddingTop: space.md,
    },
    error: { color: c.danger, marginTop: space.md },
  };
});
