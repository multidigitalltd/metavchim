"use client";

import { type RecordingImportSummary, importSentences } from "@metavchim/shared";
import { Notice } from "./notice";

/**
 * ‎**תוצאת ייבוא הקלטות — מסך אחד לשני המקומות שמריצים אותו.**
 *
 * ‏את הייבוא מריצים שניים: מנהל המשרד מהגדרות המרכזייה, ומנהל
 * ‏הפלטפורמה משולחן החיבורים. שתי הרצות של אותו מנוע, ולכן שתי
 * ‏תשובות זהות — ואילו כל מסך היה מנסח אותן בעצמו, השיחה בין
 * ‏השניים („אצלי כתוב ש…”) הייתה מתחילה מתרגום.
 *
 * ‏המשפטים עצמם מגיעים מ-`importSentences` שבחבילה המשותפת, שם
 * ‏גם יש להם בדיקות. כאן רק מה שאינו משפט: שמות השדות שהספק
 * ‏החזיר.
 */
export interface RecordingImportResult extends RecordingImportSummary {
  /** ‏שמות השדות בשורה שהספק החזיר — שמות בלבד, בלי ערכים. */
  rowKeys: string[];
}

export function RecordingImportNotice({ result }: { result: RecordingImportResult }) {
  return (
    <Notice tone="success">
      {importSentences(result).join(" ")}
      {/*
        ‏„הספק החזיר הקלטות ואין לנו מזהה הורדה” הוא אבחון; „לא
        ‏נמצאו הקלטות” הוא מבוי סתום. צורת השורה אינה מתועדת אצל
        ‏015, ולכן שמות השדות שהוא באמת החזיר הם מה שסוגר את הפער.
        ‏שמות בלבד: ערכי השורה נושאים מספרי טלפון.
      */}
      {result.withoutRecordId > 0 ? (
        <span className="mt-1 block">
          {`${result.withoutRecordId} הקלטות אצל הספק בלי מזהה הורדה שאנחנו מכירים — אי אפשר למשוך אותן עד שנדע באיזה שדה הוא מגיע.`}
          {result.rowKeys.length > 0 ? (
            <>
              {" השדות שהמרכזייה החזירה: "}
              <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                {result.rowKeys.join(", ")}
              </span>
              {". שלחו את השורה הזו לתמיכה."}
            </>
          ) : null}
        </span>
      ) : null}
    </Notice>
  );
}
