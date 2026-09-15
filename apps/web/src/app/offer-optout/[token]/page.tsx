"use client";

import { use } from "react";
import { EmailOptOut } from "../../email-optout";

/** ‏הקישור שבתחתית מייל ההצעות האוטומטי — הטוקן שייך ל-`Offer`. */
export default function OfferOptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <EmailOptOut path={`/public/offers/${token}/email-optout`} />;
}
