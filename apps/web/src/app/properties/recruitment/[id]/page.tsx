"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { EntityTasks } from "../../../entity-tasks";
import { TargetDetails, TargetStatusChip } from "../target-details";
import { TargetForm } from "../target-form";
import { targetAddress, type TargetValues } from "../target-values";

/**
 * ‏עמוד הנכס לגיוס — **הקישור העמוק**, ולא הדרך הרגילה.
 *
 * ‏העבודה השוטפת נעשית בחלונית שנפתחת מהרשימה: היא מהירה יותר
 * ‏ואינה מאבדת את הסינון. העמוד קיים בשביל מה שהחלונית אינה יכולה
 * ‏להיות — כתובת שאפשר לשלוח, לפתוח בלשונית חדשה ולסמן — ובשביל
 * ‏מקטע הפולואפ.
 *
 * ‏שני המסכים מרנדרים את **אותם רכיבים** (`TargetDetails`,
 * ‎`TargetForm`). עותק שני של התצוגה כאן היה סוטה ביום שנוסף שדה —
 * ‏וזה בדיוק מה שקרה קודם: הטופס קיבל קומה, קומות בבניין, סוג
 * ‏עסקה וטאבו משותף, והתצוגה כאן המשיכה למנות תשעה שדות.
 */
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
      {missing ? (
        <p role="alert" className="mv-card p-5">
          הנכס לגיוס לא נמצא — ייתכן שנמחק.
        </p>
      ) : target === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">טוען…</p>
      ) : (
        <>
          <header className="mb-5 flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-2xl font-bold">{targetAddress(target)}</h1>
            <TargetStatusChip status={target.status ?? "new"} />
          </header>

          <div className="mv-card mb-5 p-5">
            <TargetDetails target={target} />
          </div>

          {mayEdit ? (
            <TargetForm initial={target} />
          ) : (
            /*
             * ‏מי שרשאי לצפות ולא לערוך הגיע לכאן דרך הקישור ברשימה,
             * ‏וקיבל טופס מלא ופעיל ששמירתו נדחית ב-403 עם „השמירה
             * ‏נכשלה”. מסך שמזמין פעולה אסורה ואז מאשים את המשתמש
             * ‏(ביקורת Codex).
             */
            <p className="mv-card p-5 text-sm text-[var(--color-text-muted)]">
              לצפייה בלבד — אין לכם הרשאת עריכה לנכסים.
            </p>
          )}
        </>
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
