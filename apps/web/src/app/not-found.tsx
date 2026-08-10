import Link from "next/link";
import { IconSearch } from "./icons";

/** עמוד 404 — קישור ישר חזרה לעבודה במקום מסך שגיאה גנרי באנגלית. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="mb-2" aria-hidden="true">
        <IconSearch s={48} />
      </p>
      <h1 className="mb-2 text-2xl font-bold">העמוד לא נמצא</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        ייתכן שהקישור השתנה או שהפריט הועבר לארכיון.
      </p>
      <p className="flex flex-wrap justify-center gap-4">
        <Link href="/" className="underline">
          לדשבורד
        </Link>
        <Link href="/properties" className="underline">
          לנכסים
        </Link>
        <Link href="/buyers" className="underline">
          לקונים
        </Link>
      </p>
    </div>
  );
}
