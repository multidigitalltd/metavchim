"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  recruitmentSourceLabel,
  recruitmentStatusLabel,
} from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { EntityTasks } from "../../../entity-tasks";
import { TargetForm, type TargetValues } from "../target-form";

export default function EditRecruitmentTargetPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [target, setTarget] = useState<TargetValues | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (typeof id !== "string") return;
    apiGet<TargetValues>(`/recruitment/${id}`)
      .then(setTarget)
      .catch(() => setMissing(true));
  }, [id]);

  if (authLoading || !user) return null;
  const mayEdit = can(user, "properties.edit");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <nav className="mb-3 text-sm">
        <Link href="/properties/recruitment" className="underline underline-offset-2">
          נכסים לגיוס
        </Link>
      </nav>
      <h1 className="mb-5 text-2xl font-bold">{mayEdit ? "עריכת נכס לגיוס" : "נכס לגיוס"}</h1>
      {missing ? (
        <p role="alert" className="mv-card p-5">
          הנכס לגיוס לא נמצא — ייתכן שנמחק.
        </p>
      ) : target === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">טוען…</p>
      ) : mayEdit ? (
        <TargetForm initial={target} />
      ) : (
        /*
         * ‏מי שרשאי לצפות ולא לערוך הגיע לכאן דרך הקישור ברשימה, וקיבל
         * טופס מלא ופעיל ששמירתו נדחית ב-403 עם „השמירה נכשלה”. מסך
         * שמזמין פעולה אסורה ואז מאשים את המשתמש (ביקורת Codex).
         */
        <ReadOnlyTarget target={target} />
      )}
      {/*
        ‎**פולואפ — משימה עם מועד, ולא מנגנון תזכורות שני.**

        ‏„לחזור לבעלים ביום חמישי ב-17:00” הוא בדיוק משימה: יש לה
        ‏מועד, היא של סוכן, והיא צריכה להזכיר על עצמה. בניית שדה
        ‏`followUpAt` על שורת הגיוס הייתה מחייבת סורק תזכורות שני,
        ‏סנכרון יומן שני ורשימה שנייה — ארבעה מנגנונים מקבילים לאותו
        ‏דבר. במקום זה השורה הצטרפה לאוצר המילים של המשימות
        ‏(`TASK_ENTITY_TYPES`), ומקבלת את כולם כמו שהם.

        ‏המועד נבחר ב-`datetime-local`: תאריך ושעה, בשעון ישראל,
        ‏באותו רכיב שכל שאר המשימות במערכת משתמשות בו.

        ‏מותנה ב-`calendar.manage` — אותה יכולת שנתיבי המשימות
        ‏דורשים. בלעדיה המקטע היה נטען ומחזיר 403 על פעולה שהמסך
        ‏הזמין לעשות.
      */}
      {target !== null && can(user, "calendar.manage") && typeof id === "string" ? (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">פולואפ</h2>
          <EntityTasks entityType="recruitment" entityId={id} />
        </section>
      ) : null}
    </div>
  );
}

/** תצוגה בלבד — לצופה שאינו רשאי לערוך. */
function ReadOnlyTarget({ target }: { target: TargetValues }) {
  const rows: [string, string][] = [
    ["שלב בגיוס", recruitmentStatusLabel(target.status ?? "new")],
    ["מקור", recruitmentSourceLabel(target.source ?? "other")],
    ["כתובת", [target.street, target.houseNumber, target.city].filter(Boolean).join(" ") || "—"],
    ["שכונה", target.neighborhood ?? "—"],
    ["חדרים", target.rooms === undefined ? "—" : String(target.rooms)],
    ["שטח במ״ר", target.areaSqm === undefined ? "—" : String(target.areaSqm)],
    ["מחיר מבוקש", target.priceAgorot === undefined ? "—" : formatPrice(target.priceAgorot)],
    ["בעל הנכס", target.ownerName ?? "—"],
    ["מה נאמר בשיחה", target.notes ?? "—"],
  ];
  return (
    <div className="mv-card space-y-4 p-5">
      <p className="text-sm text-[var(--color-text-muted)]">
        לצפייה בלבד — אין לכם הרשאת עריכה לנכסים.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {target.sourceUrl ? (
        <a
          href={target.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block underline underline-offset-2"
        >
          למודעה המקורית
        </a>
      ) : null}
    </div>
  );
}
