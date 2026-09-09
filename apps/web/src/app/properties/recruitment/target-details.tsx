"use client";

import {
  RECRUITMENT_SECTIONS,
  RECRUITMENT_SECTION_LABELS,
  recruitmentFieldSplit,
  recruitmentStatusLabel,
  sourceUrlHost,
} from "@metavchim/shared";
import { recruitmentFieldText, type TargetValues } from "./target-values";

/**
 * ‎**מה שכבר ידוע על הנכס לגיוס.**
 *
 * ## ‏למה רק מה שמלא
 *
 * ‏שורת גיוס נולדת ממודעה או משיחה, ולכן היא כמעט תמיד חלקית. טבלה
 * ‏של שמונה־עשר שדות שרובם „—” אינה תצוגה של הנכס אלא תצוגה של
 * ‏החוסר — ומי שסורק אותה צריך לקרוא שמונה־עשר שורות כדי למצוא
 * ‏את השלוש שיש בהן משהו. מה שחסר אינו נעלם: הוא **הטופס** שמתחת,
 * ‏שם אפשר לעשות איתו משהו.
 *
 * ## ‏למה אותו רכיב בעמוד ובחלונית
 *
 * ‏שתי תצוגות של אותו נכס שנכתבו בנפרד סוטות ביום שנוסף שדה. זה
 * ‏כבר קרה כאן: הטופס קיבל קומה, קומות בבניין, סוג עסקה וטאבו
 * ‏משותף, והתצוגה לצפייה בלבד המשיכה למנות תשעה שדות.
 */
export function TargetDetails({ target }: { target: TargetValues }) {
  const { filled } = recruitmentFieldSplit(target);
  const host = target.sourceUrl === undefined ? null : sourceUrlHost(target.sourceUrl);

  return (
    <div className="space-y-4">
      {filled.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          עוד לא נשמר כאן שום פרט — הטופס שמתחת הוא המקום להתחיל.
        </p>
      ) : (
        RECRUITMENT_SECTIONS.map((section) => {
          const fields = filled.filter((spec) => spec.section === section);
          if (fields.length === 0) return null;
          return (
            <section key={section}>
              <h3 className="mb-2 text-[length:var(--type-caption-lg)] font-semibold text-[var(--color-text-muted)]">
                {RECRUITMENT_SECTION_LABELS[section]}
              </h3>
              {/*
                ‏שתי עמודות כבר בטלפון ולא רק מ-`sm`: אלה זוגות
                ‏תווית-ערך קצרים, ועמודה אחת הפכה תשעה פרטים לגלילה
                ‏ארוכה שדוחפת את טופס ההשלמה — הדבר שבשבילו נפתחה
                ‏החלונית — אל מתחת לקפל.
              */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
                {fields.map((spec) => (
                  <div key={spec.key}>
                    <dt className="text-[length:var(--type-caption)] text-[var(--color-text-muted)]">
                      {spec.label}
                    </dt>
                    <dd className="m-0 font-medium">
                      {/*
                        ‏הטלפון ב-`dir="ltr"`: בלעדיו ה-`+` של הקידומת
                        הבינלאומית נדחף לקצה השני ונקרא „972…+” — מספר
                        שנראה שגוי.
                      */}
                      {spec.key === "ownerPhone" ? (
                        <a
                          href={`tel:${target.ownerPhone}`}
                          dir="ltr"
                          className="inline-block underline-offset-2 hover:underline"
                        >
                          {target.ownerPhone}
                        </a>
                      ) : spec.key === "sourceUrl" && host !== null ? (
                        /*
                          ‏`noopener noreferrer` אינו קישוט: הכתובת הוזנה
                          על ידי משתמש, והעמוד שנפתח אינו אמור לקבל גישה
                          לחלון של המערכת.
                        */
                        <a
                          href={target.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          {host}
                        </a>
                      ) : (
                        recruitmentFieldText(target, spec.key)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })
      )}
    </div>
  );
}

/**
 * ‎**שלב הגיוס כשבב** — הוא לא שדה בין שדות אלא המצב של השורה,
 * ‏והמקום שלו הוא הכותרת.
 */
export function TargetStatusChip({ status }: { status: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[length:var(--type-caption)] font-semibold"
      style={{ background: "var(--color-surface-sunken)", color: "var(--color-text-soft)" }}
    >
      {recruitmentStatusLabel(status)}
    </span>
  );
}
