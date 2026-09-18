import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  JERUSALEM_TZ,
  jerusalemWallErrorMessage,
  jerusalemWallParts,
  resolveJerusalemWall,
} from "@metavchim/shared";
import { apiPost, errorMessage } from "@/lib/api";
import { openWhatsapp } from "@/lib/contact-actions";
import {
  recentPeople,
  recentProperties,
  searchPeople,
  searchProperties,
  type PickedPerson,
} from "@/lib/link-search";
import {
  Button,
  Card,
  Chips,
  DURATIONS,
  Field,
  LinkPicker,
  Screen,
  Text,
  WhenPicker,
  type PickOption,
} from "@/components";
import { space } from "@/theme";

type Kind = "viewing" | "meeting" | "call";

const KINDS: readonly { key: Kind; label: string }[] = [
  { key: "viewing", label: "סיור בנכס" },
  { key: "meeting", label: "פגישה" },
  { key: "call", label: "שיחה" },
];
const KIND_LABELS: Record<Kind, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

function isKind(value: unknown): value is Kind {
  return value === "viewing" || value === "meeting" || value === "call";
}

const WHEN_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ,
  dateStyle: "full",
  timeStyle: "short",
});

/**
 * ‏פגישה חדשה — כמו `/calendar/new` ב-web, בלי בורר תאריכים: סוג, יום
 * ‏ושעה בשעון ישראל (`WhenPicker`), משך, כותרת והערות. שני צדי הפגישה
 * ‏— מי ואיפה — נבחרים כאן (`LinkPicker`, אותם מקורות כמו ב-web); הצד
 * ‏שממנו הגיעו (`?leadId=` / `?buyerId=` / `?propertyId=`, ולתצוגה
 * ‏`label`, `phone`, `where`) כבר מסומן, וניתן להחלפה.
 *
 * ‏אחרי הקביעה, כשיש טלפון של הלקוח: הודעת וואטסאפ מנוסחת ומוכנה —
 * ‏המתווך רק לוחץ שליחה. לעולם לא אוטומטית (docs/README, עיקרון 8).
 */
export default function NewAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    kind?: string;
    leadId?: string;
    buyerId?: string;
    propertyId?: string;
    label?: string;
    phone?: string;
    where?: string;
  }>();
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v !== "" ? v : undefined;
  const leadId = one(params.leadId);
  const buyerId = one(params.buyerId);
  const propertyId = one(params.propertyId);
  const label = one(params.label);
  const phone = one(params.phone);
  const where = one(params.where);

  const now = useMemo(() => new Date(), []);
  const [kind, setKind] = useState<Kind>(
    isKind(params.kind) ? params.kind : propertyId ? "viewing" : "meeting",
  );
  const [person, setPerson] = useState<PickedPerson | null>(() =>
    leadId
      ? { kind: "lead", id: leadId, label: label ?? "הליד שנבחר", phone }
      : buyerId
        ? { kind: "buyer", id: buyerId, label: label ?? "הלקוח שנבחר", phone }
        : null,
  );
  const [property, setProperty] = useState<PickOption | null>(() =>
    propertyId ? { id: propertyId, label: where ?? "הנכס שנבחר" } : null,
  );
  const [date, setDate] = useState(jerusalemWallParts(now).date);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const resolved = resolveJerusalemWall(date, time, null);
    if (!resolved.ok) {
      setError(jerusalemWallErrorMessage(resolved.reason));
      return;
    }
    // ‏מול הרגע של הלחיצה, לא של פתיחת המסך (ביקורת Codex)
    if (resolved.at.getTime() < Date.now()) {
      setError("המועד כבר עבר — בחרו יום ושעה קדימה.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/appointments", {
        kind,
        ...(title.trim() ? { title: title.trim() } : {}),
        startsAt: resolved.at.toISOString(),
        durationMinutes: Number(duration),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(person?.kind === "lead" ? { leadId: person.id } : {}),
        ...(person?.kind === "buyer" ? { buyerId: person.id } : {}),
        ...(property ? { propertyId: property.id } : {}),
      });
      if (person?.phone) {
        const { phone: to, label: name } = person;
        const message = `שלום ${name}, קבענו ${KIND_LABELS[kind]}${property ? ` ב${property.label}` : ""} ל${WHEN_FMT.format(resolved.at)}. נתראה!`;
        Alert.alert(
          "הפגישה נקבעה",
          "לעדכן את הלקוח? ההודעה כבר מנוסחת — נשאר רק ללחוץ שליחה בוואטסאפ.",
          [
            {
              text: "לא עכשיו",
              style: "cancel",
              onPress: () => router.replace("/calendar"),
            },
            {
              text: "וואטסאפ",
              onPress: () => {
                void openWhatsapp(to, message);
                router.replace("/calendar");
              },
            },
          ],
        );
        return;
      }
      router.replace("/calendar");
    } catch (err: unknown) {
      setError(errorMessage(err, "קביעת הפגישה נכשלה — נסו שוב"));
      setBusy(false);
    }
  }

  return (
    <Screen title="פגישה חדשה">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Card>
          <Text variant="label">סוג</Text>
          <Chips options={KINDS} value={kind} onChange={setKind} />
          <LinkPicker
            label="עם מי"
            placeholder="שם הלקוח או הליד"
            chosen={person}
            onPick={(option) => setPerson(option as PickedPerson)}
            onClear={() => setPerson(null)}
            search={searchPeople}
            recent={recentPeople}
          />
          <LinkPicker
            label="איפה"
            placeholder="כתובת הנכס"
            chosen={property}
            onPick={setProperty}
            onClear={() => setProperty(null)}
            search={searchProperties}
            recent={recentProperties}
          />
          <WhenPicker
            date={date}
            time={time}
            onDate={setDate}
            onTime={setTime}
            now={now}
          />
          <Text variant="label">משך</Text>
          <Chips options={DURATIONS} value={duration} onChange={setDuration} />
          <Field
            label="כותרת (לא חובה)"
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            placeholder="למשל: סיור שני עם ההורים"
          />
          <Field
            label="הערות"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            maxLength={2000}
            style={styles.multiline}
            error={error}
          />
          <Button
            title="קביעת הפגישה"
            onPress={() => void submit()}
            busy={busy}
          />
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
});
