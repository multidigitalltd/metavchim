import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  agentHistorySummary,
  agentResultText,
  proposalRunsImmediately,
  type AgentHistoryRef,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError, errorMessage } from "@/lib/api";
import type {
  AgentHelp,
  ExecuteResult,
  HistoryTurn,
  Proposal,
} from "@/lib/agent";
import { routeForPushUrl } from "@/lib/push";
import {
  ensureMicrophone,
  startRecording,
  stopRecording,
  transcribeRecording,
  useVoiceRecorder,
} from "@/lib/recorder";
import {
  Button,
  Card,
  Chips,
  Field,
  ProposalCard,
  Text,
  TopBar,
} from "@/components";
import { radius, space, TOUCH } from "@/theme";
import { makeStyles } from "@/lib/theme";

type Suggestion = { actionId: string; title: string; example: string };

type ChatItem =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "agent"; kind: "reply"; text: string }
  | {
      id: number;
      role: "agent";
      kind: "note";
      tone: "info" | "danger";
      text: string;
      suggestions?: Suggestion[];
      said?: string;
    }
  | {
      id: number;
      role: "agent";
      kind: "proposal";
      proposal: Proposal;
      transcript: string;
      settled?: "done" | "cancelled";
    }
  | {
      id: number;
      role: "agent";
      kind: "result";
      result: ExecuteResult;
      lines: string | null;
    };

type Phase = "idle" | "recording" | "transcribing" | "thinking";

/** ‏`Omit` על איחוד מאבד את הענפים; זה מפזר אותו — פריט בלי המזהה. */
type Draft<T> = T extends unknown ? Omit<T, "id"> : never;
type ChatDraft = Draft<ChatItem>;

/**
 * ‏„קול” — הסוכן האישי מהטלפון: אומרים (או מקלידים) משפט, השרת מציע
 * ‏פעולה, המתווך מאשר. אותם שלושה נתיבים כמו במסך ה-web
 * ‏(`/voice-intakes/transcribe`, `/agent/interpret`, `/agent/execute`),
 * ‏ואותם כללים: שאילתה רצה מיד, פעולה שכותבת נעצרת על אישור, וכל
 * ‏מה שיוצא ללקוח נפתח באפליקציה של המכשיר ולא נשלח מכאן.
 */
export default function VoiceScreen() {
  const styles = useStyles();
  const router = useRouter();
  const recorder = useVoiceRecorder();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [help, setHelp] = useState<AgentHelp | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const history = useRef<HistoryTurn[]>([]);
  const nextId = useRef(1);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    apiGet<AgentHelp>("/agent/help")
      .then(setHelp)
      .catch((err: unknown) => {
        // ‏403 — הסוכן אינו כלול במסלול של המשרד; 404 — השרת ישן
        setUnavailable(
          err instanceof ApiError && (err.status === 403 || err.status === 404)
            ? "הסוכן האישי אינו כלול במסלול של המשרד."
            : errorMessage(err, "הסוכן אינו זמין כרגע"),
        );
      });
  }, []);

  const push = useCallback((item: ChatDraft) => {
    const id = nextId.current++;
    setItems((current) => [...current, { ...item, id } as ChatItem]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return id;
  }, []);

  const settleProposal = useCallback(
    (id: number, settled: "done" | "cancelled") => {
      setItems((current) =>
        current.map((item) =>
          item.id === id && item.role === "agent" && item.kind === "proposal"
            ? { ...item, settled }
            : item,
        ),
      );
    },
    [],
  );

  /** ‏תוצאה של פעולה: הודעה, שורות, וזיכרון השיחה — כמו ב-web. */
  const settle = useCallback(
    (
      transcript: string,
      action: string,
      result: ExecuteResult,
      params: Record<string, unknown>,
      refs: AgentHistoryRef[],
    ) => {
      push({
        role: "agent",
        kind: "result",
        result,
        lines: agentResultText(result.data),
      });
      const turn: HistoryTurn = {
        transcript,
        action,
        params,
        resultSummary: agentHistorySummary(result.message, result.data),
        ...(refs.length > 0 ? { refs } : {}),
      };
      history.current = [...history.current, turn].slice(-6);
      // השיחה נשמרת גם בשרת — כדי שתימשך בוואטסאפ ובמחשב. בלי המתנה.
      void apiPost("/agent/conversation/turn", turn).catch(() => undefined);
    },
    [push],
  );

  const send = useCallback(
    async (said: string, pin?: string) => {
      const transcript = said.trim();
      if (transcript.length < 2 || phase === "thinking") return;
      if (pin === undefined) push({ role: "user", text: transcript });
      setPhase("thinking");
      try {
        const proposal = await apiPost<Proposal>("/agent/interpret", {
          transcript,
          ...(pin === undefined ? {} : { pin }),
          ...(history.current.length > 0 ? { history: history.current } : {}),
        });
        if (proposal.actionId === "unknown" && proposal.reply) {
          push({ role: "agent", kind: "reply", text: proposal.reply });
          return;
        }
        if (proposal.actionId === "unknown") {
          const suggestions = proposal.suggestions ?? [];
          push({
            role: "agent",
            kind: "note",
            tone: "info",
            ...(suggestions.length > 0
              ? { suggestions, said: transcript }
              : {}),
            text: [
              ...(proposal.degraded.length > 0
                ? proposal.degraded
                : [
                    proposal.clarify ??
                      (suggestions.length > 0
                        ? "לא הייתי בטוחה מה לעשות."
                        : "לא הצלחתי לזהות מה לעשות — אפשר לנסח אחרת."),
                    ...(suggestions.length > 0 ? ["אולי התכוונתם ל:"] : []),
                  ]),
              ...proposal.warnings,
            ].join("\n"),
          });
          return;
        }
        if (proposalRunsImmediately(proposal)) {
          const params = Object.fromEntries(
            proposal.fields.map((f) => [f.key, f.value]),
          );
          const executed = await apiPost<ExecuteResult>("/agent/execute", {
            action: proposal.actionId,
            params,
            transcript,
          });
          settle(
            transcript,
            proposal.actionId,
            executed,
            params,
            executed.ref ? [executed.ref] : [],
          );
          return;
        }
        push({ role: "agent", kind: "proposal", proposal, transcript });
      } catch (err: unknown) {
        push({
          role: "agent",
          kind: "note",
          tone: "danger",
          text: errorMessage(err, "לא הצלחתי לנתח את הבקשה"),
        });
      } finally {
        setPhase("idle");
      }
    },
    [phase, push, settle],
  );

  async function toggleRecording() {
    if (phase === "recording") {
      setPhase("transcribing");
      try {
        const uri = await stopRecording(recorder);
        if (uri === null) throw new Error("no recording");
        const transcript = await transcribeRecording(uri);
        if (transcript.trim() === "") {
          push({
            role: "agent",
            kind: "note",
            tone: "info",
            text: "לא שמעתי כלום — נסו שוב קרוב יותר למיקרופון.",
          });
          setPhase("idle");
          return;
        }
        setPhase("idle");
        await send(transcript);
      } catch (err: unknown) {
        setPhase("idle");
        push({
          role: "agent",
          kind: "note",
          tone: "danger",
          text: errorMessage(err, "ההקלטה לא תומללה — נסו שוב"),
        });
      }
      return;
    }
    if (phase !== "idle") return;
    if (!(await ensureMicrophone())) {
      Alert.alert(
        "אין הרשאת מיקרופון",
        "אפשר לאפשר אותה בהגדרות המכשיר, או להקליד למטה.",
      );
      return;
    }
    try {
      await startRecording(recorder);
      setPhase("recording");
    } catch {
      Alert.alert("ההקלטה לא התחילה", "נסו שוב, או הקלידו למטה.");
    }
  }

  function submitText() {
    const value = text;
    setText("");
    void send(value);
  }

  function openHref(href: string) {
    router.push(routeForPushUrl(href));
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <TopBar title="הסוכן הקולי" root />

      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
      >
        {unavailable ? (
          <Card>
            <Text style={styles.danger}>{unavailable}</Text>
          </Card>
        ) : null}
        {items.length === 0 && help ? (
          <Card>
            <Text variant="title">מה אפשר לומר</Text>
            {help.examples.slice(0, 6).map((example) => (
              <Button
                key={example}
                title={example}
                kind="ghost"
                onPress={() => void send(example)}
              />
            ))}
          </Card>
        ) : null}

        {items.map((item) => {
          if (item.role === "user") {
            return (
              <View key={item.id} style={[styles.bubble, styles.userBubble]}>
                <Text style={styles.userText}>{item.text}</Text>
              </View>
            );
          }
          switch (item.kind) {
            case "reply":
              return (
                <View key={item.id} style={[styles.bubble, styles.agentBubble]}>
                  <Text>{item.text}</Text>
                </View>
              );
            case "note":
              return (
                <View key={item.id} style={[styles.bubble, styles.agentBubble]}>
                  <Text
                    style={item.tone === "danger" ? styles.danger : undefined}
                  >
                    {item.text}
                  </Text>
                  {item.suggestions && item.said ? (
                    <View style={styles.chips}>
                      {item.suggestions.map((s) => (
                        <Button
                          key={s.actionId}
                          title={s.title}
                          kind="secondary"
                          onPress={() => void send(item.said ?? "", s.actionId)}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            case "proposal":
              return item.settled ? (
                <View key={item.id} style={[styles.bubble, styles.agentBubble]}>
                  <Text variant="muted">
                    {item.proposal.title} —{" "}
                    {item.settled === "done" ? "אושר" : "בוטל"}
                  </Text>
                </View>
              ) : (
                <ProposalCard
                  key={item.id}
                  proposal={item.proposal}
                  transcript={item.transcript}
                  onCancel={() => settleProposal(item.id, "cancelled")}
                  onDone={(result, params, refs) => {
                    settleProposal(item.id, "done");
                    settle(
                      item.transcript,
                      item.proposal.actionId,
                      result,
                      params,
                      refs,
                    );
                  }}
                />
              );
            case "result":
              return (
                <View key={item.id} style={[styles.bubble, styles.agentBubble]}>
                  {item.result.insight ? (
                    <Text variant="label">{item.result.insight}</Text>
                  ) : null}
                  <Text>{item.result.message}</Text>
                  {item.lines ? (
                    <Text variant="muted">{item.lines}</Text>
                  ) : null}
                  <View style={styles.chips}>
                    {item.result.href ? (
                      <Button
                        title="פתיחה"
                        kind="secondary"
                        onPress={() => openHref(item.result.href ?? "")}
                      />
                    ) : null}
                    {item.result.link ? (
                      <Button
                        title="פתיחה בוואטסאפ"
                        kind="secondary"
                        onPress={() =>
                          void Linking.openURL(item.result.link ?? "")
                        }
                      />
                    ) : null}
                    {(item.result.nextSteps ?? []).map((step) => (
                      <Button
                        key={step.text}
                        title={step.label}
                        kind="ghost"
                        onPress={() => void send(step.text)}
                      />
                    ))}
                    {item.result.suggestion ? (
                      <Button
                        title={item.result.suggestion}
                        kind="ghost"
                        onPress={() => void send(item.result.suggestion ?? "")}
                      />
                    ) : null}
                  </View>
                </View>
              );
            default:
              return null;
          }
        })}
        {phase === "thinking" ? <Text variant="muted">חושבת…</Text> : null}
        {phase === "transcribing" ? <Text variant="muted">מתמללת…</Text> : null}
      </ScrollView>

      <View style={styles.composer}>
        <Button
          title={phase === "recording" ? "■ סיום ההקלטה" : "● הקלטה"}
          kind={phase === "recording" ? "danger" : "primary"}
          onPress={() => void toggleRecording()}
          disabled={
            phase === "thinking" ||
            phase === "transcribing" ||
            unavailable !== null
          }
          style={styles.record}
          accessibilityHint={
            phase === "recording"
              ? "עוצר את ההקלטה ושולח לתמלול"
              : "מתחיל הקלטה"
          }
        />
        <View style={styles.typeRow}>
          <Field
            label=""
            value={text}
            onChangeText={setText}
            placeholder="או להקליד: „תוסיף קונה דנה כהן 4 חדרים בגבעתיים”"
            returnKeyType="send"
            onSubmitEditing={submitText}
            grow
            editable={phase === "idle" && unavailable === null}
          />
          <Button
            title="שליחה"
            kind="secondary"
            onPress={submitText}
            disabled={phase !== "idle" || text.trim().length < 2}
          />
        </View>
        <Chips
          options={[{ key: "clear", label: "שיחה חדשה" }]}
          value=""
          onChange={() => {
            setItems([]);
            history.current = [];
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.sm,
    },
    thread: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
    bubble: {
      borderRadius: radius.lg,
      padding: space.md,
      maxWidth: "92%",
      gap: space.xs,
    },
    userBubble: { alignSelf: "flex-start", backgroundColor: c.tabActive },
    userText: { color: "#ffffff" },
    agentBubble: {
      alignSelf: "flex-end",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    danger: { color: c.danger },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: space.sm,
      marginTop: space.xs,
    },
    composer: {
      padding: space.md,
      gap: space.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    record: { minHeight: TOUCH + 12 },
    typeRow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  };
});
