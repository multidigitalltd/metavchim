import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { agentResultRefs, agentTurnRefs, type AgentHistoryRef } from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import type { ExecuteResult, Proposal } from "@/lib/agent";
import { colors, space } from "@/theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chips } from "./Chips";
import { Pill } from "./Pill";
import { Text } from "./Text";

/** מה נדרש כדי לאשר, לפי כמה הפעולה יקרה אם היא שגויה. */
const CONFIRM_LABEL: Record<Proposal["risk"], string> = {
  read: "הצג תשובה",
  create: "צור",
  update: "עדכן",
  outbound: "המשך לשליחה",
};

const CANDIDATE_REASON: Record<"unsaid" | "not_found", string> = {
  unsaid: "לא נאמר על מי מדובר — אפשר לנסח שוב עם שם.",
  not_found: "לא נמצאה התאמה במאגר — אפשר לנסח שוב.",
};

/**
 * ‏כרטיס ההצעה — מה שהמתווך רואה ומאשר. אותו מבנה כמו ב-web:
 * ‏כותרת, שורות שדה, חוסרים, אזהרות, מועמדים לבחירה, וצעדי המשך
 * ‏שמאושרים יחד. הביצוע: הראשי, ואחריו צעדי ההמשך לפי הסדר; כישלון
 * ‏באמצע מדווח במקום להיראות כאילו הכול הצליח.
 */
export function ProposalCard({
  proposal,
  transcript,
  onDone,
  onCancel,
}: {
  proposal: Proposal;
  transcript: string;
  onDone: (result: ExecuteResult, params: Record<string, unknown>, refs: AgentHistoryRef[]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidateChips = useMemo(
    () =>
      (proposal.candidates?.options ?? []).map((option) => ({
        key: option.id,
        label: option.detail ? `${option.label} · ${option.detail}` : option.label,
      })),
    [proposal.candidates],
  );
  const needsChoice = proposal.candidates !== undefined;
  const blocked = needsChoice && (chosen === null || candidateChips.length === 0);

  function params(): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const field of proposal.fields) merged[field.key] = field.value;
    if (chosen !== null && proposal.candidates !== undefined) {
      // השרת אומר תחת איזה מפתח נשלחת הבחירה — לא ניחוש לפי הפעולה
      merged[proposal.candidates.idKey] = chosen;
    }
    return merged;
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const sent = params();
      const primary = await apiPost<ExecuteResult>("/agent/execute", {
        action: proposal.actionId,
        params: sent,
        ...(transcript.trim() !== "" ? { transcript: transcript.trim() } : {}),
      });
      const followUps = proposal.followUps ?? [];
      const shown = agentResultRefs(primary.data);
      if (followUps.length === 0) {
        onDone(primary, sent, agentTurnRefs([primary.ref], shown));
        return;
      }
      const messages = [primary.message];
      let link: string | undefined = primary.link;
      const acted: (AgentHistoryRef | undefined)[] = [primary.ref];
      let failure: string | null = null;
      for (const step of followUps) {
        try {
          const stepParams: Record<string, unknown> = {};
          for (const field of step.fields) stepParams[field.key] = field.value;
          const done = await apiPost<ExecuteResult>("/agent/execute", {
            action: step.actionId,
            params: stepParams,
          });
          messages.push(done.message);
          link ??= done.link;
          acted.unshift(done.ref);
        } catch (err: unknown) {
          failure = `„${step.title}” לא בוצע: ${err instanceof ApiError ? err.message : "שגיאה"}`;
          break;
        }
      }
      onDone(
        {
          message: failure === null ? messages.join(" · ") : `${messages.join(" · ")} · ${failure}`,
          ...(failure === null && primary.href !== undefined ? { href: primary.href } : {}),
          ...(link === undefined ? {} : { link }),
        },
        sent,
        agentTurnRefs(acted, shown),
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text variant="title" style={styles.grow}>
          {proposal.title}
        </Text>
        {proposal.fallback ? <Pill tone="amber">כללים</Pill> : null}
      </View>
      <Text variant="muted">{proposal.summary}</Text>

      {proposal.fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text variant="label">{field.label}</Text>
          <Text>{field.display}</Text>
          {field.evidence ? <Text variant="small">„{field.evidence}”</Text> : null}
        </View>
      ))}

      {proposal.missing.length > 0 ? (
        <Text variant="small">
          אפשר להשלים אחר כך: {proposal.missing.map((m) => m.label).join(", ")}
        </Text>
      ) : null}
      {proposal.warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>
          {warning}
        </Text>
      ))}

      {proposal.candidates ? (
        <View style={styles.field}>
          <Text variant="label">{proposal.candidates.label}</Text>
          {candidateChips.length > 0 ? (
            <Chips options={candidateChips} value={chosen ?? ""} onChange={setChosen} />
          ) : (
            <Text variant="muted">
              {CANDIDATE_REASON[proposal.candidates.reason ?? "not_found"]}
            </Text>
          )}
        </View>
      ) : null}

      {proposal.clarify ? <Text style={styles.warning}>{proposal.clarify}</Text> : null}

      {proposal.followUps && proposal.followUps.length > 0 ? (
        <View style={styles.field}>
          <Text variant="label">ואחר כך</Text>
          {proposal.followUps.map((step, i) => (
            <Text key={`${step.actionId}-${i}`}>• {step.title}</Text>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button
          title={
            proposal.followUps && proposal.followUps.length > 0
              ? `אשר את הכול (${proposal.followUps.length + 1})`
              : CONFIRM_LABEL[proposal.risk]
          }
          onPress={() => void confirm()}
          busy={busy}
          disabled={blocked}
          style={styles.grow}
        />
        <Button title="ביטול" kind="ghost" onPress={onCancel} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: colors.primaryAccent },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  grow: { flex: 1 },
  field: { gap: 2 },
  warning: { color: colors.warning },
  error: { color: colors.danger },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
});
