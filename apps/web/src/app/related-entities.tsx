"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MATURITY_LABELS } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { IconHome, IconPhone, IconUser } from "./icons";

/**
 * תיק לקוח מאוחד (docs/03): צ'יפים "לאדם הזה יש גם…" — קונה פעיל,
 * לידים קודמים, נכסים בבעלותו. ליד חוזר מפסיק להיראות כמו זר.
 * מוצג בעמוד ליד ובעמוד קונה; מוסתר כשאין שום ישות מקושרת אחרת.
 */

interface Related {
  buyers: { id: string; maturity: string }[];
  leads: { id: string; status: string; intent: string; createdAt: string }[];
  ownedProperties: { id: string; title: string; status: string }[];
}

const chipStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-surface)",
} as const;

export function RelatedEntities({
  contactId,
  exclude,
}: {
  contactId: string;
  /** הישות שמוצגת כרגע — לא מציגים אותה כקישור לעצמה */
  exclude?: { kind: "lead" | "buyer" | "property"; id: string };
}) {
  const [related, setRelated] = useState<Related | null>(null);

  useEffect(() => {
    apiGet<Related>(`/contacts/${contactId}/related`)
      .then(setRelated)
      .catch(() => setRelated(null)); // אין הרשאה/שגיאה — פשוט לא מציגים
  }, [contactId]);

  if (related === null) return null;
  // כל כרטיסי הקונה, לא רק הראשון: אחרי מיזוג כפילויות ייתכנו שניים
  // לאותו אדם, והשני היה נשאר בלי דרך להגיע אליו
  const buyers = related.buyers.filter(
    (b) => !(exclude?.kind === "buyer" && exclude.id === b.id),
  );
  const leads = related.leads.filter((l) => !(exclude?.kind === "lead" && exclude.id === l.id));
  const ownedProperties = related.ownedProperties.filter(
    (p) => !(exclude?.kind === "property" && exclude.id === p.id),
  );
  if (buyers.length === 0 && leads.length === 0 && ownedProperties.length === 0) return null;

  return (
    <section aria-label="ישויות מקושרות לאותו אדם" className="mb-4">
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {buyers.map((buyer) => (
          <li key={buyer.id}>
            <Link
              href={`/buyers/${buyer.id}`}
              className="inline-block rounded-full border px-3 py-1 text-sm underline"
              style={chipStyle}
            >
              <IconUser s={15} /> קונה פעיל · {MATURITY_LABELS[buyer.maturity] ?? buyer.maturity}
            </Link>
          </li>
        ))}
        {leads.map((l) => (
          <li key={l.id}>
            <Link
              href={`/leads/${l.id}`}
              className="inline-block rounded-full border px-3 py-1 text-sm underline"
              style={chipStyle}
            >
              <IconPhone s={15} /> ליד {LEAD_STATUS_LABELS[l.status] ?? l.status} · {formatDate(l.createdAt)}
            </Link>
          </li>
        ))}
        {ownedProperties.map((p) => (
          <li key={p.id}>
            <Link
              href={`/properties/${p.id}`}
              className="inline-block rounded-full border px-3 py-1 text-sm underline"
              style={chipStyle}
            >
              <IconHome s={15} /> בעלים של: {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
