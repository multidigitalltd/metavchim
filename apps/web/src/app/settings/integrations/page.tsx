"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlanFeature } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { useFeature } from "@/lib/use-features";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * חנות המודולים — מסך אחד שאומר מה אפשר לחבר ומה כבר מחובר.
 *
 * עד כה החיבורים ישבו כקטעים בתוך מסך ההגדרות הארוך, בין "פרטי
 * המשרד" ל"יומן פעילות". מנהל שרצה לדעת מה המערכת יודעת להתחבר אליו
 * היה צריך לגלול ולמצוא — כלומר מודול שהוא לא נתקל בו במקרה אינו
 * קיים מבחינתו.
 *
 * שלוש מצבים בלבד לכל כרטיס, ובכוונה: **מחובר**, **זמין לחיבור**,
 * ו**לא כלול במסלול**. מודול נעול נשאר על המסך ולא נעלם — פיצ'ר
 * נסתר הוא מכירה שלא קרתה (אותו נימוק כמו ב-LockedFeature).
 */

type State = "connected" | "available" | "locked" | "soon";

interface Module {
  key: string;
  icon: string;
  title: string;
  description: string;
  /** null = לא דורש פיצ'ר במסלול */
  feature: PlanFeature | null;
  /** לאן ממשיכים כדי לחבר. חנות היא מדף, ההגדרות נשארות במקומן. */
  href: string;
  /** null = אין מה לבדוק, המודול תמיד "זמין" */
  state?: State;
}

const STATE_STYLE: Record<State, { label: string; color: string; background: string }> = {
  connected: { label: "מחובר", color: "var(--color-success)", background: "var(--color-success-soft)" },
  available: { label: "זמין לחיבור", color: "var(--color-text-muted)", background: "var(--color-table-head)" },
  locked: { label: "לא כלול במסלול", color: "var(--color-warning)", background: "var(--color-table-head)" },
  soon: { label: "בפיתוח", color: "var(--color-text-muted)", background: "var(--color-table-head)" },
};

export default function IntegrationsPage() {
  const { loading } = useRequireAuth();
  const canTelephony = useFeature("telephony");
  const canWhatsapp = useFeature("whatsapp");
  const canDataIo = useFeature("data_io");
  const [telephonyConnected, setTelephonyConnected] = useState<boolean | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    /*
     * כישלון הוא "לא ידוע" ולא "לא מחובר".
     *
     * מודול שמסלול המשרד אינו כולל מחזיר 403, וסימון "לא מחובר" היה
     * מזמין מנהל לחבר מחדש משהו שכבר מוגדר.
     */
    if (canTelephony) {
      apiGet<{ connected: boolean }>("/settings/telephony")
        .then((res) => setTelephonyConnected(res.connected))
        .catch(() => setTelephonyConnected(null));
    }
    if (canWhatsapp) {
      apiGet<{ serverConfigured: boolean; numberConfigured: boolean }>("/settings/whatsapp-status")
        .then((res) => setWhatsappConnected(res.serverConfigured && res.numberConfigured))
        .catch(() => setWhatsappConnected(null));
    }
  }, [loading, canTelephony, canWhatsapp]);

  const modules: Module[] = [
    {
      key: "telephony",
      icon: "☎️",
      title: "מרכזייה טלפונית",
      description:
        "שיחה נכנסת פותחת את כרטיס הלקוח מעצמה, וחיוג יוצא בלחיצה מתוך הכרטיס. תומך ב-015, Vonage ובכל מרכזייה ששולחת Webhook.",
      feature: "telephony",
      href: "/settings#telephony",
      state: !canTelephony ? "locked" : telephonyConnected === true ? "connected" : "available",
    },
    {
      key: "whatsapp",
      icon: "💬",
      title: "וואטסאפ עסקי",
      description:
        "הצעות ועדכוני שיווק נפתחים עם ההודעה מוכנה, ותשובות הלקוח חוזרות ל-Messages Hub.",
      feature: "whatsapp",
      href: "/settings#whatsapp",
      state: !canWhatsapp ? "locked" : whatsappConnected === true ? "connected" : "available",
    },
    {
      key: "lead_webhook",
      icon: "🎣",
      title: "לידים מאתרים חיצוניים",
      description:
        "כתובת Webhook אישית למשרד — יד2, מדלן, קמפיין פייסבוק או טופס באתר שולחים לידים ישירות למערכת.",
      feature: null,
      href: "/settings#lead-webhook",
      state: "available",
    },
    {
      key: "data_io",
      icon: "📤",
      title: "ייבוא וייצוא נתונים",
      description: "העלאת קובץ נכסים או קונים ממערכת קודמת, וייצוא הכול בכל רגע — הנתונים שלכם.",
      feature: "data_io",
      href: "/settings#data",
      state: canDataIo ? "available" : "locked",
    },
    {
      key: "network",
      icon: "🤝",
      title: "שיתופי פעולה בין משרדים",
      description:
        "שיתוף נכסים וקונים עם משרדים אחרים ברשת, כולל חלוקת עמלה מוסכמת מראש. בסיסי — כלול בכל המסלולים.",
      feature: null,
      href: "/network",
      state: "connected",
    },
    {
      key: "google_calendar",
      icon: "📅",
      title: "יומן Google",
      description:
        "סנכרון דו-כיווני: פגישה שנקבעת במערכת מופיעה ביומן הפרטי, ולהפך — כדי שלא יתנגשו.",
      feature: null,
      href: "/settings/integrations",
      state: "soon",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="m-0 text-2xl font-bold">מודולים וחיבורים</h1>
        <Link href="/settings" className="mv-btn-ghost">
          חזרה להגדרות
        </Link>
      </div>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        כל מה שהמערכת יודעת להתחבר אליו, ומה כבר מחובר אצלכם.
      </p>

      <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
        {modules.map((module) => {
          const state = module.state ?? "available";
          const style = STATE_STYLE[state];
          return (
            <li
              key={module.key}
              className="flex flex-col rounded-xl border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 className="m-0 text-lg font-semibold">
                  <span aria-hidden="true">{module.icon}</span> {module.title}
                </h2>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-sm font-medium"
                  style={{ color: style.color, background: style.background }}
                >
                  {style.label}
                </span>
              </div>
              <p className="m-0 mb-4 grow text-sm" style={{ color: "var(--color-text-muted)" }}>
                {module.description}
              </p>
              {state === "locked" ? (
                <Link href="/settings/billing" className="mv-btn-ghost self-start">
                  לשדרוג המסלול
                </Link>
              ) : state === "soon" ? (
                <span className="self-start text-sm" style={{ color: "var(--color-text-muted)" }}>
                  יעלה בקרוב — אין צורך לעשות דבר
                </span>
              ) : (
                <Link href={module.href} className="mv-btn-ghost self-start">
                  {state === "connected" ? "לניהול החיבור" : "לחיבור"}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
