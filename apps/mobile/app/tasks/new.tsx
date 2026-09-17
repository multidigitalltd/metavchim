import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  isTaskEntityType,
  jerusalemWallIsoToUtc,
  quickDueOptions,
  type TaskPriority,
} from "@metavchim/shared";
import { apiPost, errorMessage } from "@/lib/api";
import { Button, Card, Chips, Field, Screen, Text } from "@/components";
import { space } from "@/theme";

const PRIORITIES = TASK_PRIORITIES.map((key) => ({ key, label: TASK_PRIORITY_LABELS[key] }));

type DueKey = "none" | "today" | "tomorrow" | "in3" | "next_week";

/**
 * ‏משימה חדשה — כותרת, מועד מהיר, עדיפות, ואופציונלית הישות שממנה
 * ‏נפתחה (`?entityType=lead&entityId=…&label=…`). המועדים המהירים
 * ‏הם אותם ארבעה כמו ב-web (`quickDueOptions`), בשעון ישראל, ורק
 * ‏אלה שעדיין לפנינו.
 */
export default function NewTaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ entityType?: string; entityId?: string; label?: string }>();
  const entity =
    params.entityType && params.entityId && isTaskEntityType(params.entityType)
      ? { type: params.entityType, id: params.entityId, label: params.label }
      : null;

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [due, setDue] = useState<DueKey>("tomorrow");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dueOptions = useMemo(() => quickDueOptions(new Date()), []);
  const dueChips = useMemo(
    () => [{ key: "none" as DueKey, label: "בלי מועד" }, ...dueOptions.map((o) => ({ key: o.key as DueKey, label: o.label }))],
    [dueOptions],
  );
  const dueValue = dueChips.some((c) => c.key === due) ? due : "none";

  async function submit() {
    setError(null);
    if (title.trim() === "") {
      setError("למשימה צריך שם");
      return;
    }
    setBusy(true);
    try {
      const option = dueOptions.find((o) => o.key === dueValue);
      await apiPost("/tasks", {
        title: title.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(option ? { dueAt: jerusalemWallIsoToUtc(`${option.value}:00.000`).toISOString() } : {}),
        priority,
        ...(entity ? { entityType: entity.type, entityId: entity.id } : {}),
      });
      router.back();
    } catch (err: unknown) {
      setError(errorMessage(err, "המשימה לא נשמרה — נסו שוב"));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "משימה חדשה" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Card>
          {entity?.label ? <Text variant="muted">על {entity.label}</Text> : null}
          <Field
            label="מה לעשות"
            value={title}
            onChangeText={setTitle}
            autoFocus
            maxLength={200}
            placeholder="לחזור ללקוח עם מחיר"
            returnKeyType="done"
          />
          <Text variant="label">מתי</Text>
          <Chips options={dueChips} value={dueValue} onChange={setDue} />
          <Text variant="label">עדיפות</Text>
          <Chips options={PRIORITIES} value={priority} onChange={setPriority} />
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
          <Button title="שמירת המשימה" onPress={() => void submit()} busy={busy} />
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 88, textAlignVertical: "top", paddingTop: space.md },
});
