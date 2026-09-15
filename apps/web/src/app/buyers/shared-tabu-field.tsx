import { SharedTabuStanceSchema, type SharedTabuStance } from "@metavchim/shared";

/**
 * ‎**„האם הלקוח מוכן לטאבו משותף?” — שלוש תשובות, לא שתיים.**
 *
 * ‏רישום במושאע משנה את העסקה מהיסוד: אין חלקה נפרדת, כל מהלך דורש
 * ‏התייחסות לשותפים, והמימון מוגבל. יש לקוחות שזה פסול עבורם לגמרי,
 * ‏ויש מי שדווקא מחפש את זה — המחיר נמוך יותר, ואפשר לקנות בשותפות.
 *
 * ‏המצב השלישי, **„טרם נשאל”**, הוא ברירת המחדל וגם הרוב המוחלט של
 * ‏הכרטיסים הקיימים. תיבת סימון הייתה מוחקת אותו: „לא מסומן” היה
 * ‏נקרא כסירוב, וכל הקונים שקדמו לשדה היו מפסיקים לראות נכסים
 * ‏בטאבו משותף באותו רגע — בלי שאיש בחר בכך, ובלי שדבר על המסך
 * ‏יסביר מדוע הרשימה התקצרה.
 *
 * ‏לכן `select` ולא `checkbox`, והאפשרות הריקה נשארת אפשרות אמיתית.
 */

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export function SharedTabuField({
  initial,
  disabled,
}: {
  initial?: SharedTabuStance;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor="sharedTabu" className="mb-1.5 block text-sm font-medium">
        טאבו משותף (מושאע)
      </label>
      <select
        id="sharedTabu"
        name="sharedTabu"
        defaultValue={initial ?? ""}
        disabled={disabled === true}
        className="w-full rounded-lg border px-3 py-2.5"
        style={inputStyle}
      >
        <option value="">טרם נשאל</option>
        <option value="accepts">מוכן לרכוש בטאבו משותף</option>
        <option value="refuses">אינו מוכן</option>
      </select>
      <p className="mt-1.5 text-sm" style={{ color: "var(--color-muted)" }}>
        ‏„אינו מוכן” מסתיר ממנו נכסים כאלה. „מוכן” גם מאפשר להציע לו שותף לנכס
        שהוא לא מגיע אליו לבד.
      </p>
    </div>
  );
}

/**
 * ‏הצד השני של אותו חוזה — ומאמת מול **הסכמה של השרת**.
 *
 * ‏מחרוזת ריקה חוזרת כ-`undefined` ולא כערך: הטופס נשלח כ-`PATCH`
 * ‏מלא של הדרישות, ולכן „טרם נשאל” חייב להגיע כהיעדר, אחרת הוא
 * ‏היה נדחה בסכמה ומפיל שמירה של כל שאר השדות.
 */
export function readSharedTabuStance(
  raw: FormDataEntryValue | null,
): SharedTabuStance | undefined {
  const parsed = SharedTabuStanceSchema.safeParse(String(raw ?? ""));
  return parsed.success ? parsed.data : undefined;
}
