import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import {
  LEAD_INTENT_LABELS,
  LEAD_SOURCE_LABELS,
  type LeadIntent,
  type LeadSource,
} from "@metavchim/shared";
import { apiPost, errorMessage } from "@/lib/api";
import { Button, Card, Chips, Field, Screen, Text } from "@/components";
import { space } from "@/theme";

/** ‏הכוונות — כולן; „לא ידוע” אחרונה, כי היא ברירת המחדל כשלא נשאל. */
const INTENTS = (Object.keys(LEAD_INTENT_LABELS) as LeadIntent[]).map((key) => ({
  key,
  label: LEAD_INTENT_LABELS[key],
}));

/**
 * ‏המקורות שמתווך בשטח מקליד בעצמו. הערוצים האוטומטיים (וואטסאפ
 * ‏נכנס, טופס באתר, Kanko) נכתבים על ידי המערכת ואינם מוצעים כאן.
 */
const SOURCE_KEYS: LeadSource[] = ["voice_call", "referral", "street_ad", "newspaper", "manual", "other"];
const SOURCES = SOURCE_KEYS.map((key) => ({ key, label: LEAD_SOURCE_LABELS[key] }));

/**
 * ‏ליד חדש — קליטה מהירה: שם, טלפון, מה רוצים, ומאיפה. אותו
 * ‏`POST /leads` כמו ב-web; הטלפון מנורמל ומאומת בשרת
 * ‏(`PhoneInputSchema`), ולכן כאן רק נבדק שאינו ריק.
 */
export default function NewLeadScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [intent, setIntent] = useState<LeadIntent>("buy");
  const [source, setSource] = useState<LeadSource>("voice_call");
  const [sourceNote, setSourceNote] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError("שם — שני תווים לפחות");
      return;
    }
    if (phone.replace(/\D/gu, "").length < 9) {
      setError("טלפון — 9 ספרות לפחות");
      return;
    }
    setBusy(true);
    try {
      const created = await apiPost<{ id: string; merged: boolean }>("/leads", {
        contactName: name.trim(),
        contactPhone: phone.trim(),
        intent,
        source,
        ...(source === "other" && sourceNote.trim() ? { sourceNote: sourceNote.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      });
      // ‏`replace` ולא `push`: חזרה מהכרטיס לא צריכה לחזור לטופס שנשלח
      router.replace(`/leads/${created.id}`);
    } catch (err: unknown) {
      setError(errorMessage(err, "הליד לא נשמר — נסו שוב"));
      setBusy(false);
    }
  }

  return (
    <Screen title="ליד חדש">
      
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Card>
          <Field
            label="שם"
            value={name}
            onChangeText={setName}
            autoFocus
            autoCapitalize="words"
            textContentType="name"
            returnKeyType="next"
          />
          <Field
            label="טלפון"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="done"
          />
          <Text variant="label">מה מחפשים</Text>
          <Chips options={INTENTS} value={intent} onChange={setIntent} />
          <Text variant="label">מאיפה הגיע</Text>
          <Chips options={SOURCES} value={source} onChange={setSource} />
          {source === "other" ? (
            <Field
              label="מקור — פירוט"
              value={sourceNote}
              onChangeText={setSourceNote}
              maxLength={60}
              placeholder="דוכן ביריד הנדל״ן"
            />
          ) : null}
          <Field
            label="מה נאמר בשיחה"
            value={summary}
            onChangeText={setSummary}
            multiline
            numberOfLines={3}
            maxLength={2000}
            style={styles.multiline}
            error={error}
          />
          <Button title="שמירת הליד" onPress={() => void submit()} busy={busy} />
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
});
