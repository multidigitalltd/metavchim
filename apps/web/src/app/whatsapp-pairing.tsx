"use client";

import { QRCodeSVG } from "qrcode.react";
import { displayWhatsappNumber, normalizePhoneForWhatsapp } from "@metavchim/shared";

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
 *
 * ## ‎**והמספר נכתב, לא רק מקודד**
 *
 * הקישור והברקוד מסתירים את המספר בתוכם. זה בסדר כל עוד הם עובדים,
 * והם לא תמיד: מחשב בלי וואטסאפ מותקן, טלפון שהקישור נפתח בו
 * בדפדפן, או משתמש שפשוט מעדיף להקליד. המסך אמר „שלחו את הקוד
 * ידנית” בלי לומר **למי** — הוראה שאי אפשר לבצע. המספר מוצג עכשיו
 * בטקסט, `select-all`, וגם כקישור חיוג.
 */
export function WhatsappPairing({
  code,
  link,
  botNumber,
  /** „מהמכשיר שתרצו לחבר” מול „מהמכשיר של הסוכן” — מי מסתכל במסך. */
  forSomeoneElse = false,
}: {
  code: string;
  link: string | null;
  /** ספרות בלבד; `null` = לא נשלף מ-Meta וגם לא הוגדר ידנית. */
  botNumber: string | null;
  forSomeoneElse?: boolean;
}) {
  /*
   * שני הייצוגים נגזרים מאותו ערך מנורמל, ולא כל אחד מהקלט הגולמי:
   * ‎`tel:+0553142235` היה מספר שאינו קיים, בעוד שהטקסט לידו נראה
   * תקין. ‎`""` אחרי נרמול פירושו „אין מספר”, כמו `null`.
   */
  const digits = normalizePhoneForWhatsapp(botNumber ?? "");
  const numberText = digits === "" ? null : displayWhatsappNumber(digits);
  return (
    <div
      className="mb-3 rounded-xl px-4 py-3"
      style={{ background: "var(--color-field)", border: "1px solid var(--color-input-border)" }}
    >
      <p
        className="m-0 mb-1 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        {/*
          ‎**המספר בתוך המשפט, ולא בשורה נפרדת.**

          „שלחו את הקוד” בלי לומר למי היא הוראה שאי אפשר לבצע, וזה
          מה שהמסך אמר. הקישור והברקוד מסתירים את המספר בתוכם והם
          לא תמיד עובדים — מחשב בלי וואטסאפ, קישור שנפתח בדפדפן, או
          מי שפשוט מעדיף להקליד.

          ‎`tel:` ולא `wa.me`: הכפתור שמתחת כבר פותח את השיחה עם הקוד
          בפנים, וקישור שני לאותו יעד מיותר. מי שנוגע כאן רוצה את
          המספר עצמו — לשמור באנשי הקשר או לחפש אותו בעצמו.
        */}
        {numberText === null
          ? forSomeoneElse
            ? "העבירו את אלה לסוכן — הקישור או הברקוד פותחים אצלו וואטסאפ עם הקוד מוכן לשליחה:"
            : "שלחו את הקוד הזה בהודעת וואטסאפ לסוכן, מהמכשיר שתרצו לחבר:"
          : null}
        {numberText === null ? null : (
          <>
            {forSomeoneElse ? "הקוד נשלח בוואטסאפ אל " : "שלחו את הקוד הזה בוואטסאפ אל "}
            <a href={`tel:+${digits}`} dir="ltr" className="select-all font-bold underline">
              {numberText}
            </a>
            {forSomeoneElse
              ? " — העבירו לסוכן את הקישור או הברקוד, והם פותחים אצלו את השיחה מוכנה:"
              : ", מהמכשיר שתרצו לחבר:"}
          </>
        )}
      </p>

      {numberText === null ? (
        <p
          className="m-0 mb-2 text-[length:var(--type-caption)]"
          style={{ color: "var(--color-danger)" }}
        >
          מספר הוואטסאפ של המערכת אינו מוגדר — פנו למנהל הפלטפורמה. בלעדיו אין לאן
          לשלוח את הקוד.
        </p>
      ) : null}

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
            {link === null && numberText !== null
              ? " הקיצור אינו זמין כרגע — שלחו את הקוד למספר שלמעלה."
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
