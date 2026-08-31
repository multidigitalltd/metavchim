"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * ‎**חיבור מכשיר וואטסאפ — הקוד, הברקוד, והלחיצה.**
 *
 * ## מה היה
 *
 * המסך הציג „MV-4F7K2Q” והנחה לשלוח אותו בוואטסאפ אל המספר העסקי.
 * מי שיושב מול מחשב צריך לזכור שש אותיות, לפתוח את הטלפון, למצוא
 * את המספר, ולהקליד. כל שלב שם הוא מקום להיעצר בו, ואות שגויה אחת
 * שורפת ניסיון מתוך חמישה.
 *
 * שני קיצורים, לשני מצבים שונים:
 *   - ‎**ברקוד** — למי שמול המחשב. סורק בטלפון, והשיחה נפתחת עם
 *     ההודעה כבר בפנים.
 *   - ‎**קישור** — למי שכבר בטלפון. לחיצה אחת, אותה שיחה.
 *
 * ## והקוד נשאר
 *
 * הוא אינו גיבוי מנומס אלא המסלול היחיד שעובד כשאין מספר עסקי
 * (הצד היוצא לא הוגדר, או ש-Meta לא ענתה) — ואז `link` הוא `null`.
 * הסתרתו הייתה הופכת תקלת הגדרה זמנית לחוסר יכולת לחבר מכשיר.
 */
export function WhatsappPairing({
  code,
  link,
  /** „מהמכשיר שתרצו לחבר” מול „מהמכשיר של הסוכן” — מי מסתכל במסך. */
  forSomeoneElse = false,
}: {
  code: string;
  link: string | null;
  forSomeoneElse?: boolean;
}) {
  return (
    <div
      className="mb-3 rounded-xl px-4 py-3"
      style={{ background: "var(--color-field)", border: "1px solid var(--color-input-border)" }}
    >
      <p
        className="m-0 mb-1 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        {forSomeoneElse
          ? "העבירו את אלה לסוכן — הקישור או הברקוד פותחים אצלו וואטסאפ עם הקוד מוכן לשליחה:"
          : "שלחו את הקוד הזה בהודעת וואטסאפ לסוכן, מהמכשיר שתרצו לחבר:"}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 grow">
          <p
            className="m-0 select-all"
            style={{ fontSize: "var(--type-panel)", fontWeight: 800, letterSpacing: 2 }}
          >
            {code}
          </p>
          {link === null ? null : (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="mv-btn-action mt-2 inline-block"
              style={{ padding: "9px 16px" }}
            >
              פתחו וואטסאפ ושלחו
            </a>
          )}
          <p
            className="m-0 mt-2 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            הקוד תקף לרבע שעה ולשימוש אחד.
            {link === null
              ? " המספר העסקי אינו זמין כרגע, ולכן אין קיצור — שלחו את הקוד ידנית."
              : ""}
          </p>
        </div>

        {link === null ? null : (
          <figure className="m-0 text-center">
            {/*
              רקע לבן וריפוד גם בערכה כהה: אזור השקט סביב הברקוד הוא
              חלק מהתקן, וברקוד בהיר על רקע כהה אינו נסרק.
            */}
            <div className="rounded-lg bg-white p-2">
              <QRCodeSVG value={link} size={116} marginSize={0} />
            </div>
            <figcaption
              className="mt-1 text-[length:var(--type-caption)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              סרקו בטלפון
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
