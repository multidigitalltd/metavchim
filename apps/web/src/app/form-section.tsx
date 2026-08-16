/**
 * קטע בטופס קליטה.
 *
 * `fieldset` עם `legend` הוא הנכון סמנטית — קוראי מסך מכריזים על
 * הכותרת לכל שדה בקבוצה — ולכן הוא נשאר. מה שהשתנה הוא איך הוא
 * נראה: במקום מסגרת דקה עם כותרת תלויה על הקו, כרטיס נושם עם מספר
 * שלב ומשפט הסבר.
 *
 * מספר השלב אינו קישוט: טופס של ארבע קבוצות נראה כמו קיר אחד, ואותו
 * טופס עם 1‑2‑3‑4 נראה כמו משהו שנגמר. ההסבר מתחת לכותרת הוא המקום
 * לומר **למה** שואלים — "מועד הכניסה משפיע על ההתאמות" עונה על
 * השאלה ששואל מי שממלא, במקום להשאיר אותו לנחש.
 */
export function FormSection({
  step,
  title,
  hint,
  children,
}: {
  /** מספר השלב. חסר = קבוצה משנית שאינה חלק מהרצף. */
  step?: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mv-form-section">
      <legend className="mv-visually-hidden">{title}</legend>
      <div className="mb-4 flex items-start gap-2.5" aria-hidden="true">
        {step !== undefined ? <span className="mv-step-badge">{step}</span> : null}
        <div className="min-w-0">
          <h2 className="m-0" style={{ fontSize: 15.5, fontWeight: 800 }}>
            {title}
          </h2>
          {hint !== undefined ? <p className="mv-form-hint">{hint}</p> : null}
        </div>
      </div>
      {children}
    </fieldset>
  );
}
