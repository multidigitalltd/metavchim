"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BillingSection } from "../billing-section";

/**
 * מסך המנוי כעמוד עצמאי.
 *
 * התוכן עצמו יושב ב-BillingSection, שמוצג גם בלשונית "מנוי ותשלום"
 * של ניהול המשרד — עמוד שמגיעים אליו בקישור ישיר (למשל אחרי שהתקופה
 * הסתיימה) חייב להישאר, אבל שני עותקים של אותו מסך היו נפרדים
 * בשינוי המחיר הראשון.
 */

function BillingPageContent(): React.JSX.Element {
  const expired = useSearchParams().get("expired") === "1";
  return (
    <main className="mx-auto max-w-3xl pb-12">
      {/* הכותרת הסמנטית — הסרגל העליון מציג `<p>` בכוונה (app-shell) */}
      <h1 className="sr-only">מנוי ותשלומים</h1>
      <BillingSection expired={expired} />
    </main>
  );
}

export default function BillingPage(): React.JSX.Element {
  // useSearchParams מחייב גבול Suspense בבנייה סטטית של Next
  return (
    <Suspense fallback={<main className="py-10 text-center">טוען…</main>}>
      <BillingPageContent />
    </Suspense>
  );
}
