import { useMemo, useState } from "react";
import { Alert, SectionList, View } from "react-native";
import { useRouter } from "expo-router";
import {
  JERUSALEM_TZ,
  formatJerusalemTime,
  hebrewDateShort,
  jerusalemDayLabel,
  jerusalemWeekStart,
} from "@metavchim/shared";
import { apiGet, apiList, apiPatch, errorMessage } from "@/lib/api";
import type { AppointmentRow } from "@/lib/dtos";
import { successFeedback } from "@/lib/haptics";
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
  Text,
} from "@/components";
import { space } from "@/theme";

type Range = "week" | "next" | "pending";

const RANGES: { key: Range; label: string }[] = [
  { key: "week", label: "השבוע" },
  { key: "next", label: "השבוע הבא" },
  { key: "pending", label: "לתיעוד" },
];

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור",
  meeting: "פגישה",
  call: "שיחה",
};
/* ‏צבעי בלוק האירוע מהעיצוב: פגישה ירוקה, סיור ענברי, שיחה ניטרלית */
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

const OUTCOME_LABELS: Record<string, string> = {
  liked: "אהב את הנכס",
  not_fit: "לא מתאים",
  negotiating: 'עוברים למו"מ',
  needs_other: "צריך נכס אחר",
};

/** ‏„יום ראשון, 12 באוקטובר” — בשעון ישראל, ולצידו התאריך העברי. */
const DAY_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * ‏היומן — אותם נתונים כמו `/calendar` ב-web (שבועיים אחורה, שלושה
 * ‏קדימה, בשעון ישראל), מסודרים לטלפון: רשימה לפי ימים ולא רשת
 * ‏שבועית, השבוע / השבוע הבא, ו„לתיעוד” — סיורים שהתקיימו וטרם
 * ‏נרשמה תוצאה. סימון „התקיימה” וביטול כאן; דחייה ותיעוד תוצאה —
 * ‏במסך הפגישה (נייטיבי); עריכת הכותרת והעלאת הקלטה — במערכת.
 */
export default function CalendarScreen() {
  const styles = useStyles();
  const router = useRouter();
  const [range, setRange] = useState<Range>("week");
  const [busy, setBusy] = useState<string | null>(null);

  const query = useQuery(
    () => {
      const from = jerusalemWeekStart(new Date(), -2);
      const to = jerusalemWeekStart(new Date(), 3);
      return apiGet<AppointmentRow[]>(
        `/appointments?from=${from.toISOString()}&to=${to.toISOString()}`,
      ).then((r) => apiList(r, "appointments"));
    },
    [],
    { cacheKey: "calendar" },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- מכוון: השעון מתקדם רק כשהנתונים מתרעננים
  const now = useMemo(() => new Date(), [query.data]);
  const sections = useMemo(() => {
    const items = query.data ?? [];
    let picked: AppointmentRow[];
    if (range === "pending") {
      picked = items
        .filter(
          (a) =>
            a.status === "scheduled" &&
            new Date(a.startsAt) < now &&
            a.outcome === undefined,
        )
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    } else {
      const start = jerusalemWeekStart(now, range === "week" ? 0 : 1);
      const end = jerusalemWeekStart(now, range === "week" ? 1 : 2);
      picked = items
        .filter((a) => {
          const t = new Date(a.startsAt);
          return t >= start && t < end && a.status !== "cancelled";
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    const byDay = new Map<string, AppointmentRow[]>();
    for (const item of picked) {
      const day = jerusalemDayLabel(new Date(item.startsAt));
      byDay.set(day, [...(byDay.get(day) ?? []), item]);
    }
    return [...byDay.entries()].map(([day, data]) => {
      const at = new Date(data[0]?.startsAt ?? day);
      const hebrew = hebrewDateShort(at);
      return {
        key: day,
        title: DAY_FMT.format(at),
        sub: hebrew,
        isToday: day === jerusalemDayLabel(now),
        data,
      };
    });
  }, [query.data, range, now]);

  async function setStatus(
    appointment: AppointmentRow,
    status: "completed" | "cancelled",
  ) {
    setBusy(appointment.id);
    try {
      await apiPatch(`/appointments/${appointment.id}`, { status });
      successFeedback();
      await query.refresh();
    } catch (err: unknown) {
      Alert.alert("הפגישה לא עודכנה", errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function confirmCancel(appointment: AppointmentRow) {
    Alert.alert(
      "לבטל את הפגישה?",
      appointment.title ?? KIND_LABELS[appointment.kind] ?? "",
      [
        { text: "לא", style: "cancel" },
        {
          text: "ביטול הפגישה",
          style: "destructive",
          onPress: () => void setStatus(appointment, "cancelled"),
        },
      ],
    );
  }

  return (
    <Screen
      title="יומן"
      root
      scroll={false}
      trailing={
        <Button
          title="+ פגישה"
          kind="secondary"
          onPress={() => router.push("/calendar/new")}
        />
      }
    >
      <View style={styles.tools}>
        <Chips options={RANGES} value={range} onChange={setRange} />
      </View>
      <CacheNotice query={query} />
      {query.loading && query.data === null ? <Loading /> : null}
      {query.error && query.data === null ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : null}
      {query.data !== null ? (
        <SectionList
          sections={sections}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshing={query.refreshing}
          onRefresh={() => void query.refresh()}
          ListEmptyComponent={
            <EmptyState
              title={
                range === "pending"
                  ? "כל הסיורים תועדו"
                  : range === "week"
                    ? "אין פגישות השבוע"
                    : "אין פגישות בשבוע הבא"
              }
              hint={
                range === "pending" ? undefined : "פגישה חדשה — מהכפתור למעלה."
              }
            />
          }
          renderSectionHeader={({ section }) => (
            <SectionTitle
              trailing={
                section.isToday ? (
                  <Pill tone="primary">היום</Pill>
                ) : section.sub ? (
                  <Text variant="small">{section.sub}</Text>
                ) : undefined
              }
            >
              {section.title}
            </SectionTitle>
          )}
          renderItem={({ item: a }) => {
            const time = `${formatJerusalemTime(new Date(a.startsAt))}${a.endsAt ? `–${formatJerusalemTime(new Date(a.endsAt))}` : ""}`;
            const upcoming =
              a.status === "scheduled" && new Date(a.startsAt) >= now;
            const pendingOutcome =
              a.status === "scheduled" &&
              new Date(a.startsAt) < now &&
              a.outcome === undefined;
            const subtitle = [
              time,
              a.status === "scheduled"
                ? null
                : (STATUS_LABELS[a.status] ?? a.status),
              a.outcome ? (OUTCOME_LABELS[a.outcome] ?? a.outcome) : null,
              a.notes,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Row
                title={a.title ?? KIND_LABELS[a.kind] ?? a.kind}
                subtitle={subtitle}
                onPress={() => router.push(`/calendar/${a.id}`)}
                trailing={
                  <Pill tone={KIND_TONE[a.kind] ?? "neutral"}>
                    {KIND_LABELS[a.kind] ?? a.kind}
                  </Pill>
                }
                chevron
              >
                {upcoming || pendingOutcome ? (
                  <View style={styles.actions}>
                    {pendingOutcome ? (
                      <Button
                        title="תיעוד התוצאה"
                        kind="secondary"
                        small
                        onPress={() => router.push(`/calendar/${a.id}`)}
                      />
                    ) : null}
                    <Button
                      title="התקיימה"
                      kind="ghost"
                      small
                      busy={busy === a.id}
                      onPress={() => void setStatus(a, "completed")}
                    />
                    {upcoming ? (
                      <Button
                        title="ביטול"
                        kind="ghost"
                        small
                        onPress={() => confirmCancel(a)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </Row>
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
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: space.sm,
      marginTop: space.xs,
    },
  };
});
