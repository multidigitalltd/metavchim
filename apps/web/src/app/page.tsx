import { Button } from "@metavchim/ui";

/**
 * דשבורד — "מה דורש טיפול היום?" (docs/06 §2).
 * כרגע נתוני הדגמה סטטיים; יוחלפו ב-API כשמודולי הדומיין יעלו.
 */

const DEMO_ACTIONS = [
  {
    id: "1",
    title: "לחזור ליעקב כהן",
    detail: "ביקש שיחה על דירת 4 חדרים ברחוב חזון איש",
    action: "התקשר",
    urgent: true,
  },
  {
    id: "2",
    title: "להשלים מחיר לנכס ברחוב רבי עקיבא",
    detail: "הנכס 61% מוכן — חסרים מחיר ותאריך כניסה",
    action: "השלם פרטים",
    urgent: false,
  },
  {
    id: "3",
    title: "12 קונים מתאימים לנכס החדש",
    detail: "דירת 3 חדרים בבני ברק — התאמות מעל 85%",
    action: "שלח הצעות",
    urgent: false,
  },
] as const;

export default function DashboardPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">מה דורש טיפול היום?</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        שלוש הפעולות החשובות ביותר שלך, לפי סדר עדיפות.
      </p>

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="mv-visually-hidden">
          פעולות מומלצות
        </h2>
        <ul className="flex flex-col gap-3">
          {DEMO_ACTIONS.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div>
                <h3 className="font-semibold">
                  {item.urgent ? (
                    <span style={{ color: "var(--color-danger)" }} aria-hidden="true">
                      ●{" "}
                    </span>
                  ) : null}
                  {item.title}
                  {item.urgent ? <span className="mv-visually-hidden"> (דחוף)</span> : null}
                </h3>
                <p style={{ color: "var(--color-text-muted)" }}>{item.detail}</p>
              </div>
              <Button variant={item.urgent ? "primary" : "secondary"}>{item.action}</Button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
