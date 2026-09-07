"use client";

import { use } from "react";
import { EmailOptOut } from "../../email-optout";

/**
 * ‏הקישור שבתחתית מייל שנשלח ידנית מכרטיס — הטוקן שייך **לכרטיס**
 * ‏ולא להצעה, כי שליחה ידנית אינה יוצרת `Offer`.
 */
export default function ContactOptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <EmailOptOut path={`/public/contacts/${token}/email-optout`} />;
}
