"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DOCUMENT_KIND_LABELS,
  formatFileSize,
  type DocumentKind,
} from "@metavchim/shared";
import { apiGet, API_BASE } from "@/lib/api";
import { formatDate } from "@/lib/format";

/**
 * ארכיון ההסכמים החתומים של לקוחות שנמחקו.
 *
 * כשלקוח מבקש שהמשרד ימחק את המידע עליו, נמחק הכול — חוץ ממסמך
 * חתום. מסמך חתום הוא ראיה משפטית ובסיס הזכאות לדמי התיווך, והוא
 * אינו של הלקוח למחוק.
 *
 * הרשימה הזו היא **הדרך היחידה** להגיע אליו אחרי המחיקה: כל שאר
 * המסלולים אל הסכם עוברים דרך כרטיס הלקוח, ולכרטיס כבר אין קיום.
 * בלעדיה המשרד היה שומר מסמך שאינו יכול לפתוח — כלומר מאבד אותו,
 * רק בלי לדעת.
 *
 * הרכיב אינו מציג כלום כשאין מה להציג: משרד שמעולם לא מחק לקוח אינו
 * צריך לקרוא הסבר על מחיקות.
 *
 * ## שני מקורות, רשימה אחת
 *
 * ‎`/agreements/retained` — מה שנחתם במערכת. `/signed-documents/retained`
 * — סריקות של הזמנה בכתב או בלעדיות שנחתמו על נייר, שנשמרות מאותו
 * נימוק בדיוק.
 *
 * הסריקות נוספו כאן רק אחרי שהתברר שהנתיב בשרת נבנה ואיש לא צרך
 * אותו: המסך הבטיח ארכיון, והסריקות לא הופיעו בו (ביקורת Codex).
 * מסמך שנשמר מטעמים משפטיים ואי אפשר להגיע אליו הוא מסמך שנאבד —
 * רק בלי שאיש יודע.
 */

interface RetainedAgreement {
  id: string;
  kindLabel: string;
  signerName: string | null;
  signedAt: string | null;
  url: string;
}

/** סריקה שנחתמה על נייר ושרדה מחיקת לקוח. */
interface RetainedScan {
  id: string;
  kind: DocumentKind;
  fileName: string;
  byteSize: number;
  signerName?: string;
  signedOn?: string;
  url: string;
}

export function RetainedAgreementsSection() {
  const [rows, setRows] = useState<RetainedAgreement[] | null>(null);
  const [scans, setScans] = useState<RetainedScan[] | null>(null);

  useEffect(() => {
    // שתי הבקשות בנפרד: הרשאה או תקלה באחת אינה מסתירה את השנייה
    apiGet<RetainedAgreement[]>("/agreements/retained")
      .then(setRows)
      .catch(() => setRows([])); // אין הרשאה או שגיאה — פשוט לא מציגים
    apiGet<RetainedScan[]>("/signed-documents/retained")
      .then(setScans)
      .catch(() => setScans([]));
  }, []);

  if (rows === null || scans === null) return null;
  if (rows.length === 0 && scans.length === 0) return null;

  return (
    <section className="mv-list-card mt-4" aria-labelledby="retained-agreements-heading">
      <div
        className="px-5 py-[15px]"
        style={{ borderBottom: "1px solid var(--color-card-head-border)" }}
      >
        <h3 id="retained-agreements-heading" className="m-0 text-[length:var(--type-button)] font-bold">
          מסמכים חתומים של לקוחות שנמחקו
        </h3>
        <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          הלקוח ביקש מחיקה וכל המידע עליו נמחק — חוץ מהמסמך החתום, שהוא ראיה משפטית
          ובסיס הזכאות לדמי התיווך. השם כאן הוא שם החותם כפי שנחתם במסמך.
        </p>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span>
              <b>{row.signerName ?? "ללא שם חותם"}</b>
              <span style={{ color: "var(--color-text-muted)" }}> · {row.kindLabel}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {row.signedAt !== null ? `נחתם ${formatDate(row.signedAt)}` : "—"}
              </span>
              <Link href={row.url} className="mv-btn-plain">
                פתח מסמך
              </Link>
            </span>
          </li>
        ))}
        {scans.map((scan) => (
          <li
            key={scan.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span>
              <b>{scan.signerName ?? "ללא שם חותם"}</b>
              <span style={{ color: "var(--color-text-muted)" }}>
                {" · "}
                {DOCUMENT_KIND_LABELS[scan.kind]}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {scan.signedOn !== undefined ? `נחתם ${formatDate(scan.signedOn)}` : "—"}
              </span>
              {/* גודל הקובץ ב-LTR מבודד, כמו כל מספר במערכת */}
              <span
                className="text-sm"
                dir="ltr"
                style={{ color: "var(--color-text-muted)", unicodeBidi: "isolate" }}
              >
                {formatFileSize(scan.byteSize)}
              </span>
              {/*
                ‎`<a>` ולא `<Link>`: זו הורדת קובץ מה-API, לא ניווט
                בתוך האפליקציה.
              */}
              <a href={API_BASE + scan.url} className="mv-btn-plain">
                הורד סריקה
              </a>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
