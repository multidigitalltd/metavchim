"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
  RECRUITMENT_SOURCES,
  RECRUITMENT_STATUSES,
  type RecruitmentStatus,
  canConvertToProperty,
  isOpenRecruitment,
  recruitmentSourceLabel,
  recruitmentStatusLabel,
  sourceUrlHost,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { IconPlus, IconSheet } from "../../icons";
import { FilterChips } from "../../list-controls";
import {
  EMPTY_FILTERS,
  ListFilters,
  filtersToQuery,
  hasActiveFilters,
  type ListFilterValues,
} from "../../list-filters";
import { TargetDialog } from "./target-dialog";
import { targetAddress, type TargetValues } from "./target-values";

/**
 * ‎**שורה ברשימה היא אותה שורה שבחלונית.**
 *
 * ‏עד עכשיו הרשימה הכריזה על תת-קבוצה משלה של השדות, והשרת החזיר
 * ‏את המלאה. החלונית לא יכלה להראות שכונה, קומה או סוג עסקה — לא
 * ‏כי הם לא הגיעו, אלא כי הטיפוס כאן לא ידע עליהם.
 */
type TargetRow = TargetValues & { id: string; status: string; source: string };

/**
 * ‎**התקרה של הרשימה.** השרת מחזיר עד כאן, וייבוא אחד יכול להביא
 * ‏יותר. רשימה שנחתכת בלי לומר זאת נראית כמו רשימה שלמה.
 */
const PAGE_CAP = 500;


export default function RecruitmentPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [filter, setFilter] = useState<"" | RecruitmentStatus>("");
  const [error, setError] = useState<string | null>(null);
  /** המזהה שההמרה רצה עליו — הכפתור ננעל כדי שלחיצה כפולה לא תשלח שוב */
  const [converting, setConverting] = useState<string | null>(null);
  /** ‏המזהה שממתין לאישור מחיקה — האישור נפתח בשורה עצמה */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  /**
   * ‎**השורה שהחלונית פתוחה עליה — מזהה, ולא עותק של השורה.**
   *
   * ‏עותק היה מתיישן ברגע שהרשימה נטענת מחדש (שינוי שלב, מחיקה,
   * ‏סינון), והחלונית הייתה מציגה נכס שכבר השתנה. מזהה נפתר מול
   * ‏‎`rows` בכל רינדור, ולכן הוא תמיד מה שהרשימה יודעת.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  /* ‏חיפוש חופשי + טווחי מחיר וחדרים — אותו רכיב של הנכסים והקונים */
  const [filters, setFilters] = useState<ListFilterValues>(EMPTY_FILTERS);
  /*
   * ‏עיר, מקור וגודל יושבים לצדם ולא בתוכם: הרכיב המשותף מחזיק את
   * ‏שלושת הסינונים שכל רשימה צריכה, ואלה שלושה שרק כאן יש להם
   * ‏משמעות. אותו מבנה בדיוק כמו „עיר” ו„סוג” ברשימת הנכסים.
   */
  const [city, setCity] = useState("");
  const [source, setSource] = useState("");
  const [minArea, setMinArea] = useState("");
  const [maxArea, setMaxArea] = useState("");

  /* ‏הבחירה למחיקה מרוכזת — קבוצה של מזהים, כמו ברשימת הנכסים */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  /*
   * ‎**הכפתור נגזר מהחבילה, לא רק מההרשאה.**
   *
   * ‏נתיב הייבוא חסום מאחורי `@RequireFeature("data_io")`. בלי
   * ‏הבדיקה כאן, משרד בלי החבילה היה בוחר קובץ, ממפה עמודות, לוחץ
   * ‏„ייבא” — ומקבל 403 בסוף (ביקורת Codex). אותה בדיקה בדיוק
   * ‏קיימת על כפתור הייבוא של הנכסים.
   */
  const canImport = useFeature("data_io");

  /*
   * ‎**הסינון רץ בשרת, לא במסך.**
   *
   * ‏הרשימה חסומה ב-500 שורות, וייבוא אחד יכול להביא יותר. סינון
   * ‏מקומי היה מסנן רק את מה שכבר נשלף — כלומר „הראה לי את רמת גן”
   * ‏היה מחזיר את מה שבמקרה נכנס לחמש מאות האחרונות.
   */
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== "") params.set("status", filter);
    if (source !== "") params.set("source", source);
    if (city !== "") params.set("city", city);
    if (minArea !== "") params.set("minArea", minArea);
    if (maxArea !== "") params.set("maxArea", maxArea);
    /* ‏`filtersToQuery` מחזיר מחרוזת שמתחילה ב-`&` — או ריקה */
    const parts = [params.toString(), filtersToQuery(filters).slice(1)].filter((p) => p !== "");
    const query = parts.length === 0 ? "" : `?${parts.join("&")}`;
    const data = await apiGet<TargetRow[]>(`/recruitment${query}`);
    const fresh = Array.isArray(data) ? data : [];
    setRows(fresh);
    /*
     * ‎**הבחירה נגזמת למה שחזר** (ביקורת Codex, P1).
     *
     * ‏בחירה שנעשתה לפני שינוי סינון שרדה אותו, ו„מחיקת הנבחרים”
     * ‏שלחה גם מזהים שכבר אינם בטבלה — כלומר מחיקה של שורות שהמתווך
     * ‏אינו רואה, ושאישור מספרי („למחוק 40”) אינו יכול לחשוף.
     * ‏פעולה הרסנית חייבת לגעת רק במה שמוצג.
     *
     * ‏אותה קבוצה מוחזרת כשלא נגרע דבר, כדי שהעדכון לא יריץ רינדור
     * ‏מיותר בכל טעינה.
     */
    setSelected((was) => {
      if (was.size === 0) return was;
      const visible = new Set(fresh.map((row) => row.id));
      const kept = [...was].filter((id) => visible.has(id));
      return kept.length === was.size ? was : new Set(kept);
    });
  }, [filter, source, city, minArea, maxArea, filters]);

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, [load]);

  if (authLoading || !user) return null;
  const mayEdit = can(user, "properties.edit");
  const mayCreate = can(user, "properties.create");
  const mayDelete = can(user, "properties.delete");
  /*
   * ‏תיבות הסימון קיימות בשביל המחיקה המרוכזת בלבד, ולכן הן
   * ‏מותנות באותה הרשאה. סוכן שאינו רשאי למחוק אינו רואה עמודה
   * ‏שכל מה שאפשר לעשות בה חסום לו.
   */
  const maySelect = mayDelete;

  async function changeStatus(id: string, status: string) {
    setError(null);
    try {
      await apiPatch(`/recruitment/${id}`, { status });
      await load();
    } catch {
      setError("שינוי השלב נכשל. נסו שוב.");
    }
  }

  async function convert(id: string) {
    setError(null);
    setConverting(id);
    try {
      const { propertyId } = await apiPost<{ propertyId: string }>(
        `/recruitment/${id}/convert`,
        {},
      );
      router.push(`/properties/${propertyId}`);
    } catch {
      setError("ההמרה לא הושלמה. רעננו ונסו שוב.");
      setConverting(null);
    }
  }

  /**
   * ‎**מחיקה רכה — השורה יורדת מהרשימה, ולא נמחקת מהמסד.**
   *
   * ‏זו אותה הכרעה של הנכסים: „טעיתי, זה לא רלוונטי” הוא הרוב
   * המוחלט של המחיקות, ומחיקה שאי אפשר לבטל הופכת טעות קטנה
   * לאובדן. השרת מסמן `deletedAt`, והשורה נעלמת מכל שאילתה.
   */
  async function remove(id: string) {
    setError(null);
    setDeleting(id);
    try {
      await apiDelete(`/recruitment/${id}`);
    } catch {
      setError("המחיקה נכשלה — נסו שוב.");
      setDeleting(null);
      return;
    }

    /*
     * ‎**המחיקה הצליחה — וריענון שנכשל אינו הופך אותה לכישלון.**
     *
     * ‏‎`catch` אחד סביב שתי הקריאות אמר „המחיקה נכשלה” גם כשהשורה
     * ‏כבר נמחקה: המתווך היה רואה אותה עדיין ברשימה, לוחץ שוב, ומקבל
     * ‏404 — כי השירות מוחק רק שורות עם `deletedAt: null` (ביקורת
     * ‏Codex). לכן השורה יורדת מהמצב המקומי מיד, והריענון הוא רק
     * ‏סנכרון של המונים.
     */
    setConfirmingDelete(null);
    setRows((prev) => (prev ?? []).filter((row) => row.id !== id));
    setDeleting(null);
    await load().catch(() => undefined);
  }

  /**
   * ‎**מחיקה מרוכזת — הצורה שבה מנקים ייבוא שגוי.**
   *
   * ‏קובץ של אלף שורות שהתברר כלא נכון נוקה עד עכשיו שורה-שורה,
   * ‏עם אישור לכל אחת. הפעולה זהה למחיקה הבודדת בכל השאר: רכה,
   * ‏והשורה נעלמת מכל שאילתה.
   */
  async function removeSelected(): Promise<void> {
    /*
     * ‎**המזהים נגזרים מהשורות המוצגות, ולא מקבוצת הבחירה.**
     *
     * ‏הגיזום בטעינה שומר על השתיים מסונכרנות, אבל פעולה הרסנית
     * ‏לא אמורה להישען על סנכרון: מה שנשלח למחיקה הוא מה שרואים,
     * ‏מעצם הבנייה. שתי שכבות לאותה הבטחה, כי אישור מספרי
     * ‏(„למחוק 40”) אינו יכול לחשוף מה נכנס בטעות.
     */
    const ids = (rows ?? []).filter((row) => selected.has(row.id)).map((row) => row.id);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `למחוק ${ids.length} נכסים לגיוס? הם יורדו מהרשימה, וההיסטוריה נשמרת.`,
      )
    ) {
      return;
    }

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    let result: { removed: number; skipped: number };
    try {
      result = await apiPost<{ removed: number; skipped: number }>(
        "/recruitment/bulk-delete",
        { ids },
      );
    } catch {
      setError("המחיקה נכשלה — נסו שוב.");
      setBulkBusy(false);
      return;
    }

    /*
     * ‎**הריענון בנפרד מהמחיקה, ולא באותו `try`.**
     *
     * ‏כישלון של הריענון היה מדווח „המחיקה נכשלה” על מחיקה שהצליחה,
     * ‏ומזמין את המתווך למחוק שוב. אותו לקח בדיוק של המחיקה הבודדת.
     */
    setBulkNote(
      result.skipped === 0
        ? `${result.removed} נמחקו`
        : `${result.removed} נמחקו, ${result.skipped} דולגו — כנראה כבר נמחקו`,
    );
    setSelected(new Set());
    await load().catch(() => setError("הרשימה לא רועננה — רעננו את העמוד"));
    setBulkBusy(false);
  }

  function toggle(id: string): void {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const open = (rows ?? []).filter((r) => isOpenRecruitment(r.status)).length;
  /*
   * ‎**„הכול נבחר” נמדד מול מה שמוצג.** הסינון רץ בשרת, ולכן
   * ‏„הכול” פירושו „כל מה שהסינון החזיר” — וזה גם מה שהמחיקה
   * ‏תיגע בו.
   */
  const allSelected = (rows ?? []).length > 0 && (rows ?? []).every((r) => selected.has(r.id));
  const filtering =
    hasActiveFilters(filters) ||
    filter !== "" ||
    city !== "" ||
    source !== "" ||
    minArea !== "" ||
    maxArea !== "";
  const capped = (rows ?? []).length >= PAGE_CAP;
  /*
   * ‏נפתר מהרשימה בכל רינדור. שורה שירדה מהתצוגה (נמחקה, או יצאה
   * ‏מהסינון) סוגרת את החלונית מעצמה — חלונית שממשיכה להציג נכס
   * ‏שאינו ברשימה מזמינה שמירה על שורה שכבר אינה שם.
   */
  const openRow = openId === null ? null : ((rows ?? []).find((r) => r.id === openId) ?? null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">נכסים לגיוס</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            מודעות ונכסים שאתם רוצים לגייס לייצוג — לפני שהם נכנסים למאגר.
            {rows !== null && open > 0 ? ` ${open} בטיפול כרגע.` : ""}
          </p>
        </div>
        {mayCreate ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {/*
              ‏אותו מסך ייבוא של הנכסים, בלשונית „נכסים לגיוס”. הקובץ
              נכתב לטבלת הגיוס בלבד — נכס שיובא לכאן אינו מגיע
              להתאמות ולא לרשת עד שלוחצים „המר לנכס שלי”.
            */}
            {canImport ? (
              <Link
                href="/import?mode=recruitment"
                className="mv-btn-plain"
                style={{ minHeight: 38, paddingInline: 14, fontSize: "var(--type-caption)" }}
              >
                <IconSheet s={15} /> ייבוא מאקסל
              </Link>
            ) : null}
            <Link href="/properties/recruitment/new">
              <Button>
                <IconPlus />
                נכס לגיוס חדש
              </Button>
            </Link>
          </div>
        ) : null}
      </header>

      {/*
        ‏שורת שבבים ולא `.mv-choice`: השנייה היא אפשרות ברוחב מלא
        בטופס בחירה, ובשורת סינון היא נערמת אנכית ודוחקת את הטבלה
        אל מתחת לקפל. `FilterChips` הוא אותו רכיב שרשימות הנכסים
        והקונים כבר משתמשות בו.
      */}
      <div className="mb-4">
        <FilterChips
          label="סינון לפי שלב"
          value={filter}
          onChange={(value) => setFilter(value as "" | RecruitmentStatus)}
          options={[
            ["", "הכול"],
            ...RECRUITMENT_STATUSES.map(
              (status) => [status, recruitmentStatusLabel(status)] as [string, string],
            ),
          ]}
        />
      </div>

      {/*
        ‏אותו סרגל סינון של הנכסים והקונים — חיפוש חופשי, טווח מחיר
        וטווח חדרים — ובתוכו הסינונים שרק לגיוס יש: עיר, מקור וגודל.
        רשימת גיוס גדלה מהר יותר מרשימת הנכסים, ועד עכשיו אפשר היה
        לסנן בה לפי שלב בלבד.
      */}
      <ListFilters
        values={filters}
        onApply={setFilters}
        searchLabel="חיפוש"
        searchHint="כתובת, שכונה, עיר, סוג נכס או הערה"
        priceLabel="מחיר מבוקש"
        card={{ example: "לחי 20 בני ברק" }}
        childrenActive={city !== "" || source !== "" || minArea !== "" || maxArea !== ""}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">עיר</span>
            <input
              className="rounded-lg border px-3"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                minHeight: 38,
              }}
              placeholder="כל הערים"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </label>

          {/*
            ‏„גודל” — שטח במ"ר. אין לו מקום בסרגל המשותף כי לקונה
            אין שטח יחיד אלא דרישת מינימום, ושדה אחד שמשמעותו שונה
            בשני מסכים הוא בדיוק מה שמייצר סינון ששיקר באחד מהם.
          */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">גודל מ־ (מ״ר)</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="w-28 rounded-lg border px-3"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                minHeight: 38,
              }}
              value={minArea}
              onChange={(event) => setMinArea(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">עד (מ״ר)</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="w-28 rounded-lg border px-3"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                minHeight: 38,
              }}
              value={maxArea}
              onChange={(event) => setMaxArea(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">מקור</span>
            <select
              className="mv-select"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">כל המקורות</option>
              {RECRUITMENT_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {recruitmentSourceLabel(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ListFilters>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-[var(--color-danger-soft)] p-3 text-sm">
          {error}
        </p>
      ) : null}

      {bulkNote ? (
        <p className="mb-4 rounded-md bg-[var(--color-success-soft)] p-3 text-sm">{bulkNote}</p>
      ) : null}

      {/*
        ‏שורת הבחירה מופיעה רק כשיש בחירה — סרגל קבוע שאומר „נבחרו 0”
        גוזל שורה מהטבלה בלי לומר דבר.
      */}
      {maySelect && selected.size > 0 ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <span className="text-sm font-semibold">נבחרו {selected.size}</span>
          <Button variant="secondary" onClick={() => setSelected(new Set())}>
            ביטול הבחירה
          </Button>
          <button
            type="button"
            className="mv-btn-plain"
            style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
            disabled={bulkBusy}
            onClick={() => void removeSelected()}
          >
            {bulkBusy ? "מוחק…" : "מחיקת הנבחרים"}
          </button>
        </div>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">טוען…</p>
      ) : rows.length === 0 ? (
        <div className="mv-card p-6 text-center">
          {filtering ? (
            <>
              <p className="font-semibold">אין נכסים שעונים על הסינון</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                נסו לרחיב את הטווח, או לנקות את הסינון.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">אין כאן נכסים לגיוס</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                ראיתם מודעה ביד2 או שלט על מרפסת? הוסיפו אותה כאן, ותנהלו את הפנייה עד החתימה.
              </p>
            </>
          )}
        </div>
      ) : (
        /*
         * ‏הכרטיס חותך, והגלילה האופקית יושבת בתוכו — הטבלה אמורה
         * להגיע מקצה לקצה, והריפוד הוא של התאים.
         */
        <div className="mv-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-sm text-[var(--color-text-muted)]">
                  {maySelect ? (
                    <th className="p-3">
                      <input
                        type="checkbox"
                        aria-label="בחירת כל השורות המוצגות"
                        checked={allSelected}
                        onChange={() =>
                          setSelected(
                            allSelected ? new Set() : new Set((rows ?? []).map((row) => row.id)),
                          )
                        }
                      />
                    </th>
                  ) : null}
                  <th className="p-3">כתובת</th>
                  <th className="p-3">פרטים</th>
                  <th className="p-3">מקור</th>
                  <th className="p-3">בעל הנכס</th>
                  <th className="p-3">שלב</th>
                  <th className="p-3">פעולה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const host = row.sourceUrl ? sourceUrlHost(row.sourceUrl) : null;
                  return (
                    <tr key={row.id} className="border-t border-[var(--color-border)]">
                      {maySelect ? (
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={`בחירת ${targetAddress(row)}`}
                            checked={selected.has(row.id)}
                            onChange={() => toggle(row.id)}
                          />
                        </td>
                      ) : null}
                      <td className="p-3">
                        {/*
                          ‎**לחיצה פותחת את החלונית — והקישור נשאר קישור.**

                          ‏העבודה כאן היא סבב של שורות, ולכן הלחיצה
                          ‏השכיחה צריכה לפתוח את הפרטים במקום, בלי לאבד
                          ‏את הסינון והגלילה. אבל `button` היה גוזל את
                          ‏פתיחת העמוד בלשונית חדשה ואת העתקת הכתובת —
                          ‏ולכן זה `Link` אמיתי, ורק הלחיצה **הרגילה**
                          ‏מיורטת. לחיצה עם Ctrl/Cmd/Shift, או בגלגלת,
                          ‏ממשיכה לדפדפן כרגיל.
                        */}
                        <Link
                          href={`/properties/recruitment/${row.id}`}
                          className="font-semibold underline-offset-2 hover:underline"
                          onClick={(event) => {
                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey ||
                              event.button !== 0
                            ) {
                              return;
                            }
                            event.preventDefault();
                            setOpenId(row.id);
                          }}
                        >
                          {targetAddress(row)}
                        </Link>
                      </td>
                      <td className="p-3 text-[var(--color-text-muted)]">
                        {[
                          row.propertyType
                            ? PROPERTY_TYPE_LABELS[
                                row.propertyType as keyof typeof PROPERTY_TYPE_LABELS
                              ]
                            : null,
                          row.rooms ? `${row.rooms} חד׳` : null,
                          row.areaSqm ? `${row.areaSqm} מ״ר` : null,
                          row.priceAgorot ? formatPrice(row.priceAgorot) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="p-3">
                        <span>{recruitmentSourceLabel(row.source)}</span>
                        {/*
                          ‏הקישור נפתח בלשונית חדשה, ו-`noopener noreferrer`
                          אינו קישוט: הכתובת הוזנה על ידי משתמש, והעמוד שנפתח
                          אינו אמור לקבל גישה לחלון של המערכת.
                        */}
                        {host ? (
                          <>
                            {" · "}
                            <a
                              href={row.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              {host}
                            </a>
                          </>
                        ) : null}
                      </td>
                      <td className="p-3 text-[var(--color-text-muted)]">
                        {row.ownerName ?? "—"}
                        {row.ownerPhone ? (
                          <>
                            <br />
                            {/*
                              ‏`dir="ltr"` על המספר עצמו: בלעדיו ה-`+` של
                              הקידומת הבינלאומית נדחף לקצה השני ונקרא
                              „972…+” — מספר שנראה שגוי.
                            */}
                            <a
                              href={`tel:${row.ownerPhone}`}
                              dir="ltr"
                              className="inline-block underline-offset-2"
                            >
                              {row.ownerPhone}
                            </a>
                          </>
                        ) : null}
                      </td>
                      <td className="p-3">
                        {mayEdit ? (
                          <select
                            className="mv-select"
                            value={row.status}
                            aria-label={`שלב הגיוס — ${targetAddress(row)}`}
                            onChange={(event) => void changeStatus(row.id, event.target.value)}
                          >
                            {RECRUITMENT_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {recruitmentStatusLabel(status)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          recruitmentStatusLabel(row.status)
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.convertedPropertyId ? (
                            <Link
                              href={`/properties/${row.convertedPropertyId}`}
                              className="underline underline-offset-2"
                            >
                              לכרטיס הנכס
                            </Link>
                          ) : canConvertToProperty(row.status) && mayCreate ? (
                            <Button
                              type="button"
                              disabled={converting === row.id}
                              onClick={() => void convert(row.id)}
                            >
                              {converting === row.id ? "ממיר…" : "המר לנכס שלי"}
                            </Button>
                          ) : (
                            <span className="text-sm text-[var(--color-text-muted)]">
                              זמין אחרי „גויס”
                            </span>
                          )}

                          {/*
                            ‏האישור נפתח **בשורה עצמה** ולא ב-`confirm()`:
                            תיבת הדפדפן אינה אומרת איזו שורה נמחקת, ובטבלה
                            של עשרים שורות זו בדיוק השאלה. הכפתור האדום
                            מופיע רק אחרי הלחיצה הראשונה.
                          */}
                          {mayDelete ? (
                            confirmingDelete === row.id ? (
                              <>
                                <button
                                  type="button"
                                  className="mv-btn-plain"
                                  style={{
                                    color: "var(--color-danger)",
                                    borderColor: "var(--color-danger)",
                                  }}
                                  disabled={deleting === row.id}
                                  onClick={() => void remove(row.id)}
                                >
                                  {deleting === row.id ? "מוחק…" : "כן, מחקו"}
                                </button>
                                <button
                                  type="button"
                                  className="mv-btn-plain"
                                  onClick={() => setConfirmingDelete(null)}
                                >
                                  ביטול
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="mv-btn-plain"
                                aria-label={`מחיקת ${targetAddress(row)}`}
                                onClick={() => setConfirmingDelete(row.id)}
                              >
                                מחיקה
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*
        ‏רשימה שנחתכת בלי לומר זאת נראית כמו רשימה שלמה — וייבוא
        אחד יכול להביא יותר מהתקרה. הסינון רץ בשרת, ולכן צמצומו הוא
        גם התשובה: מה שמסונן נכנס בשלמותו.
      */}
      {capped ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          מוצגים {PAGE_CAP} הנכסים שעודכנו לאחרונה. צמצמו את הסינון כדי לראות את השאר.
        </p>
      ) : null}

      {/*
        ‏החלונית נטענת רק כשיש שורה פתוחה, ומפתחה הוא המזהה: מעבר
        ‏לשורה אחרת מרכיב טופס חדש. `defaultValue` נקרא פעם אחת
        ‏בעלייה, וטופס ממוחזר היה מציג את הנכס הקודם בשדות.
      */}
      {openRow === null ? null : (
        <TargetDialog
          key={openRow.id}
          target={openRow}
          mayEdit={mayEdit}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            /*
             * ‎**נסגרת השורה שנשמרה, ולא „מה שפתוח עכשיו”** (ביקורת
             * ‏Codex, P2).
             *
             * ‏השמירה אינה חוסמת את הסגירה: אפשר ללחוץ X או Escape
             * ‏בזמן שה-PATCH באוויר, ולפתוח שורה אחרת. אז הקריאה
             * ‏החוזרת של השמירה הראשונה הגיעה, ו-`setOpenId(null)`
             * ‏סתמי היה סוגר את **השורה החדשה** — באמצע הקלדה בה.
             * ‏עדכון פונקציונלי שמשווה למזהה שנשמר עושה כלום כשכבר
             * ‏עברו הלאה.
             */
            const saved = openRow.id;
            setOpenId((current) => (current === saved ? null : current));
            void load().catch(() => setError("הרשימה לא רועננה — רעננו את העמוד"));
          }}
        />
      )}
    </div>
  );
}
