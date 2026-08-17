import { Fragment, type ReactNode } from "react";

/**
 * הצגת נוסח משפטי שנערך ב-/platform.
 *
 * תת-קבוצה מצומצמת של Markdown — כותרות, פסקאות, רשימות והדגשה —
 * ולא ספריית Markdown מלאה, משום ששתי סכנות נמנעות כאן בבת אחת:
 * ה-HTML שספריות כאלה מעבירות כמות שהוא (וכאן הוא היה מגיע משדה
 * טקסט ומוצג בעמוד ציבורי), ותלות נוספת עבור שלושה עמודים.
 *
 * **אין `dangerouslySetInnerHTML` בקובץ הזה, וזה מכוון.** כל טקסט
 * עובר דרך React ולכן מוברח אוטומטית; תגית שתודבק בנוסח תוצג
 * כטקסט ולא תרוץ.
 *
 * מה שנתמך:
 *   `## כותרת` · `### תת-כותרת` · `- פריט ברשימה` · `**מודגש**`
 * שורה ריקה מפרידה בין פסקאות. כל השאר — טקסט רגיל.
 */

/** `**מודגש**` בתוך שורה. הפיצול על הקבוצה שומר את המפרידים במערך. */
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/gu).map((part, index) =>
    // אי-זוגי = מה שהיה בין הכוכביות, כי split עם קבוצה מחזיר
    // [לפני, לכוד, אחרי, לכוד, ...]
    index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}

export function LegalText({ text }: { text: string }): ReactNode {
  const blocks = text
    .replace(/\r\n/gu, "\n")
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim());

        if (lines.every((line) => line.startsWith("- "))) {
          return (
            <ul key={index} className="mb-4 list-inside list-disc space-y-1">
              {lines.map((line, i) => (
                <li key={i}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        }

        const heading = /^(#{1,3})\s+(.*)$/u.exec(lines[0] ?? "");
        if (heading && lines.length === 1) {
          /*
           * `#` יחיד מוצג כ-h2 ולא כ-h1 — בעמוד כבר יש h1 אחד (שם
           * המסמך), ושני h1 שוברים את מבנה הכותרות שקורא מסך מנווט
           * לפיו. שדרוג שקט עדיף כאן על נוסח שנראה תקין ואינו נגיש.
           */
          const level = heading[1]?.length === 3 ? 3 : 2;
          const body = inline(heading[2] ?? "");
          return level === 3 ? (
            <h3 key={index} className="mb-2 mt-5 font-semibold">
              {body}
            </h3>
          ) : (
            <h2 key={index} className="mb-2 mt-6 text-lg font-semibold">
              {body}
            </h2>
          );
        }

        return (
          <p key={index} className="mb-4">
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
