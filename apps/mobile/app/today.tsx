import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { routeFor } from "@/lib/nav";
import {
  compareTasks,
  jerusalemDayRange,
  leadWaiting,
} from "@metavchim/shared";
import { apiGet, apiList, apiPatch, errorMessage } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import type { AppointmentRow, LeadRow, TaskRow } from "@/lib/dtos";
import { formatWhen } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  CacheNotice,
  Card,
  ErrorState,
  Pill,
  Row,
  Screen,
  SectionTitle,
  Text,
} from "@/components";
import { space } from "@/theme";
import { makeStyles } from "@/lib/theme";

interface Today {
  waitingLeads: LeadRow[];
  appointments: AppointmentRow[];
  tasks: TaskRow[];
  unread: number;
  /** ‏חלקים שנכשלו בטעינה — מוצגים כשגיאה במקומם, לא כ„אין”. */
  failed: string[];
}

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור",
  meeting: "פגישה",
  call: "שיחה",
  signing: "חתימה",
  other: "אירוע",
};

/**
 * ‏„היום” — מה דורש טיפול עכשיו, בסדר הזה: לידים שממתינים, הפגישות
 * ‏של היום, והמשימות הפתוחות שלי. אותם מקורות כמו הדשבורד ב-web,
 * ‏מצומצם למה שעושים עם טלפון ביד.
 *
 * ‏כל חלק נטען בנפרד: כישלון בפגישות אינו מסתיר את הלידים, ואינו
 * ‏מוצג כ„אין פגישות היום”.
 */
export default function TodayScreen() {
  const styles = useStyles();
  const { user, pushStatus, enablePush } = useAuth();
  const router = useRouter();
  const canLeads = can(user, "leads.view_own");
  const canCalendar = can(user, "calendar.manage");

  const query = useQuery<Today>(
    async () => {
      const now = new Date();
      const failed: string[] = [];
      const settle = async <T,>(
        label: string,
        work: Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await work;
        } catch {
          failed.push(label);
          return fallback;
        }
      };
      const { start, end } = jerusalemDayRange(now);
      // הסוף כולל: פגישה בחצות הבאה שייכת למחר (ראו הדשבורד ב-web)
      const dayEndInclusive = new Date(end.getTime() - 1);
      const none: never[] = [];
      const [leads, appointments, tasks, notifications] = await Promise.all([
        /*
         * ‏תור המענה נבנה בשרת ולא מתוך „100 החדשים”: הוותיקים ביותר
         * ‏מבין הפתוחים (הם שחורגים מה-KPI), ובנפרד כל מה שסומן „דורש
         * ‏טיפול” — ליד כזה יכול להיות חדש ועדיין ראשון בתור. במשרד עם
         * ‏מאות לידים העמוד הראשון של „החדש ראשון” היה משמיט בדיוק את
         * ‏מי שממתין הכי הרבה (ביקורת Codex).
         */
        canLeads
          ? settle(
              "לידים",
              Promise.all([
                apiGet<{ items: LeadRow[] }>(
                  "/leads?open=true&order=oldest&limit=100",
                ).then((r) => apiList(r.items, "items")),
                apiGet<{ items: LeadRow[] }>(
                  "/leads?open=true&requiresHuman=true&limit=100",
                ).then((r) => apiList(r.items, "items")),
              ]).then(([oldest, urgent]) => {
                const seen = new Set(oldest.map((lead) => lead.id));
                return [
                  ...oldest,
                  ...urgent.filter((lead) => !seen.has(lead.id)),
                ];
              }),
              none as LeadRow[],
            )
          : Promise.resolve(none as LeadRow[]),
        canCalendar
          ? settle(
              "פגישות",
              apiGet<AppointmentRow[]>(
                `/appointments?from=${start.toISOString()}&to=${dayEndInclusive.toISOString()}`,
              ).then((r) => apiList(r, "appointments")),
              none as AppointmentRow[],
            )
          : Promise.resolve(none as AppointmentRow[]),
        canCalendar
          ? settle(
              "משימות",
              apiGet<TaskRow[]>("/tasks?status=open&assignee=me").then((r) =>
                apiList(r, "tasks"),
              ),
              none as TaskRow[],
            )
          : Promise.resolve(none as TaskRow[]),
        settle(
          "התראות",
          apiGet<{ unreadCount: number }>("/notifications?limit=1"),
          {
            unreadCount: 0,
          },
        ),
      ]);
      const waitingLeads = leads
        .map((lead) => ({
          lead,
          waiting: leadWaiting(lead.createdAt, lead.status, now),
        }))
        .filter(
          ({ lead, waiting }) =>
            lead.requiresHuman || (waiting !== null && waiting.level !== "ok"),
        )
        .sort(
          (a, b) =>
            (b.waiting?.hours ?? Infinity) - (a.waiting?.hours ?? Infinity),
        )
        .map(({ lead }) => lead);
      return {
        waitingLeads,
        appointments: [...appointments].sort((a, b) =>
          a.startsAt.localeCompare(b.startsAt),
        ),
        tasks: [...tasks].sort(compareTasks),
        unread: notifications.unreadCount,
        failed,
      };
    },
    [canLeads, canCalendar],
    { cacheKey: "today" },
  );

  // „עכשיו” של הטעינה האחרונה — ניסוחי ההמתנה מתעדכנים יחד עם הנתונים
  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);
  const [doneBusy, setDoneBusy] = useState<string | null>(null);

  async function completeTask(task: TaskRow) {
    setDoneBusy(task.id);
    try {
      await apiPatch(`/tasks/${task.id}`, { status: "done" });
      await query.refresh();
    } catch (err: unknown) {
      Alert.alert("המשימה לא סומנה", errorMessage(err));
    } finally {
      setDoneBusy(null);
    }
  }

  const data = query.data;
  const firstName = user?.name?.split(" ")[0];
  const greeting = firstName ? `שלום, ${firstName}` : "שלום";

  return (
    <Screen
      title={greeting}
      root
      refreshing={query.refreshing}
      onRefresh={() => void query.refresh()}
    >
      <CacheNotice query={query} />
      {query.error && data === null ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : null}
      {data === null && query.loading ? (
        <Text variant="muted">טוען את היום…</Text>
      ) : null}

      {pushStatus === "undetermined" ? (
        <Card>
          <Text variant="title">לקבל התראה כשנכנס ליד?</Text>
          <Text variant="muted">
            ליד חדש, פגישה קרובה ומשימה שהגיע זמנה — גם כשהאפליקציה סגורה.
          </Text>
          <Button
            title="הפעלת התראות"
            kind="secondary"
            onPress={() => void enablePush()}
          />
        </Card>
      ) : null}

      {data ? (
        <>
          {data.failed.length > 0 ? (
            <Card style={styles.warn}>
              <Text style={styles.warnText}>
                לא הצלחנו לטעון: {data.failed.join(", ")}. משכו למטה כדי לנסות
                שוב.
              </Text>
            </Card>
          ) : null}

          {canLeads ? (
            <>
              <SectionTitle count={data.waitingLeads.length}>
                ממתינים לך
              </SectionTitle>
              {can(user, "leads.edit") ? (
                <Button
                  title="+ ליד חדש"
                  kind="ghost"
                  onPress={() => router.push("/leads/new")}
                />
              ) : null}
              {data.waitingLeads.length === 0 &&
              !data.failed.includes("לידים") ? (
                <Card>
                  <Text variant="muted">אין ליד שממתין למענה. יפה.</Text>
                </Card>
              ) : null}
              {data.waitingLeads.slice(0, 8).map((lead) => {
                const waiting = leadWaiting(lead.createdAt, lead.status, now);
                return (
                  <Row
                    key={lead.id}
                    title={lead.contact.name}
                    subtitle={waiting ? `ממתין ${waiting.label}` : undefined}
                    onPress={() => router.push(routeFor(`/leads/${lead.id}`))}
                    trailing={
                      lead.requiresHuman ? (
                        <Pill tone="danger">דורש טיפול</Pill>
                      ) : waiting?.level === "late" ? (
                        <Pill tone="danger">מעל יממה</Pill>
                      ) : (
                        <Pill tone="amber">ממתין</Pill>
                      )
                    }
                  />
                );
              })}
            </>
          ) : null}

          {canCalendar ? (
            <>
              <SectionTitle count={data.appointments.length}>
                היום ביומן
              </SectionTitle>
              {data.appointments.length === 0 &&
              !data.failed.includes("פגישות") ? (
                <Card>
                  <Text variant="muted">אין פגישות היום.</Text>
                </Card>
              ) : null}
              {data.appointments.map((appt) => (
                <Row
                  key={appt.id}
                  title={appt.title ?? KIND_LABELS[appt.kind] ?? appt.kind}
                  subtitle={formatWhen(appt.startsAt, now)}
                  onPress={() => router.push(`/calendar/${appt.id}`)}
                  chevron
                  trailing={
                    <Pill tone="primary">
                      {KIND_LABELS[appt.kind] ?? appt.kind}
                    </Pill>
                  }
                />
              ))}

              <SectionTitle count={data.tasks.length}>המשימות שלי</SectionTitle>
              <Button
                title="+ משימה"
                kind="ghost"
                onPress={() => router.push("/tasks/new")}
              />
              {data.tasks.length === 0 && !data.failed.includes("משימות") ? (
                <Card>
                  <Text variant="muted">אין משימות פתוחות.</Text>
                </Card>
              ) : null}
              {data.tasks.slice(0, 10).map((task) => (
                <Row
                  key={task.id}
                  title={task.title}
                  subtitle={[
                    task.entityLabel,
                    task.dueAt ? formatWhen(task.dueAt, now) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={
                    <View style={styles.taskActions}>
                      {task.priority === "high" ? (
                        <Pill tone="danger">דחוף</Pill>
                      ) : null}
                      <Button
                        title="בוצע"
                        kind="secondary"
                        busy={doneBusy === task.id}
                        onPress={() => void completeTask(task)}
                        accessibilityHint={`מסמן את המשימה ${task.title} כבוצעה`}
                      />
                    </View>
                  }
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => {
  const c = t.colors;
  return {
    warn: { backgroundColor: c.warningBg, borderColor: c.warning },
    warnText: { color: c.warning },
    taskActions: { alignItems: "flex-end", gap: space.xs },
  };
});
