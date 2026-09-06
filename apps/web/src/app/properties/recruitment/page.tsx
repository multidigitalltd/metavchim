"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
  RECRUITMENT_STATUSES,
  type RecruitmentStatus,
  canConvertToProperty,
  isOpenRecruitment,
  recruitmentSourceLabel,
  recruitmentStatusLabel,
  sourceUrlHost,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { IconPlus } from "../../icons";
import { FilterChips } from "../../list-controls";

interface TargetRow {
  id: string;
  status: string;
  source: string;
  sourceUrl?: string;
  city?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  rooms?: number;
  priceAgorot?: number;
  ownerName?: string;
  ownerPhone?: string;
  notes?: string;
  convertedPropertyId?: string;
}

function addressOf(row: TargetRow): string {
  const line = [row.street, row.houseNumber].filter(Boolean).join(" ");
  return [line, row.city].filter(Boolean).join(", ") || "בלי כתובת";
}

export default function RecruitmentPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [filter, setFilter] = useState<"" | RecruitmentStatus>("");
  const [error, setError] = useState<string | null>(null);
  /** המזהה שההמרה רצה עליו — הכפתור ננעל כדי שלחיצה כפולה לא תשלח שוב */
  const [converting, setConverting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = filter === "" ? "" : `?status=${filter}`;
    const data = await apiGet<TargetRow[]>(`/recruitment${query}`);
    setRows(Array.isArray(data) ? data : []);
  }, [filter]);

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, [load]);

  if (authLoading || !user) return null;
  const mayEdit = can(user, "properties.edit");
  const mayCreate = can(user, "properties.create");

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

  const open = (rows ?? []).filter((r) => isOpenRecruitment(r.status)).length;

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
          <Link href="/properties/recruitment/new">
            <Button>
              <IconPlus />
              נכס לגיוס חדש
            </Button>
          </Link>
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

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-[var(--color-danger-soft)] p-3 text-sm">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">טוען…</p>
      ) : rows.length === 0 ? (
        <div className="mv-card p-6 text-center">
          <p className="font-semibold">אין כאן נכסים לגיוס</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            ראיתם מודעה ביד2 או שלט על מרפסת? הוסיפו אותה כאן, ותנהלו את הפנייה עד החתימה.
          </p>
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
                      <td className="p-3">
                        <Link
                          href={`/properties/recruitment/${row.id}`}
                          className="font-semibold underline-offset-2 hover:underline"
                        >
                          {addressOf(row)}
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
                            aria-label={`שלב הגיוס — ${addressOf(row)}`}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
