import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { LEAD_STATUS_LABELS, leadWaiting, type LeadStatus } from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { LeadDetail, TimelineItem } from "@/lib/dtos";
import { formatWhen } from "@/lib/format";
import { leadIntentLabel, leadSourceLabel, leadStatusLabel, leadStatusTone } from "@/lib/labels";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  Card,
  Chips,
  ContactActions,
  ErrorState,
  Field,
  Loading,
  Pill,
  Screen,
  SectionTitle,
  Text,
} from "@/components";
import { space } from "@/theme";

const STATUS_OPTIONS = (Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((key) => ({
  key,
  label: LEAD_STATUS_LABELS[key],
}));

const KIND_LABELS: Record<string, string> = {
  note: "הערה",
  call: "שיחה",
  whatsapp: "וואטסאפ",
  email: "מייל",
  status: "סטטוס",
  system: "מערכת",
};

/**
 * ‏כרטיס ליד: חיוג ווואטסאפ למעלה, אחר כך הסטטוס, ואז ציר הזמן עם
 * ‏הערה חדשה. אותם נתיבי API כמו הכרטיס ב-web.
 */
export default function LeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const canEdit = can(user, "leads.edit");
  const query = useQuery(
    () => apiGet<{ lead: LeadDetail; timeline: TimelineItem[] }>(`/leads/${id}`),
    [id],
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"status" | "note" | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);

  async function changeStatus(status: LeadStatus) {
    if (query.data?.lead.status === status) return;
    setBusy("status");
    try {
      await apiPatch(`/leads/${id}/status`, { status });
      await query.refresh();
    } catch (err: unknown) {
      Alert.alert("הסטטוס לא עודכן", errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function addNote() {
    const content = note.trim();
    if (content === "") return;
    setBusy("note");
    try {
      await apiPost(`/leads/${id}/notes`, { content });
      setNote("");
      await query.refresh();
    } catch (err: unknown) {
      Alert.alert("ההערה לא נשמרה", errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (query.loading && query.data === null) return <Loading />;
  if (query.data === null) {
    return <ErrorState message={query.error ?? "הליד לא נטען"} onRetry={query.reload} />;
  }

  const { lead, timeline } = query.data;
  const waiting = leadWaiting(lead.createdAt, lead.status, now);

  return (
    <Screen refreshing={query.refreshing} onRefresh={() => void query.refresh()}>
      <Stack.Screen options={{ title: lead.contact.name }} />
      <Card>
        <View style={styles.headRow}>
          <Text variant="heading">{lead.contact.name}</Text>
          <Pill tone={lead.requiresHuman ? "danger" : leadStatusTone(lead.status)}>
            {lead.requiresHuman ? "דורש טיפול" : leadStatusLabel(lead.status)}
          </Pill>
        </View>
        <Text variant="muted">
          {[
            leadIntentLabel(lead.intent),
            leadSourceLabel(lead.source, lead.sourceNote),
            lead.agentName ? `מטפל: ${lead.agentName}` : "לא משויך",
          ].join(" · ")}
        </Text>
        <Text variant="muted">{lead.contact.phone}</Text>
        {waiting ? <Text variant="small">ממתין {waiting.label}</Text> : null}
        {lead.requiresHumanReason ? (
          <Text style={styles.reason}>{lead.requiresHumanReason}</Text>
        ) : null}
        <ContactActions phone={lead.contact.phone} name={lead.contact.name} />
      </Card>

      {lead.summary ? (
        <Card>
          <Text variant="label">סיכום</Text>
          <Text>{lead.summary}</Text>
        </Card>
      ) : null}

      {canEdit ? (
        <>
          <SectionTitle>סטטוס</SectionTitle>
          <Chips
            options={STATUS_OPTIONS}
            value={lead.status as LeadStatus}
            onChange={(status) => void changeStatus(status)}
          />
        </>
      ) : null}

      <SectionTitle count={timeline.length}>ציר הזמן</SectionTitle>
      {canEdit ? (
        <Card>
          <Field
            label="הערה חדשה"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            placeholder="מה סוכם בשיחה?"
            style={styles.noteInput}
          />
          <Button
            title="הוספת הערה"
            kind="secondary"
            busy={busy === "note"}
            disabled={note.trim() === ""}
            onPress={() => void addNote()}
          />
        </Card>
      ) : null}
      {timeline.length === 0 ? (
        <Card>
          <Text variant="muted">עדיין אין פעילות על הליד.</Text>
        </Card>
      ) : null}
      {timeline.map((item) => (
        <Card key={item.id}>
          <View style={styles.headRow}>
            <Text variant="label">{KIND_LABELS[item.kind] ?? item.kind}</Text>
            <Text variant="small">{formatWhen(item.createdAt, now)}</Text>
          </View>
          <Text>{item.content}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  reason: { fontWeight: "600" },
  noteInput: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
});
