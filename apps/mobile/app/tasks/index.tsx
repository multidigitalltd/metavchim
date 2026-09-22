import { useMemo, useState } from "react";
import { Alert, SectionList, View } from "react-native";
import { useRouter } from "expo-router";
import {
  TASK_PRIORITY_LABELS,
  groupTasksByBucket,
  isTaskPriority,
  taskEntityHref,
  type TaskBucket,
} from "@metavchim/shared";
import { apiGet, apiList, apiPatch, errorMessage } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { TaskRow } from "@/lib/dtos";
import { formatWhen } from "@/lib/format";
import { successFeedback } from "@/lib/haptics";
import { TASK_PRIORITY_TONE } from "@/lib/labels";
import { routeFor } from "@/lib/nav";
import { makeStyles } from "@/lib/theme";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  CacheNotice,
  Chips,
  EmptyState,
  ErrorState,
  Loading,
  Pill,
  Row,
  Screen,
  SectionTitle,
} from "@/components";
import { space } from "@/theme";

type Scope = "me" | "all";
type Status = "open" | "done";

const STATUS_CHIPS: { key: Status; label: string }[] = [
  { key: "open", label: "פתוחות" },
  { key: "done", label: "בוצעו" },
];

/** ‏גוון הדלי — באיחור אדום, היום ענברי, השאר ניטרלי (כמו `BUCKET_COLOR` ב-web). */
const BUCKET_TONE: Record<TaskBucket, "danger" | "amber" | "neutral"> = {
  overdue: "danger",
  today: "amber",
  week: "neutral",
  later: "neutral",
  someday: "neutral",
};

/**
 * ‏המשימות — אותו לוח כמו `/tasks` ב-web: מקובצות לדליים („באיחור”,
 * ‏„היום”, „השבוע”, „בהמשך”, „בלי מועד”) לפי `groupTasksByBucket`
 * ‏מ-shared, ולא רשימה שטוחה לפי תאריך. שלי / כל המשרד (למי שרשאי),
 * ‏פתוחות / בוצעו, סימון „בוצע” בלחיצה, וקפיצה אל הלקוח או הנכס
 * ‏שהמשימה נוגעת בו.
 */
export default function TasksScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const canViewAll = can(user, "tasks.view_all");
  const [scope, setScope] = useState<Scope>("me");
  const [status, setStatus] = useState<Status>("open");
  const [busy, setBusy] = useState<string | null>(null);

  const effectiveScope: Scope = canViewAll ? scope : "me";
  const query = useQuery(
    () =>
      apiGet<TaskRow[]>(
        `/tasks?status=${status}&assignee=${effectiveScope}`,
      ).then((r) => apiList(r, "tasks")),
    [status, effectiveScope],
    { cacheKey: `tasks:${status}:${effectiveScope}` },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);
  const sections = useMemo(() => {
    const tasks = query.data ?? [];
    if (status === "done") {
      // ‏מה שבוצע — לפי הביצוע האחרון, בלי דליים: הם על העתיד
      return tasks.length === 0
        ? []
        : [
            {
              bucket: "someday" as TaskBucket,
              label: "בוצעו",
              data: [...tasks].sort((a, b) =>
                (b.dueAt ?? "").localeCompare(a.dueAt ?? ""),
              ),
            },
          ];
    }
    return groupTasksByBucket(tasks, now)
      .filter((group) => group.tasks.length > 0)
      .map((group) => ({
        bucket: group.bucket,
        label: group.label,
        data: group.tasks,
      }));
  }, [query.data, status, now]);

  async function setTaskStatus(task: TaskRow, next: Status) {
    setBusy(task.id);
    try {
      await apiPatch(`/tasks/${task.id}`, { status: next });
      successFeedback();
      await query.refresh();
    } catch (err: unknown) {
      Alert.alert(
        next === "done" ? "המשימה לא סומנה" : "המשימה לא נפתחה מחדש",
        errorMessage(err),
      );
    } finally {
      setBusy(null);
    }
  }

  function open(task: TaskRow) {
    const href =
      task.entityType && task.entityId
        ? taskEntityHref(task.entityType, task.entityId)
        : null;
    if (href !== null) router.push(routeFor(href));
  }

  const scopeChips = [
    { key: "me" as Scope, label: "שלי" },
    { key: "all" as Scope, label: "כל המשרד" },
  ];

  return (
    <Screen
      title="משימות"
      root
      scroll={false}
      trailing={
        <Button
          title="+ משימה"
          kind="secondary"
          onPress={() => router.push("/tasks/new")}
        />
      }
    >
      <View style={styles.tools}>
        {canViewAll ? (
          <Chips
            options={scopeChips}
            value={effectiveScope}
            onChange={setScope}
          />
        ) : null}
        <Chips options={STATUS_CHIPS} value={status} onChange={setStatus} />
      </View>
      <CacheNotice query={query} />
      {query.loading && query.data === null ? <Loading /> : null}
      {query.error && query.data === null ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : null}
      {query.data !== null ? (
        <SectionList
          sections={sections}
          keyExtractor={(task) => task.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshing={query.refreshing}
          onRefresh={() => void query.refresh()}
          ListEmptyComponent={
            <EmptyState
              title={
                status === "open" ? "אין משימות פתוחות" : "עוד לא בוצעו משימות"
              }
              hint={status === "open" ? "מה שנסגר עובר ל„בוצעו”." : undefined}
            />
          }
          renderSectionHeader={({ section }) => (
            <SectionTitle
              count={section.data.length}
              trailing={
                section.bucket === "overdue" || section.bucket === "today" ? (
                  <Pill tone={BUCKET_TONE[section.bucket]}>
                    {section.label}
                  </Pill>
                ) : undefined
              }
            >
              {section.label}
            </SectionTitle>
          )}
          renderItem={({ item: task }) => {
            const editable = task.canEdit !== false;
            const subtitle = [
              task.entityLabel,
              task.dueAt ? formatWhen(task.dueAt, now) : null,
              effectiveScope === "all" ? task.assigneeName : null,
              task.assignedByName ? `הוטלה בידי ${task.assignedByName}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Row
                title={task.title}
                subtitle={subtitle || undefined}
                onPress={
                  task.entityType && task.entityId
                    ? () => open(task)
                    : undefined
                }
                trailing={
                  <View style={styles.actions}>
                    {isTaskPriority(task.priority) &&
                    task.priority !== "normal" ? (
                      <Pill
                        tone={TASK_PRIORITY_TONE[task.priority] ?? "neutral"}
                      >
                        {TASK_PRIORITY_LABELS[task.priority]}
                      </Pill>
                    ) : null}
                    {editable ? (
                      <Button
                        title={status === "open" ? "בוצע" : "לפתוח מחדש"}
                        kind={status === "open" ? "secondary" : "ghost"}
                        small
                        busy={busy === task.id}
                        onPress={() =>
                          void setTaskStatus(
                            task,
                            status === "open" ? "done" : "open",
                          )
                        }
                        accessibilityHint={
                          status === "open"
                            ? `מסמן את המשימה ${task.title} כבוצעה`
                            : `מחזיר את המשימה ${task.title} לפתוחות`
                        }
                      />
                    ) : null}
                  </View>
                }
              />
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    tools: {
      paddingHorizontal: space.lg,
      gap: space.sm,
      backgroundColor: c.bg,
    },
    list: { padding: space.lg, gap: space.sm, paddingBottom: space.xl * 2 },
    actions: { alignItems: "flex-end", gap: space.xs },
  };
});
