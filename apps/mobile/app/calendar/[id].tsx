import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  JERUSALEM_TZ,
  VIEWING_CONDITION_FEEDBACK,
  VIEWING_CONDITION_LABELS,
  VIEWING_FIT_FEEDBACK,
  VIEWING_FIT_LABELS,
  VIEWING_PRICE_FEEDBACK,
  VIEWING_PRICE_LABELS,
  formatJerusalemTime,
  hebrewDateFull,
  jerusalemWallErrorMessage,
  jerusalemWallParts,
  resolveJerusalemWall,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { AppointmentRow } from "@/lib/dtos";
import { useShell } from "@/lib/shell";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  CacheNotice,
  Card,
  Chips,
  DURATIONS,
  ErrorState,
  Field,
  Loading,
  Pill,
  Row,
  Screen,
  SectionTitle,
  Text,
  WhenPicker,
} from "@/components";
import { space } from "@/theme";

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};
const KIND_TONE: Record<string, "success" | "amber" | "neutral"> = {
  meeting: "success",
  viewing: "amber",
  call: "neutral",
};
const STATUS_LABELS: Record<string, string> = {
  scheduled: "מתוכננת",
  completed: "התקיימה",
  cancelled: "בוטלה",
  no_show: "לא הגיע",
};
const STATUS_TONE: Record<string, "primary" | "success" | "danger" | "amber"> =
  {
    scheduled: "primary",
    completed: "success",
    cancelled: "danger",
    no_show: "amber",
  };

const OUTCOMES: readonly { key: string; label: string }[] = [
  { key: "liked", label: "אהב את הנכס" },
  { key: "not_fit", label: "לא מתאים" },
  { key: "negotiating", label: 'עוברים למו"מ' },
  { key: "needs_other", label: "צריך נכס אחר" },
];
const PRICE = VIEWING_PRICE_FEEDBACK.map((key) => ({
  key,
  label: VIEWING_PRICE_LABELS[key],
}));
const CONDITION = VIEWING_CONDITION_FEEDBACK.map((key) => ({
  key,
  label: VIEWING_CONDITION_LABELS[key],
}));
const FIT = VIEWING_FIT_FEEDBACK.map((key) => ({
  key,
  label: VIEWING_FIT_LABELS[key],
}));

const DAY_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

type Panel = "none" | "document" | "reschedule";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ‏מסך הפגישה — מה שהיומן ב-web עושה בשורה: תיעוד התוצאה (לסיור גם
 * ‏המשוב למוכר בשלוש הקשות), דחייה למועד חדש (שומרת את מונה הדחיות
 * ‏ואת הקישורים), ביטול, וקפיצה לליד / לקונה / לנכס. העלאת הקלטה
 * ‏ועריכת הכותרת נשארות במסך העריכה של המערכת.
 */
export default function AppointmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { hasFeature } = useShell();
  const canManage = can(user, "calendar.manage");
  const query = useQuery(
    () => apiGet<AppointmentRow>(`/appointments/${id}`),
    [id],
    { cacheKey: `appointment:${id}` },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ‏תיעוד
  const [outcome, setOutcome] = useState<string | null>(null);
  const [price, setPrice] = useState<string | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [fit, setFit] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  // ‏דחייה — ברירת מחדל: אותה שעה, שבוע קדימה
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [reason, setReason] = useState("");

  if (query.loading && query.data === null) return <Loading />;
  if (query.data === null)
    return (
      <ErrorState
        message={query.error ?? "הפגישה לא נטענה"}
        onRetry={query.reload}
      />
    );

  const a = query.data;
  const start = new Date(a.startsAt);
  const upcoming = a.status === "scheduled" && start >= now;
  const pendingOutcome =
    a.status === "scheduled" && start < now && a.outcome === undefined;
  const title = a.title ?? KIND_LABELS[a.kind] ?? a.kind;
  const when = `${DAY_FMT.format(start)} · ${formatJerusalemTime(start)}${a.endsAt ? `–${formatJerusalemTime(new Date(a.endsAt))}` : ""}`;
  const hebrew = hebrewDateFull(start);

  function openReschedule() {
    /*
     * ‏ברירת מחדל: אותה שעה, שבוע קדימה — ואם גם זה כבר עבר (סיור
     * ‏שממתין לתיעוד מזה שבועיים), מחר באותה שעה. הצעה שבעבר הייתה
     * ‏מחזירה פגישה ל„מתוכננת” ברגע שחלף (ביקורת Codex).
     */
    const week = start.getTime() + 7 * DAY_MS;
    const tomorrow = Date.now() + DAY_MS;
    const suggested = jerusalemWallParts(new Date(Math.max(week, tomorrow)));
    setDate(suggested.date);
    setTime(suggested.time);
    if (a.endsAt)
      setDuration(
        String(
          Math.max(
            15,
            Math.round(
              (new Date(a.endsAt).getTime() - start.getTime()) / 60_000,
            ),
          ),
        ),
      );
    setError(null);
    setPanel("reschedule");
  }

  async function submitDocument() {
    setBusy(true);
    setError(null);
    try {
      // ‏`outcome` כבר מסמן `completed` בשרת — נשלח לבדו כשנבחר
      await apiPatch(`/appointments/${a.id}`, {
        ...(outcome !== null ? { outcome } : { status: "completed" }),
        ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
        ...(price !== null ? { feedbackPrice: price } : {}),
        ...(condition !== null ? { feedbackCondition: condition } : {}),
        ...(fit !== null ? { feedbackFit: fit } : {}),
      });
      setPanel("none");
      await query.refresh();
    } catch (err: unknown) {
      setError(errorMessage(err, "שמירת התיעוד נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  async function submitReschedule() {
    setError(null);
    const resolved = resolveJerusalemWall(date, time, null);
    if (!resolved.ok) {
      setError(jerusalemWallErrorMessage(resolved.reason));
      return;
    }
    if (resolved.at.getTime() < Date.now()) {
      setError("המועד החדש כבר עבר — בחרו יום ושעה קדימה.");
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/appointments/${a.id}/reschedule`, {
        startsAt: resolved.at.toISOString(),
        durationMinutes: Number(duration),
        ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
      });
      setPanel("none");
      await query.refresh();
    } catch (err: unknown) {
      setError(errorMessage(err, "הדחייה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel() {
    Alert.alert("לבטל את הפגישה?", title, [
      { text: "לא", style: "cancel" },
      {
        text: "ביטול הפגישה",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          apiPatch(`/appointments/${a.id}`, { status: "cancelled" })
            .then(() => query.refresh())
            .catch((err: unknown) =>
              Alert.alert("הפגישה לא בוטלה", errorMessage(err)),
            )
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <Screen
      title={title}
      refreshing={query.refreshing}
      onRefresh={() => void query.refresh()}
    >
      <CacheNotice query={query} />
      <Card>
        <View style={styles.headRow}>
          <Pill tone={KIND_TONE[a.kind] ?? "neutral"}>
            {KIND_LABELS[a.kind] ?? a.kind}
          </Pill>
          <Pill tone={STATUS_TONE[a.status] ?? "primary"}>
            {STATUS_LABELS[a.status] ?? a.status}
          </Pill>
        </View>
        <Text variant="title">{when}</Text>
        {hebrew ? <Text variant="muted">{hebrew}</Text> : null}
        {a.outcome ? (
          <Text>
            תוצאה:{" "}
            {OUTCOMES.find((o) => o.key === a.outcome)?.label ?? a.outcome}
          </Text>
        ) : null}
        {a.notes ? <Text variant="muted">{a.notes}</Text> : null}
        {pendingOutcome ? (
          <Text variant="small">הסיור התקיים — התוצאה עוד לא תועדה.</Text>
        ) : null}
      </Card>

      {a.leadId ? (
        <Row
          title="הליד"
          chevron
          onPress={() => router.push(`/leads/${a.leadId}`)}
        />
      ) : null}
      {a.buyerId ? (
        <Row
          title="הלקוח"
          chevron
          onPress={() => router.push(`/buyers/${a.buyerId}`)}
        />
      ) : null}
      {a.propertyId ? (
        <Row
          title="הנכס"
          chevron
          onPress={() => router.push(`/properties/${a.propertyId}`)}
        />
      ) : null}

      {canManage && a.status === "scheduled" && panel === "none" ? (
        <View style={styles.actions}>
          <Button
            title={pendingOutcome ? "תיעוד התוצאה" : "התקיימה"}
            kind="primary"
            onPress={() => setPanel("document")}
          />
          <Button
            title="דחייה למועד אחר"
            kind="secondary"
            onPress={openReschedule}
          />
          {upcoming ? (
            <Button
              title="ביטול הפגישה"
              kind="danger"
              busy={busy}
              onPress={confirmCancel}
            />
          ) : null}
        </View>
      ) : null}

      {panel === "document" ? (
        <>
          <SectionTitle>תיעוד</SectionTitle>
          <Card>
            {a.kind === "viewing" ? (
              <>
                <Text variant="label">תוצאת הסיור</Text>
                <Chips
                  options={OUTCOMES}
                  value={outcome}
                  onChange={(k) => setOutcome(outcome === k ? null : k)}
                />
                <Text variant="label">
                  מה אמר הקונה — נספר בדוח למוכר, בלי שמות
                </Text>
                <Chips
                  options={PRICE}
                  value={price}
                  onChange={(k) => setPrice(price === k ? null : k)}
                />
                <Chips
                  options={CONDITION}
                  value={condition}
                  onChange={(k) => setCondition(condition === k ? null : k)}
                />
                <Chips
                  options={FIT}
                  value={fit}
                  onChange={(k) => setFit(fit === k ? null : k)}
                />
              </>
            ) : null}
            <Field
              label="סיכום"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              maxLength={2000}
              placeholder="מה סוכם? מה השלב הבא?"
              style={styles.multiline}
              error={error}
            />
            <Button
              title="שמירת התיעוד"
              busy={busy}
              onPress={() => void submitDocument()}
            />
            {hasFeature("transcription") ? (
              <Button
                title="העלאת הקלטה של הפגישה (במערכת)"
                kind="text"
                onPress={() => router.push(`/web/calendar/${a.id}/edit`)}
              />
            ) : null}
            <Button
              title="ביטול"
              kind="ghost"
              onPress={() => setPanel("none")}
            />
          </Card>
        </>
      ) : null}

      {panel === "reschedule" ? (
        <>
          <SectionTitle>דחייה למועד חדש</SectionTitle>
          <Card>
            <WhenPicker
              date={date}
              time={time}
              onDate={setDate}
              onTime={setTime}
              now={now}
            />
            <Text variant="label">משך</Text>
            <Chips
              options={DURATIONS}
              value={duration}
              onChange={setDuration}
            />
            <Field
              label="סיבה (לא חובה)"
              value={reason}
              onChangeText={setReason}
              maxLength={300}
              placeholder="למשל: הלקוח ביקש לדחות"
              error={error}
            />
            <Button
              title="דחייה למועד הזה"
              busy={busy}
              onPress={() => void submitReschedule()}
            />
            <Button
              title="ביטול"
              kind="ghost"
              onPress={() => setPanel("none")}
            />
          </Card>
        </>
      ) : null}

      {canManage ? (
        <Button
          title="עריכת הפגישה במערכת"
          kind="text"
          onPress={() => router.push(`/web/calendar/${a.id}/edit`)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  actions: { gap: space.sm },
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
});
