"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { MATCHABLE_PROPERTY_STATUSES, type PropertyStatus } from "@metavchim/shared";
import { API_BASE, apiGet, apiList, apiPost } from "@/lib/api";
import { formatDate, formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import {
  IconDoc,
  IconHome,
  IconMic,
  IconPlus,
  IconSearch,
  IconSheet,
  IconUsers,
  IconX,
} from "../icons";
import { ExclusivityWatch } from "./exclusivity-watch";
import { CapNote, FilterChips, FilterSelect, SortSelect } from "../list-controls";
import {
  EMPTY_FILTERS,
  ListFilters,
  filtersToQuery,
  hasActiveFilters,
  type ListFilterValues,
} from "../list-filters";
import { Notice } from "../notice";
import { readinessBand } from "@/lib/readiness";

/**
 * מסך הנכסים לפי קובץ העיצוב: צ'יפי ערים לסינון, טבלת grid עם תג
 * "חדש", פס מוכנות צבעוני ועמודת מספר ההתאמות.
 */

interface PropertyRow {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  propertyType?: string;
  rooms?: number;
  priceAgorot?: number;
  /*
   * הטיפוס מהחבילה, כדי שמפת התוויות תוכל להיות ממצה: סטטוס חדש
   * בסכמה ייפול בקומפילציה במקום להיות מוצג כמפתח באנגלית.
   */
  status: PropertyStatus;
  readinessScore: number;
  missingFields: string[];
  thumbnailUrl?: string;
  suggestedMatchCount?: number;
  createdAt?: string;
}

function addressOf(p: PropertyRow): string {
  return [p.street, p.neighborhood].filter(Boolean).join(", ") || p.city || "ללא כתובת";
}

/** נכס שנקלט בשבוע האחרון מסומן "חדש" ומקבל רקע ירקרק, כמו בעיצוב. */
function isNew(p: PropertyRow): boolean {
  if (!p.createdAt) return false;
  return Date.now() - new Date(p.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000;
}

/**
 * הדומיין של סטטוס הנכס (SPEC-2 §4).
 *
 * ‎**„טיוטה” הוא ניטרלי ולעולם לא ענבר** — החבילה מדגישה זאת
 * פעמיים, ובצדק: טיוטה אינה תקלה ואינה דורשת תשומת לב דחופה,
 * היא פשוט נכס שטרם הושלם. ענבר היה קורא לה „טפל בי עכשיו”.
 */
function statusDomain(status: string): string {
  if (status === "active") return "mv-domain-green";
  return "mv-domain-neutral";
}

/*
 * שתי העמודות האחרונות התרחבו יחד עם התוכן שנכנס אליהן: המוכנות
 * נושאת כעת שתי שורות („‎82%” ומתחתיו „חסרים 2 שדות”), והסטטוס
 * וההתאמות הפכו מטקסט לגלולות. ‎0.6fr‎ היה חותך „12 התאמות”.
 */
/*
 * ‎**שש עמודות, בסדר של הצילום.** העיר, החדרים והסוג ירדו לשורת
 * המשנה שמתחת לכתובת, ולכן `2.4fr` לעמודת הנכס — היא נושאת עכשיו
 * שתי שורות. העמודה האחרונה היא תאריך, לא תווית כפתור, ולכן היא
 * צרה יותר והרוחב חזר לכתובת.
 */
const GRID = "2.4fr 0.9fr 1.4fr 1fr 1fr 0.9fr";

const SORTS: [string, string][] = [
  ["newest", "חדשים קודם"],
  ["price_desc", "מחיר גבוה→נמוך"],
  ["price_asc", "מחיר נמוך→גבוה"],
  ["rooms_desc", "הכי הרבה חדרים"],
  ["readiness_asc", "הכי פחות מוכנים"],
];

function sortRows(rows: PropertyRow[], sort: string): PropertyRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "price_desc":
      return sorted.sort((a, b) => (b.priceAgorot ?? -1) - (a.priceAgorot ?? -1));
    case "price_asc":
      return sorted.sort((a, b) => (a.priceAgorot ?? Infinity) - (b.priceAgorot ?? Infinity));
    case "rooms_desc":
      return sorted.sort((a, b) => (b.rooms ?? 0) - (a.rooms ?? 0));
    case "readiness_asc":
      return sorted.sort((a, b) => a.readinessScore - b.readinessScore);
    default:
      return sorted; // ה-API כבר מחזיר חדשים קודם
  }
}

/**
 * ‎**המשפט שמתחת לכותרת — מצב המאגר, ולא ספירת שורות.**
 *
 * „‏4 נכסים” אינו אומר דבר. „‏4 פעילים · אחד עדיין בטיוטה” אומר מה
 * מחכה. הנוסח נבנה מהמצב עצמו ולא מתבנית קבועה: משרד בלי טיוטות
 * אינו מקבל „0 בטיוטה”, כי אפס אינו ידיעה.
 */
function summaryLine(items: PropertyRow[], truncated: boolean): string {
  const active = items.filter((p) => p.status === "active").length;
  const drafts = items.filter((p) => p.status === "draft").length;
  const parts = [`${active} נכסים פעילים`];
  if (drafts === 1) parts.push("אחד עדיין בטיוטה");
  else if (drafts > 1) parts.push(`${drafts} עדיין בטיוטה`);
  /*
   * ‎**היקף המספר נאמר כשהוא אינו כל המאגר.**
   *
   * הבקשה מוגבלת ל-100, והמסך הציג את המניין כאילו הוא של המשרד
   * כולו — כלומר משרד עם 400 נכסים ראה „4 פעילים” וזה פשוט לא נכון
   * (ביקורת Codex). הסיכום נשאר שימושי, אבל אומר על מה הוא מדבר.
   */
  return truncated ? `${parts.join(" · ")} — מבין 100 שנטענו` : parts.join(" · ");
}

/** אריח מונה אחד — מספר גדול, ומתחתיו מה שהוא אומר. */
function StatTile({
  domain,
  icon,
  label,
  value,
  note,
}: {
  domain: string;
  icon: ReactNode;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className={`mv-stat-tile ${domain}`}>
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44" aria-hidden="true">
          {icon}
        </span>
        <h2 className="mv-card-head__title">{label}</h2>
      </div>
      <p
        className="m-0 mt-2"
        style={{
          fontSize: "var(--type-metric)",
          fontWeight: 900,
          letterSpacing: "var(--type-metric-track)",
        }}
      >
        {value}
      </p>
      <p className="m-0 mt-1" style={{ fontSize: "var(--type-caption-lg)" }}>
        {note}
      </p>
    </div>
  );
}

/**
 * ארבעת המונים שבראש המסך.
 *
 * ‎**כולם נגזרים מהרשימה שכבר נטענה** — אין קריאה נוספת, ואין מספר
 * שיכול לסטות ממה שמוצג מתחתיו.
 *
 * ‎**אפס אינו נראה ככישלון**: אריח שערכו אפס עובר לניטרלי, והכיתוב
 * שמתחתיו אומר „הכל טופל” ולא „אין”.
 */
function PropertyStats({
  items,
  truncated,
}: {
  items: PropertyRow[];
  truncated: boolean;
}) {
  const active = items.filter((p) => p.status === "active");
  const ready = active.filter((p) => p.missingFields.length === 0).length;
  const matches = items.reduce((sum, p) => sum + (p.suggestedMatchCount ?? 0), 0);
  const busiest = items.reduce((top, p) => Math.max(top, p.suggestedMatchCount ?? 0), 0);
  const drafts = items.filter((p) => p.status === "draft");
  /*
   * ‎**רק נכס שיכול היה לקבל התאמות נספר כ„בלי התאמות”.**
   *
   * נכס שנמכר, הושכר, הוקפא או אורכב **אינו מקבל התאמות מלכתחילה**:
   * ‎`matching.service` מוחק את ההצעות שלו ואינו מייצר חדשות. ספירתו
   * כאן הייתה מנפחת לנצח אזהרה שאומרת „כדאי לבדוק מחיר או דרישות”
   * על נכס שאין מה לבדוק בו (ביקורת Codex).
   *
   * הרשימה מיובאת מהחבילה ואינה נכתבת כאן מחדש — היא **אותה** רשימה
   * שהשרת מחליט לפיה, ולכן סטטוס שיתווסף לה יגיע לשני הצדדים.
   */
  const lonely = items.filter(
    (p) =>
      (MATCHABLE_PROPERTY_STATUSES as readonly string[]).includes(p.status) &&
      (p.suggestedMatchCount ?? 0) === 0,
  );

  return (
    <div
      className="mb-[18px] grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}
    >
      <StatTile
        domain="mv-domain-blue"
        icon={<IconHome s={20} />}
        label="נכסים פעילים"
        value={active.length}
        note={
          active.length === 0
            ? "אין נכס פעיל כרגע"
            : ready === active.length
              ? "כולם מוכנים לשיווק"
              : `${ready} מהם מוכנים לשיווק`
        }
      />
      <StatTile
        domain={matches > 0 ? "mv-domain-violet" : "mv-domain-neutral"}
        icon={<IconUsers s={20} />}
        label="התאמות פתוחות"
        value={matches}
        note={
          matches === 0
            ? "עוד לא חושבו התאמות"
            : busiest > 1
              ? `${busiest} מהן על נכס אחד`
              : "אחת לכל נכס"
        }
      />
      <StatTile
        domain={drafts.length > 0 ? "mv-domain-peach" : "mv-domain-neutral"}
        icon={<IconDoc s={20} />}
        label="טיוטה להשלמה"
        value={drafts.length}
        note={
          drafts.length === 0
            ? "אין טיוטות פתוחות"
            : drafts.length === 1
              ? addressOf(drafts[0]!)
              : "פתחו את הרשימה כדי להשלים"
        }
      />
      {/*
        ‎**„בלי התאמות” ולא „בלי הצעה שנשלחה”.**

        בצילום האריח הרביעי סופר נכסים שטרם נשלחה עליהם הצעה. השדה
        הזה **אינו חוזר מרשימת הנכסים**, ומספר שאין לו מקור הוא מספר
        מומצא. „בלי התאמות” הוא אותה שאלה — איזה נכס אף אחד עדיין לא
        נגע בו — ונגזר ממה שכן נטען.
      */}
      <StatTile
        domain={lonely.length > 0 ? "mv-domain-peach" : "mv-domain-neutral"}
        icon={<IconSearch s={20} />}
        label="נכסים בלי התאמות"
        value={lonely.length}
        note={lonely.length === 0 ? "לכל נכס יש למי להציע" : "כדאי לבדוק מחיר או דרישות"}
      />
      {/*
        משפט אחד על כל הארבעה, ולא סייג בכל אריח: הם נגזרים מאותה
        רשימה, ולכן ההיקף שלהם זהה.
      */}
      {truncated ? (
        <p
          className="m-0"
          style={{
            gridColumn: "1 / -1",
            fontSize: "var(--type-caption)",
            color: "var(--color-text-muted)",
          }}
        >
          המונים מחושבים על 100 הנכסים שנטענו, ולא על כל המאגר. צמצמו את הסינון כדי
          לראות קבוצה מדויקת.
        </p>
      ) : null}
    </div>
  );
}

function Thumb({ url }: { url?: string }) {
  if (url) {
    // img רגיל בכוונה: מוזרם דרך ה-API, לא לאופטימיזציית Next
    return <img src={API_BASE + url} alt="" className="h-20 w-24 rounded-lg object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-20 w-24 items-center justify-center rounded-lg text-xl"
      style={{ background: "var(--color-field)", color: "var(--color-text-muted)" }}
    >
      <IconHome s={20} />
    </span>
  );
}

export default function PropertiesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const canImport = useFeature("data_io");
  const canVoice = useFeature("voice_intake");
  const router = useRouter();
  const [items, setItems] = useState<PropertyRow[] | null>(null);
  /*
   * ‎**האם יש עוד מעבר למה שנטען.** מהשרת עצמו (`nextCursor`) ולא
   * מ-`items.length === 100`: הניחוש טועה בדיוק על מאגר של 100.
   */
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("הכל");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [filters, setFilters] = useState<ListFilterValues>(EMPTY_FILTERS);
  /*
   * הנכסים שסומנו להעלאה מרוכזת לרשת — Set של מזהים, מאותה סיבה
   * שברשימת הקונים: הסינון משנה את הרשימה תוך כדי בחירה.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  /*
   * הסינון רץ בשרת ולא בדפדפן.
   *
   * הצ'יפים של הערים והמיון עובדים על מה שכבר נטען, וזה בסדר לרשימה
   * של מאה נכסים. חיפוש טקסט וטווחים הם משהו אחר: משרד עם אלפי
   * נכסים חייב שהסינון יקרה במסד, אחרת הוא מסנן רק את המאה
   * הראשונים ומחזיר "אין תוצאות" על נכס שקיים.
   */
  useEffect(() => {
    if (authLoading) return;
    setItems(null);
    apiGet<{ items: PropertyRow[]; nextCursor?: string | null }>(
      `/properties?limit=100${filtersToQuery(filters)}`,
    )
      .then((res) => {
        setItems(apiList(res.items, "items"));
        setTruncated(res.nextCursor !== undefined && res.nextCursor !== null);
      })
      .catch(() => setError("טעינת הנכסים נכשלה"));
  }, [authLoading, filters]);

  /* צ'יפי הערים נבנים מהנתונים עצמם — הערים שבאמת יש בהן נכסים */
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of items ?? []) {
      if (p.city) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    }
    return ["הכל", ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 6)];
  }, [items]);

  const visible = useMemo(() => {
    if (!items) return [];
    const filtered = items.filter(
      (p) =>
        // החיפוש החופשי כבר סונן בשרת; כאן נשארו רק הצ'יפים והמיון
        (city === "הכל" || p.city === city) &&
        (!status || p.status === status) &&
        (!type || p.propertyType === type),
    );
    return sortRows(filtered, sort);
  }, [items, city, status, type, sort]);

  /* הבחירה מוצגת רק למי שרשאי לפרסם לרשת — כמו הגישה במסך הקונים */
  const mayShare = can(user, "collaboration.share");
  const mayDelete = can(user, "properties.delete");
  /*
   * ‎**הבחירה שייכת לשתי היכולות, ולא לשיתוף בלבד.**
   *
   * תיבות הסימון היו מותנות ב-`mayShare` — ולכן מי שרשאי למחוק ואינו
   * רשאי לפרסם לרשת לא ראה תיבות כלל, כלומר המחיקה המרוכזת הייתה
   * קיימת בשרת ובלתי נגישה במסך. אותו מבנה בדיוק כמו במסך הקונים.
   */
  const maySelect = mayShare || mayDelete;
  const selectedVisible = visible.filter((p) => selected.has(p.id));
  /* סך ההתאמות שכבר חושבו — הידיעה שבכותרת, מאותה רשימה שנטענה */
  const openMatches = (items ?? []).reduce((sum, p) => sum + (p.suggestedMatchCount ?? 0), 0);
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  function toggle(id: string): void {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((p) => p.id)));
  }

  /**
   * העלאה מרוכזת לרשת — התאום של shareSelected במסך הקונים.
   * השרת מפרסם כל נכס במסלול הבודד (סטטוס, כפילות, מכסה), בברירת
   * המחדל של חלוקת העמלה ועם תיאור השיווק של הנכס.
   */
  async function shareSelected(): Promise<void> {
    const ids = selectedVisible.map((p) => p.id);
    if (ids.length === 0) return;
    if (!window.confirm(`לפרסם ${ids.length} נכסים לרשת השיתופים? יפורסמו בלי כתובת מדויקת ובלי פרטי בעלים, בחלוקת עמלה 50/50.`)) return;

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    try {
      const res = await apiPost<{ results: { id: string; ok: boolean; error?: string }[] }>(
        "/collaboration/listings/bulk",
        { propertyIds: ids },
      );
      const failed = res.results.filter((r) => !r.ok);
      const reasons = [...new Set(failed.map((r) => r.error ?? "הפרסום נכשל"))];
      setBulkNote(
        failed.length === 0
          ? `${res.results.length} נכסים פורסמו לרשת`
          : `${res.results.length - failed.length} פורסמו, ${failed.length} לא — ${reasons.join(" · ")}`,
      );
      setSelected(new Set());
    } catch {
      setError("הפרסום לרשת נכשל — נסו שוב");
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * מחיקה מרוכזת — ארכיון, או מחיקה לצמיתות.
   *
   * ברירת המחדל היא ארכיון, בדיוק כמו במחיקה בודדת: נכס שנמכר הוא
   * היסטוריה עסקית. הכפתור השני קיים בשביל המקרה שבשבילו הפעולה
   * נבנתה — ייבוא שגוי או כפילות שצריכים להיעלם.
   */
  async function removeSelected(permanent: boolean): Promise<void> {
    const ids = selectedVisible.map((p) => p.id);
    if (ids.length === 0) return;

    /*
     * ‎**הגילוי לפני האישור.**
     *
     * המחיקה לצמיתות מוחקת גם כרטיסי אדם שהנכס הזה הוא הקישור
     * האחרון אליהם — בעלים או דייר, על שמם וטלפוניהם. מתווך שמנקה
     * כפילות אינו מתכוון לזה, ולכן זה נאמר **לפני**.
     *
     * וכשהבדיקה נכשלת המחיקה **נחסמת**: „לא ידוע” לעולם אינו מוצג
     * כ„לא יימחק”. אותה הכרעה כמו במסך הקונים.
     */
    let disclosure = "";
    if (permanent) {
      setBulkBusy(true);
      setError(null);
      try {
        const preview = await apiPost<{ contacts: number }>(
          "/properties/bulk-deletion-preview",
          { ids },
        );
        disclosure =
          preview.contacts === 0
            ? ""
            : preview.contacts === 1
              ? "יימחק גם כרטיס אדם אחד שהנכס הזה הוא הקישור האחרון אליו במשרד — כולל שם, טלפונים והיסטוריית התקשורת."
              : `יימחקו גם ${preview.contacts} כרטיסי אדם שהנכסים האלה הם הקישור האחרון אליהם במשרד — כולל שם, טלפונים והיסטוריית התקשורת.`;
      } catch {
        setError("בדיקת המחיקה נכשלה — לא נמחק דבר. נסו שוב.");
        return;
      } finally {
        setBulkBusy(false);
      }
    }

    const question = permanent
      ? [
          `למחוק לצמיתות ${ids.length} נכסים? הפעולה אינה הפיכה, וכל ההיסטוריה שלהם תימחק.`,
          ...(disclosure === "" ? [] : [disclosure]),
        ].join("\n")
      : `להעביר ${ids.length} נכסים לארכיון? הם יורדו מהרשימות וההיסטוריה תישמר.`;
    if (!window.confirm(question)) return;

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    try {
      const res = await apiPost<{ removed: number; skipped: number }>(
        "/properties/bulk-delete",
        { ids, permanent },
      );
      setBulkNote(
        res.skipped === 0
          ? `${res.removed} נכסים ${permanent ? "נמחקו" : "הועברו לארכיון"}`
          : `${res.removed} ${permanent ? "נמחקו" : "הועברו לארכיון"}, ${res.skipped} דולגו — נכס של סוכן אחר, או כזה שכבר נמחק`,
      );
      setSelected(new Set());
    } catch {
      setError("המחיקה נכשלה — נסו שוב");
      setBulkBusy(false);
      return;
    }

    /*
     * ‎**הרענון בנפרד מהמחיקה, ולא באותו `try`.**
     *
     * כישלון של הרענון — רשת, או גוף תשובה חסר — היה מדווח „המחיקה
     * נכשלה” על מחיקה שהצליחה, ומזמין את המתווך למחוק שוב.
     */
    setItems(null);
    try {
      const fresh = await apiGet<{ items: PropertyRow[]; nextCursor?: string | null }>(
        `/properties?limit=100${filtersToQuery(filters)}`,
      );
      setItems(apiList(fresh.items, "items"));
      setTruncated(fresh.nextCursor !== undefined && fresh.nextCursor !== null);
    } catch {
      setError("הרשימה לא רועננה — רעננו את העמוד");
    } finally {
      setBulkBusy(false);
    }
  }

  const filtering =
    hasActiveFilters(filters) ||
    city !== "הכל" ||
    status !== "" ||
    type !== "" ||
    sort !== "newest";

  return (
    <>
      {/* לפני הסינון והרשימה: בלעדיות שנגמרת היא נכס שעובר למתחרה,
          וזו הידיעה היחידה במסך הזה שיש לה תאריך תפוגה */}
      <ExclusivityWatch />

      {/*
        ‎**כותרת המסך, ומה שאפשר לעשות בו — שורה אחת.**

        הכותרת נשאה עד כה רק את שם המסך שבסרגל הצד, והפעולות ישבו
        בשורת הצ'יפים. בצילום הן צמודות לכותרת, ומתחתיה משפט שאומר
        **מה מצב המאגר** — לא כמה שורות יש, אלא מה מחכה.
      */}
      <div className="mb-[18px] flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1
            className="m-0"
            style={{
              fontSize: "var(--type-screen-title)",
              fontWeight: 900,
              letterSpacing: "-0.03em",
            }}
          >
            נכסים
            {/* הנקודה של המותג, כמו בסרגל הצד */}
            <span aria-hidden="true" style={{ color: "var(--color-primary)" }}>
              .
            </span>
          </h1>
          {/*
            ‎**המשפט נבנה ממה שנטען, ואינו מוצג לפני שיש מה לומר.**

            ‎`items === null` הוא „עוד לא ידוע”, ומשפט שנכתב עליו היה
            אומר „0 נכסים פעילים” על מאגר מלא — בדיוק ההסוואה ששער
            ‎`verify:lists` קיים כדי למנוע.
          */}
          {items === null ? null : (
            <p
              className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
              style={{ fontSize: "var(--type-body-sm)", color: "var(--color-text-muted)" }}
            >
              <span>{summaryLine(items, truncated)}</span>
              {openMatches > 0 ? (
                <>
                  <span aria-hidden="true">|</span>
                  <Link
                    href="/matches"
                    className="font-bold no-underline"
                    style={{ color: "var(--domain-violet-fg)" }}
                  >
                    {openMatches} התאמות מחכות לשליחה
                  </Link>
                </>
              ) : null}
            </p>
          )}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2.5">
          {/* כפתור שמוביל לפיצ'ר שאינו במסלול נחסם בשרת ממילא —
              עדיף לא להציג אותו מאשר להסביר 403 אחרי בחירת קובץ */}
          {canImport ? (
            <Link href="/import" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "var(--type-caption)" }}>
              <IconSheet s={15} /> ייבוא מאקסל
            </Link>
          ) : null}
          {canVoice ? (
            <Link href="/voice" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "var(--type-caption)" }}>
              <IconMic s={15} /> נכס בקול
            </Link>
          ) : null}
          <Link href="/properties/new" className="mv-btn-action" style={{ minHeight: 38 }}>
            <IconPlus s={15} /> נכס חדש
          </Link>
        </div>
      </div>

      {/*
        החיפוש והצ'יפים בכרטיס אחד — כך בצילום, וזה גם נכון: שניהם
        מצמצמים את אותה רשימה, ושורה חופשית מתחת לכרטיס נראתה כמו
        עוד אזור.
      */}
      <ListFilters
        values={filters}
        onApply={setFilters}
        searchLabel="חיפוש נכס"
        searchHint="כתובת, תיאור, סוג נכס או הערה"
        priceLabel="מחיר"
        card={{ example: 'למשל: "3 חדרים בבני ברק עד 2.2 מיליון"' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            label="סינון לפי עיר"
            value={city}
            onChange={setCity}
            options={cities.map((c) => [c, c] as [string, string])}
          />
        </div>
      </ListFilters>

      {/*
        ‎**ארבעה מונים — מה מחכה, ולא כמה שורות יש.**

        כולם נגזרים מהרשימה שכבר נטענה, בלי קריאה נוספת. `null`
        פירושו „עוד לא ידוע”, ואז אין כרטיסים בכלל: אריח שמראה „0”
        על טעינה שטרם הסתיימה הוא בדיוק אותו שקר של רשימה ריקה.
      */}
      {items === null ? null : <PropertyStats items={items} truncated={truncated} />}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : items === null ? (
        <p aria-live="polite">טוען נכסים…</p>
      ) : items.length === 0 && !hasActiveFilters(filters) ? (
        /*
         * **מצב „אין נכסים בכלל” יושב כאן, ולא בתוך הרשימה.**
         *
         * הענף הזה קודם לסרגל הסינון, וזה נכון: למשרד שאין לו נכסים
         * אין מה לסנן, וצ׳יפים ריקים מעל כרטיס ריק הם רעש.
         *
         * בגרסה הקודמת כתבתי מצב „אין נכסים” משופר **בתוך** בלוק
         * הרשימה, ולא שמתי לב שהענף הזה תופס את המקרה לפניו. התוצאה
         * הייתה קוד מת: משרד חדש קיבל את הנוסח הישן, והפעולה שהוספתי
         * („קליטה בקול”) לא הופיעה לעולם. הנוסח המשופר עבר לכאן
         * (ביקורת Codex).
         */
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-1 text-[length:var(--type-screen-title)] font-black">עוד לא הוספת נכסים</p>
          <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
            כל נכס שתוסיפו ייבדק מול הקונים שבמאגר, וההתאמות יחושבו לבד.
          </p>
          {/*
           * ‎`mv-button` ולא `mv-btn-action`/`mv-btn-plain` — יעד מגע.
           *
           * ‎§26 דורש „buttons 46 and up”, ושני הכפתורים שכתבתי כאן
           * היו מתחת ל-44: ‎`mv-btn-action` הוא 42, ו-`mv-btn-plain`
           * הוא ריפוד 6px סביב טקסט 14 — כ-34 בפועל. דווקא הפעולה
           * הזו מיועדת לשימוש במובייל תוך כדי תנועה (ביקורת Codex).
           *
           * ‎`mv-button` הוא 46 בזכות `min-height`, כלומר גם טקסט
           * שנשבר לשתי שורות אינו מקטין את יעד המגע.
           */}
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Link href="/properties/new" className="mv-button mv-button--primary">
              <IconPlus s={16} /> נכס חדש
            </Link>
            {canVoice ? (
              <Link href="/voice" className="mv-button mv-button--secondary">
                <IconMic s={16} /> קליטה בקול
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {/*
            ‎**כרטיס אחד לרשימה: כותרת, פקדים, שורות ופעולות.**

            הפקדים ישבו עד כה בסרגל נפרד מעל הרשימה, וסרגל הבחירה
            הופיע ונעלם בין שניהם — כלומר הרשימה „קפצה” בכל בחירה.
            בצילום הכל בכרטיס אחד, והפעולות בתחתיתו קבועות.
          */}
          <div className="mv-card mv-card--pad">
            <div className="mv-card-head flex-wrap">
              <span className="mv-tile mv-tile--44 mv-domain-blue" aria-hidden="true">
                <IconHome s={20} />
              </span>
              <h2 className="mv-card-head__title">
                {visible.length} נכסים
              </h2>
              <span
                style={{ fontSize: "var(--type-body-sm)", color: "var(--color-text-muted)" }}
              >
                {/*
                  מה שהמיון עושה, במילים. „מסודר לפי” ולא „מיון:” —
                  זו הצהרה על מה שרואים, לא שם של פקד.
                */}
                מסודר לפי {(SORTS.find(([key]) => key === sort) ?? SORTS[0])?.[1] ?? ""}
                {visible.length === items.length
                  ? null
                  : ` · מתוך ${items.length}`}
              </span>

              <span className="ms-auto flex flex-wrap items-center gap-2">
                {maySelect ? (
                  <label className="mv-btn-plain" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      disabled={visible.length === 0}
                    />
                    בחירת הכל
                  </label>
                ) : null}
                <FilterSelect
                  label="סינון לפי סטטוס"
                  value={status}
                  onChange={setStatus}
                  allLabel="כל הסטטוסים"
                  options={Object.entries(STATUS_LABELS)}
                />
                <FilterSelect
                  label="סינון לפי סוג נכס"
                  value={type}
                  onChange={setType}
                  allLabel="כל הסוגים"
                  options={Object.entries(PROPERTY_TYPE_LABELS)}
                />
                <SortSelect value={sort} onChange={setSort} options={SORTS} />
                {/*
                  ‎**ניקוי הסינון נשאר**, אף שאינו בצילום: בלעדיו
                  מתווך שסינן לפי עיר וסטטוס צריך לאפס שלושה פקדים
                  אחד-אחד כדי לראות שוב את כל המאגר.
                */}
                {filtering ? (
                  <button
                    type="button"
                    className="mv-filter-clear"
                    onClick={() => {
                      setFilters(EMPTY_FILTERS);
                      setCity("הכל");
                      setStatus("");
                      setType("");
                      setSort("newest");
                    }}
                  >
                    <IconX s={14} /> נקה סינון
                  </button>
                ) : null}
              </span>
            </div>

          {visible.length === 0 ? (
            /*
             * כאן **תמיד** „הסינון לא החזיר כלום”, ולא „אין נכסים”.
             *
             * המקרה השני נתפס בענף שלפני סרגל הסינון. אם הגענו לכאן
             * והרשימה ריקה, בהכרח פעיל מסנן כלשהו — שרת או צ׳יפ —
             * ולכן אין כאן תנאי, ואין ענף שני שלעולם לא ירוץ.
             */
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-1 text-[length:var(--type-screen-title)] font-black">אין נכסים שמתאימים לסינון</p>
              <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
                הסינון הנוכחי לא מחזיר אף נכס. נסו לצמצם אותו או לנקות אותו לגמרי.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setCity("הכל");
                  setStatus("");
                  setType("");
                }}
              >
                ניקוי הסינון
              </Button>
            </div>
          ) : (
            <>
              {bulkNote ? <Notice tone="success">{bulkNote}</Notice> : null}

              <div className="mv-list-switch">
              {/*
                כרטיסים עד 1280, טבלה מעליו — **ולא 640 ולא 1024.**

                הטבלה נפתחה תחילה ב-`sm`, ובטווח 640–1023 נשארו לשתי
                העמודות האחרונות כשישים פיקסלים כל אחת. כל עוד הן
                נשאו טקסט זה עבד; מרגע שהפכתי אותן לגלולות — שהן
                ‎`white-space: nowrap` עם 22 פיקסלים ריפוד אופקי —
                „12 התאמות” ותוויות סטטוס ארוכות נחתכות או דורסות
                את העמודה השכנה (ביקורת Codex).

                ‎**‎`lg` היה התיקון הגרוע ביותר האפשרי, ולא במקרה.**
                ‎1024 הוא בדיוק הרוחב שבו `.mv-sidebar` נכנס ותופס
                250 פיקסלים. כלומר רוחב התוכן **מצטמצם** שם:
                ב-1023 הכרטיסים מקבלים ‎1023−68 ≈ 955‎, וב-1024
                הטבלה נפתחת על ‎1024−250−68 ≈ 706‎. בחרתי את הנקודה
                היחידה שבה המעבר לפריסה הרחבה נעשה על שטח צר יותר
                (ביקורת Codex).

                ‎1280 מחזיר ‎1280−250−68 ≈ 962‎ — הרוחב הראשון שעובר
                את מה שתצוגת הכרטיסים כבר קיבלה, וכ-115 פיקסלים לכל
                עמודת ‎`1fr`‎, די לגלולה השלמה.

                ולא גלילה אופקית: בטאבלט כרטיס קריא עדיף על טבלה
                שצריך לגרור, וזה גם הנימוק המקורי של תצוגת הכרטיסים
                (docs/06 §1.5).
              */}
              <ul className="mv-list-as-cards flex-col gap-3">
                {visible.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex gap-3">
                      <Thumb url={p.thumbnailUrl} />
                      <div className="min-w-0 flex-1">
                        {maySelect ? (
                          <input
                            type="checkbox"
                            className="me-2 align-middle"
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                            aria-label={`בחר את ${addressOf(p)}`}
                          />
                        ) : null}
                        <Link href={`/properties/${p.id}`} className="font-bold underline">
                          {addressOf(p)}
                        </Link>
                        {isNew(p) ? (
                          <span className="mv-tag ms-2" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                            חדש
                          </span>
                        ) : null}
                        <p className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                          {/*
                            הכרטיס נושא את אותן עובדות כמו הטבלה —
                            כולל תאריך הקליטה, שנוסף שם כעמודה.
                          */}
                          {[
                            p.city,
                            p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : null,
                            p.rooms ? `${p.rooms} חד׳` : null,
                            formatPrice(p.priceAgorot),
                            p.createdAt ? `נקלט ${formatDate(p.createdAt)}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-sm">
                          <span className="mv-progress">
                            <span
                              style={{
                                width: `${p.readinessScore}%`,
                                background: readinessBand(p.readinessScore).bar,
                              }}
                            />
                          </span>
                          <span
                            className="font-bold"
                            style={{ color: readinessBand(p.readinessScore).text, fontSize: "var(--type-caption)" }}
                          >
                            {p.readinessScore}%
                          </span>
                        </p>
                        {/*
                          שדות החובה והסטטוס — **הכרטיס נושא את אותן
                          עובדות כמו הטבלה.**

                          כשהעברתי את נקודת המעבר מ-640 ל-1280, כל מי
                          שנמצא בין השתיים עבר מהטבלה לכרטיס. הטבלה
                          מציגה סטטוס, שדות חסרים ומצב „אין עדיין”
                          להתאמות; הכרטיס לא הציג אף אחד מהם. כלומר
                          פתרתי בעיית רוחב במחיר של מידע, ודווקא
                          למשתמשי הטאבלט ולרוחב 1024 שהוא נפוץ
                          (ביקורת Codex).

                          הניסוח והדומיינים נלקחים מאותן פונקציות
                          שמזינות את הטבלה, ולא נכתבים כאן מחדש.
                        */}
                        <p className="mt-1" style={{ fontSize: "var(--type-caption)", color: "var(--color-text-muted)" }}>
                          {p.missingFields.length > 0
                            ? `חסרים ${p.missingFields.length} שדות`
                            : "כל השדות מלאים"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`mv-pill ${statusDomain(p.status)}`}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                      {p.suggestedMatchCount ? (
                        <Link
                          href={`/matches?property=${p.id}`}
                          className="mv-pill mv-domain-violet no-underline"
                        >
                          {p.suggestedMatchCount} קונים מתאימים ←
                        </Link>
                      ) : (
                        <span className="mv-pill mv-domain-neutral">אין עדיין</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {/* שולחני: טבלת ה-grid מהעיצוב. הנקודה מנומקת ליד `xl:hidden` */}
              <div className="mv-list-as-table mv-list-card">
                {/*
                  ‎**סדר העמודות של הצילום.** העיר, החדרים והסוג ירדו
                  מעמודות משלהן אל שורת המשנה שמתחת לכתובת — אותן
                  עובדות בדיוק, במקום שבו קוראים אותן ממילא, והרוחב
                  שהתפנה הלך לעמודת הפעולה.
                */}
                <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
                  <span>נכס</span>
                  <span>סטטוס</span>
                  <span>מוכנות לשיווק</span>
                  <span>מחיר</span>
                  <span>התאמות</span>
                  <span>נקלט</span>
                </div>
                {visible.map((p) => {
                  const ready = readinessBand(p.readinessScore);
                  return (
                    /* התיבה לצד השורה ולא בתוכה — השורה כולה כפתור
                       ניווט, ותיבת סימון בתוך כפתור אינה נגישה */
                    <div key={p.id} className="mv-list-select-row">
                      {maySelect ? (
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`בחר את ${addressOf(p)}`}
                        />
                      ) : null}
                    <button
                      type="button"
                      className={`mv-list-row grow${isNew(p) ? " mv-list-row--new" : ""}`}
                      style={{ gridTemplateColumns: GRID }}
                      onClick={() => router.push(`/properties/${p.id}`)}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[length:var(--type-body)] font-bold">
                          <span className="truncate">{addressOf(p)}</span>
                          {isNew(p) ? (
                            <span className="mv-tag" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                              חדש
                            </span>
                          ) : null}
                        </span>
                        {/*
                          העיר, החדרים והסוג — שלוש עמודות שהיו,
                          בשורה אחת מתחת לכתובת. שום עובדה לא ירדה.
                        */}
                        <span
                          className="mt-0.5 block truncate"
                          style={{ fontSize: "var(--type-caption-lg)", color: "var(--color-text-muted)" }}
                        >
                          {[
                            p.city,
                            p.rooms ? `${p.rooms} חדרים` : null,
                            p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </span>
                      <span>
                        <span className={`mv-pill ${statusDomain(p.status)}`}>
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </span>
                      <span className="flex flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className="mv-progress">
                            <span style={{ width: `${p.readinessScore}%`, background: ready.bar }} />
                          </span>
                          <span className="font-bold" style={{ color: ready.text, fontSize: "var(--type-caption)" }}>
                            {p.readinessScore}%
                          </span>
                        </span>
                        {/*
                          „‎82% · חסרים 2 שדות” — **גלוי, ולא רק לקורא מסך.**
                          זו העמודה שכל תכליתה לומר „מה חסר”, והמידע
                          כבר הגיע מהשרת.
                        */}
                        <span style={{ fontSize: "var(--type-caption)", color: "var(--color-text-muted)" }}>
                          {p.missingFields.length > 0
                            ? `חסרים ${p.missingFields.length} שדות`
                            : "כל השדות מלאים"}
                        </span>
                      </span>
                      <span className="text-sm font-bold">{formatPrice(p.priceAgorot)}</span>
                      {/*
                        התאמות הן **סגול** ולא ירוק (§2 של מערכת העיצוב:
                        „VIOLET — matching engine”). אפס עובר לניטרלי —
                        „Zero must never look like failure”.
                      */}
                      <span>
                        <span
                          className={`mv-pill ${
                            p.suggestedMatchCount ? "mv-domain-violet" : "mv-domain-neutral"
                          }`}
                        >
                          {p.suggestedMatchCount
                            ? `${p.suggestedMatchCount} התאמות`
                            : "0 התאמות"}
                        </span>
                      </span>
                      {/*
                        ‎**תאריך הקליטה, ולא „לחפש התאמות”.**

                        מה שישב כאן היה תווית שנראתה ככפתור ולא הייתה
                        כפתור — השורה כולה היא הניווט — ומה שהיא אמרה
                        („התאמות”) כבר מופיע בעמודה שלצדה. כלומר עמודה
                        שלמה שחזרה על שכנתה ולא הוסיפה דבר.

                        התאריך הוא מה שחסר: כמה זמן הנכס יושב אצלנו.
                        זו העובדה שמפרידה בין „חדש, תנו לו זמן” לבין
                        „חודשיים בלי התאמה — משהו לא בסדר”, ושום עמודה
                        אחרת אינה נושאת אותה.
                      */}
                      <span
                        className="text-[length:var(--type-body-sm)]"
                        style={{ color: "var(--color-text-soft)" }}
                      >
                        {formatDate(p.createdAt)}
                      </span>
                    </button>
                    </div>
                  );
                })}
              </div>
              </div>
            </>
          )}

          {/*
            ‎**סרגל הפעולות בתחתית הכרטיס, וקבוע.**

            הוא הופיע ונעלם לפי הבחירה, ולכן הרשימה קפצה בכל סימון
            ראשון — והפעולות עצמן היו מפתיעות: איש לא ידע שהן קיימות
            עד שסימן. עכשיו הן שם תמיד, ומושבתות עד שיש על מה להפעיל
            אותן. „נבחרו 0” הוא מצב, לא שגיאה.
          */}
          {maySelect && visible.length > 0 ? (
            <div
              className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4"
              style={{ borderColor: "var(--color-border)" }}
            >
              <strong className="text-[length:var(--type-body-sm)]" role="status">
                נבחרו {selectedVisible.length} נכסים
              </strong>
              {/*
                ‎**מבוטל לפי `selected`, ולא לפי מה שנראה כרגע.**

                סינון שמסתיר את כל מה שנבחר מאפס את `selectedVisible`
                אבל לא את הבחירה עצמה — והכפתור היחיד שמנקה אותה היה
                מושבת. הבחירה נתקעה, וצצה שוב כשהסינון נוקה (ביקורת
                Codex). הסרגל הישן לא סבל מזה כי הוא כולו נעלם.
              */}
              <button
                type="button"
                className="mv-btn-plain"
                disabled={bulkBusy || selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                בטל בחירה
                {selected.size > selectedVisible.length
                  ? ` (${selected.size - selectedVisible.length} מוסתרים בסינון)`
                  : ""}
              </button>
              <span className="ms-auto flex flex-wrap items-center gap-2">
                {/*
                  ‎**„שליחה לקונים” פועלת על נכס אחד.**

                  בצילום היא נראית כפעולה מרוכזת, אבל שליחת הצעה היא
                  בחירה של **קונים מתוך ההתאמות של נכס מסוים** — אין
                  לה משמעות על חמישה נכסים יחד, וכפתור שנראה פעיל
                  ואינו עושה דבר גרוע מכפתור מושבת. עם נכס אחד מסומן
                  הוא פותח את ההתאמות שלו, ששם ההצעה נשלחת.
                */}
                <button
                  type="button"
                  className="mv-btn-plain"
                  disabled={bulkBusy || selectedVisible.length !== 1}
                  title={
                    selectedVisible.length === 1
                      ? "פתיחת ההתאמות של הנכס שנבחר"
                      : "בחרו נכס אחד — ההצעה נשלחת לקונים של נכס מסוים"
                  }
                  onClick={() => {
                    const one = selectedVisible[0];
                    if (one) router.push(`/matches?property=${one.id}`);
                  }}
                >
                  שליחה לקונים
                </button>
                {mayShare ? (
                  <button
                    type="button"
                    className="mv-btn-plain"
                    disabled={bulkBusy || selectedVisible.length === 0}
                    onClick={() => void shareSelected()}
                    style={{ color: "var(--color-primary)" }}
                  >
                    {bulkBusy ? "מפרסם…" : "שיתוף לרשת"}
                  </button>
                ) : null}
                {mayDelete ? (
                  <>
                    <button
                      type="button"
                      className="mv-btn-plain"
                      disabled={bulkBusy || selectedVisible.length === 0}
                      onClick={() => void removeSelected(false)}
                    >
                      העבר לארכיון
                    </button>
                    <button
                      type="button"
                      className="mv-btn-plain"
                      disabled={bulkBusy || selectedVisible.length === 0}
                      onClick={() => void removeSelected(true)}
                      style={{ color: "var(--color-danger)" }}
                    >
                      מחק לצמיתות
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
          </div>

          <CapNote show={filtering && items.length === 100} noun="נכסים" />
        </>
      )}
    </>
  );
}
