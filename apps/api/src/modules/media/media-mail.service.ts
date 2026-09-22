import { Injectable, Logger } from "@nestjs/common";
import {
  formatJerusalemDate,
  formatJerusalemTime,
  shekels,
  type EmailBadge,
  type EmailContent,
  type EmailDetail,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PlatformAdminNotifierService } from "../../core/platform-admin-notifier.service";

/**
 * המיילים של רכש המדיה — מקום אחד לכל שלב, לשלושה נמענים.
 *
 * ## למה שירות נפרד
 *
 * כל שלב בתהליך שולח לשלושה: ללקוח (מי שהזמין במשרד), למנהלי
 * הפלטפורמה, ולפעמים לנציג המדיה. שישה שלבים כפול שלושה נמענים הם
 * שמונה-עשרה הודעות, וכשהן מפוזרות בין השירותים כל אחת נראית
 * אחרת. כאן כולן בנויות מאותם חלקים — תג מצב, כותרת, פסקה אחת,
 * כרטיס פרטים, כפתור — ומייל של שלב אחד נראה כמו אחיו.
 *
 * ## מה נשלח למי
 *
 * | שלב | לקוח | מנהלי הפלטפורמה | נציג המדיה |
 * |---|---|---|---|
 * | הזמנה נפתחה (ממתינה לתשלום) | ✓ | ✓ | — |
 * | התשלום אושר | ✓ | ✓ | ✓ |
 * | התשלום נדחה | ✓ | ✓ | — |
 * | הפניה נשלחה | ✓ | ✓ | ✓ |
 * | ההזמנה בוטלה | ✓ | ✓ | — |
 * | הגיליון נסגר מחר | ✓ | ✓ | — |
 *
 * הנציג מקבל רק מה שהוא צריך לפעול עליו. הלקוח והפלטפורמה מקבלים
 * הכול: הלקוח כדי שידע איפה ההזמנה שלו, הפלטפורמה כי זו ההכנסה שלה.
 *
 * ## כישלון שליחה אינו כישלון של השלב
 *
 * ההזמנה כבר נרשמה, התשלום כבר נתפס. מייל שנפל נרשם ביומן ואינו
 * מחזיר שגיאה למי שלחץ. היוצא מן הכלל הוא המייל לנציג — שם
 * `required: true`, כי „נמסר למדיה” חייב להיות אמת (ראו `notifiedAt`).
 */

export interface MailOrder {
  id: string;
  kind: string;
  outletName: string;
  productName: string;
  quantity: number;
  amountAgorot: number;
  commissionAgorot: number;
  leadFeeAgorot: number | null;
  brief: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  officeName: string;
  customerNo: number | null;
  createdAt: Date;
}

export interface MailOutlet {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  closingText: string;
  nextClosingAt: Date | null;
}

@Injectable()
export class MediaMailService {
  private readonly logger = new Logger(MediaMailService.name);

  constructor(
    private readonly email: EmailService,
    private readonly admins: PlatformAdminNotifierService,
  ) {}

  /** הזמנה בתשלום נפתחה — ממתינה לתשלום. */
  async orderStarted(order: MailOrder, outlet: MailOutlet | null): Promise<void> {
    const badge: EmailBadge = { label: "ממתין לתשלום", tone: "warning" };
    await this.toClient(order, "started", {
      badge,
      heading: `ההזמנה ב${order.outletName} נפתחה`,
      paragraphs: [
        `פתחתם הזמנה של ${order.productName} ב${order.outletName}. ההזמנה תישלח למדיה מיד אחרי שהתשלום יאושר.`,
        "אם דף התשלום נסגר לפני שסיימתם — אפשר להמשיך לתשלום מרשימת ההזמנות בכל עת.",
      ],
      details: this.clientDetails(order, outlet),
      button: this.clientButton("להמשך לתשלום"),
    });
    await this.toAdmins(order, {
      subject: `נפתחה הזמנה — ${order.outletName} — ${order.officeName}`,
      badge,
      heading: "הזמנת מדיה נפתחה — ממתינה לתשלום",
      paragraphs: [`${this.officeLine(order)} פתח הזמנה של ${order.productName} ב${order.outletName}.`],
      details: this.adminDetails(order, outlet),
    });
  }

  /**
   * התשלום אושר — לנציג (חובה), למנהלים, וללקוח.
   * מחזיר האם המייל לנציג יצא בפועל — זה מה שקובע את `notifiedAt`.
   */
  async orderPaid(order: MailOrder, outlet: MailOutlet | null): Promise<{ outletDelivered: boolean }> {
    const badge: EmailBadge = { label: "שולם ונשלח למדיה", tone: "success" };
    const outletDelivered = await this.toOutlet(order, outlet, "paid", {
      badge: { label: "הזמנה חדשה — שולמה", tone: "success" },
      heading: "הזמנת פרסום חדשה",
      paragraphs: [
        `משרד ${order.officeName} הזמין ושילם במערכת על ${order.productName} ב${order.outletName}.`,
      ],
      footnote: "התשלום נגבה על ידי המערכת; ההתחשבנות מול המגזין לפי ההסכם.",
    });
    await this.toAdmins(order, {
      subject: `שולם — ${order.outletName} — ${order.officeName}`,
      badge,
      heading: "הזמנת מדיה שולמה",
      paragraphs: [
        `${this.officeLine(order)} שילם על ${order.productName} ב${order.outletName}.`,
        this.deliveryLine(outlet, outletDelivered),
      ],
      details: this.adminDetails(order, outlet),
    });
    await this.toClient(order, "paid", {
      badge,
      heading: "התשלום התקבל — ההזמנה הועברה למדיה",
      paragraphs: [
        `התשלום על ${order.productName} ב${order.outletName} התקבל, וההזמנה הועברה למדיה.`,
        this.outletContactLine(outlet),
      ],
      details: this.clientDetails(order, outlet),
      button: this.clientButton("להזמנות שלי"),
    });
    return { outletDelivered };
  }

  /** הפניה נשלחה לנציג — בלי תשלום. */
  async referralSent(order: MailOrder, outlet: MailOutlet | null): Promise<{ outletDelivered: boolean }> {
    const badge: EmailBadge = { label: "הפניה נשלחה", tone: "info" };
    const outletDelivered = await this.toOutlet(order, outlet, "referred", {
      badge: { label: "פנייה חדשה", tone: "info" },
      heading: "פנייה חדשה לפרסום",
      paragraphs: [
        `משרד ${order.officeName} מבקש לפרסם ב${order.outletName}: ${order.productName}. הפנייה נשלחת אליך לתיאום ישיר מול המשרד.`,
      ],
      footnote: "הפנייה נמסרה דרך מערכת מתווכים. התמורה על ההפניה לפי ההסכם.",
    });
    await this.toAdmins(order, {
      subject: `הפניה — ${order.outletName} — ${order.officeName}`,
      badge,
      heading: "פנייה למדיה נשלחה",
      paragraphs: [
        `${this.officeLine(order)} ביקש ${order.productName} ב${order.outletName}.`,
        this.deliveryLine(outlet, outletDelivered),
      ],
      details: this.adminDetails(order, outlet),
    });
    await this.toClient(order, "referred", {
      badge,
      heading: "הפנייה נשלחה לנציג המדיה",
      paragraphs: [
        `הפנייה שלכם על ${order.productName} ב${order.outletName} הועברה לנציג המדיה, והוא יחזור אליכם לתיאום מחיר ומועד.`,
        this.outletContactLine(outlet),
      ],
      details: this.clientDetails(order, outlet),
      button: this.clientButton("להזמנות שלי"),
    });
    return { outletDelivered };
  }

  /** הסולק דחה את התשלום — ההזמנה לא נשלחה. */
  async orderFailed(order: MailOrder, outlet: MailOutlet | null): Promise<void> {
    const badge: EmailBadge = { label: "התשלום לא הושלם", tone: "danger" };
    await this.toClient(order, "failed", {
      badge,
      heading: "התשלום לא הושלם — ההזמנה לא נשלחה",
      paragraphs: [
        `התשלום על ${order.productName} ב${order.outletName} לא אושר על ידי חברת הסליקה. לא בוצע חיוב, וההזמנה לא הועברה למדיה.`,
        "אפשר לנסות שוב, גם בכרטיס אחר, מרשימת ההזמנות.",
      ],
      details: this.clientDetails(order, outlet),
      button: this.clientButton("לנסות שוב"),
    });
    await this.toAdmins(order, {
      subject: `תשלום נדחה — ${order.outletName} — ${order.officeName}`,
      badge,
      heading: "תשלום על הזמנת מדיה נדחה",
      paragraphs: [
        `${this.officeLine(order)} ניסה לשלם על ${order.productName} ב${order.outletName} והסולק דחה. ההזמנה ממתינה; הלקוח קיבל הודעה עם „לנסות שוב”.`,
      ],
      details: this.adminDetails(order, outlet),
    });
  }

  /** הלקוח ביטל הזמנה שממתינה לתשלום. */
  async orderCancelled(order: MailOrder, outlet: MailOutlet | null): Promise<void> {
    const badge: EmailBadge = { label: "בוטל", tone: "neutral" };
    await this.toClient(order, "cancelled", {
      badge,
      heading: "ההזמנה בוטלה",
      paragraphs: [
        `ההזמנה של ${order.productName} ב${order.outletName} בוטלה. לא בוצע חיוב, ולא נשלח דבר למדיה.`,
        "אפשר להזמין שוב מהארכיון בכל עת.",
      ],
      details: this.clientDetails(order, outlet),
      button: { label: "לארכיון המדיות", url: `${this.origin()}/media` },
    });
    await this.toAdmins(order, {
      subject: `בוטל — ${order.outletName} — ${order.officeName}`,
      badge,
      heading: "הזמנת מדיה בוטלה לפני תשלום",
      paragraphs: [`${this.officeLine(order)} ביטל הזמנה של ${order.productName} ב${order.outletName}.`],
      details: this.adminDetails(order, outlet),
    });
  }

  /** הגיליון נסגר מחר וההזמנה עדיין ממתינה לתשלום. */
  async closingReminder(order: MailOrder, outlet: MailOutlet, closingAt: Date): Promise<void> {
    const badge: EmailBadge = { label: "הגיליון נסגר מחר", tone: "warning" };
    const when = `${formatJerusalemDate(closingAt)} בשעה ${formatJerusalemTime(closingAt)}`;
    const key = `media-closing:${order.id}:${closingAt.getTime()}`;
    await this.toClient(
      order,
      "closing",
      {
        badge,
        heading: `${order.outletName} נסגר מחר — ההזמנה ממתינה לתשלום`,
        paragraphs: [
          `ההזמנה שלכם — ${order.productName} ב${order.outletName} — עדיין ממתינה לתשלום, והגיליון נסגר ב-${when}.`,
          "כדי שהמודעה תיכנס לגיליון הזה, השלימו את התשלום. הזמנה שלא שולמה עד הסגירה נכנסת לגיליון הבא.",
        ],
        details: this.clientDetails(order, outlet),
        button: this.clientButton("להשלמת ההזמנה"),
        footnote: "הודעה אוטומטית ממערכת מתווכים. אם כבר שילמתם, אין צורך לעשות דבר.",
      },
      key,
    );
    await this.toAdmins(order, {
      subject: `נסגר מחר — ${order.outletName} — ${order.officeName} ממתין לתשלום`,
      badge,
      heading: "תזכורת סגירת גיליון נשלחה",
      paragraphs: [
        `${this.officeLine(order)} עדיין לא שילם על ${order.productName} ב${order.outletName}; הגיליון נסגר ב-${when}. הלקוח קיבל תזכורת.`,
      ],
      details: this.adminDetails(order, outlet),
    });
  }

  /* ==================== הרכבה ==================== */

  /** הפרטים שהלקוח רואה — בלי עמלה, בלי פרטי המשרד שלו עצמו. */
  private clientDetails(order: MailOrder, outlet: MailOutlet | null): EmailDetail[] {
    const rows: EmailDetail[] = [
      { label: "מדיה", value: order.outletName },
      { label: "מוצר", value: order.quantity > 1 ? `${order.productName} × ${order.quantity}` : order.productName },
    ];
    if (order.kind === "paid") {
      rows.push({ label: "סכום", value: `${shekels(order.amountAgorot)} ₪ + מע"מ` });
    } else {
      rows.push({ label: "מחיר", value: "לפי תיאום עם הנציג" });
    }
    rows.push({ label: "איש קשר במשרד", value: `${order.contactName}, ${order.contactPhone}` });
    if (outlet !== null) {
      const closing = this.closingLine(outlet);
      if (closing !== null) rows.push({ label: "סגירת גיליון", value: closing });
    }
    if (order.brief !== "") rows.push({ label: "מה לפרסם", value: order.brief });
    rows.push({ label: "תאריך ההזמנה", value: formatJerusalemDate(order.createdAt) });
    rows.push({ label: "מספר הזמנה", value: order.id });
    return rows;
  }

  /** למנהלי הפלטפורמה — הכול, כולל המשרד והעמלה. */
  private adminDetails(order: MailOrder, outlet: MailOutlet | null): EmailDetail[] {
    const rows: EmailDetail[] = [
      {
        label: "משרד",
        value: order.customerNo === null ? order.officeName : `${order.officeName} (לקוח ${order.customerNo})`,
      },
      { label: "מדיה", value: order.outletName },
      { label: "מוצר", value: order.quantity > 1 ? `${order.productName} × ${order.quantity}` : order.productName },
    ];
    if (order.kind === "paid") {
      rows.push({ label: "סכום נטו", value: `${shekels(order.amountAgorot)} ₪` });
      rows.push({ label: "עמלת הפלטפורמה", value: `${shekels(order.commissionAgorot)} ₪` });
      rows.push({ label: "חלקה של המדיה", value: `${shekels(order.amountAgorot - order.commissionAgorot)} ₪` });
    } else if (order.leadFeeAgorot !== null) {
      rows.push({ label: "תמורה על ההפניה", value: `${shekels(order.leadFeeAgorot)} ₪` });
    }
    rows.push({
      label: "איש קשר במשרד",
      value: `${order.contactName}, ${order.contactPhone}, ${order.contactEmail}`,
    });
    if (outlet !== null) {
      rows.push({
        label: "נציג המדיה",
        value:
          outlet.contactEmail === ""
            ? "לא הוגדר — ההזמנה לא נשלחה לאיש מלבדכם"
            : [outlet.contactName, outlet.contactEmail, outlet.contactPhone].filter(Boolean).join(", "),
      });
      const closing = this.closingLine(outlet);
      if (closing !== null) rows.push({ label: "סגירת גיליון", value: closing });
    }
    if (order.brief !== "") rows.push({ label: "מה לפרסם", value: order.brief });
    rows.push({ label: "תאריך ההזמנה", value: formatJerusalemDate(order.createdAt) });
    rows.push({ label: "מספר הזמנה", value: order.id });
    return rows;
  }

  /** לנציג — מה להכין, ועם מי לדבר. */
  private outletDetails(order: MailOrder): EmailDetail[] {
    const rows: EmailDetail[] = [
      { label: "משרד", value: order.officeName },
      { label: "מוצר", value: order.quantity > 1 ? `${order.productName} × ${order.quantity}` : order.productName },
    ];
    if (order.kind === "paid") {
      rows.push({ label: "סכום", value: `${shekels(order.amountAgorot)} ₪ + מע"מ (שולם במערכת)` });
    }
    rows.push({ label: "איש קשר במשרד", value: `${order.contactName}, ${order.contactPhone}, ${order.contactEmail}` });
    if (order.brief !== "") rows.push({ label: "מה לפרסם", value: order.brief });
    rows.push({ label: "תאריך ההזמנה", value: formatJerusalemDate(order.createdAt) });
    rows.push({ label: "מספר הזמנה", value: order.id });
    return rows;
  }

  private closingLine(outlet: MailOutlet): string | null {
    if (outlet.nextClosingAt !== null) {
      return `${formatJerusalemDate(outlet.nextClosingAt)} בשעה ${formatJerusalemTime(outlet.nextClosingAt)}`;
    }
    return outlet.closingText === "" ? null : outlet.closingText;
  }

  private outletContactLine(outlet: MailOutlet | null): string {
    if (outlet === null || (outlet.contactName === "" && outlet.contactPhone === "")) {
      return "נציג המדיה יחזור אליכם.";
    }
    return `נציג המדיה: ${[outlet.contactName, outlet.contactPhone].filter(Boolean).join(", ")}.`;
  }

  private deliveryLine(outlet: MailOutlet | null, delivered: boolean): string {
    if (outlet === null || outlet.contactEmail === "") {
      return "למדיה הזו לא הוגדר איש קשר — ההזמנה לא נשלחה לאיש מלבדכם. יש להגדיר כתובת במסך הפלטפורמה ולהעביר ידנית.";
    }
    return delivered
      ? `נשלח לנציג המדיה: ${outlet.contactName || outlet.contactEmail}.`
      : `המייל לנציג המדיה (${outlet.contactEmail}) לא יצא — ההזמנה מסומנת „לא נשלח”, ואפשר לשלוח שוב ממסך הפלטפורמה.`;
  }

  private officeLine(order: MailOrder): string {
    return order.customerNo === null
      ? `משרד ${order.officeName}`
      : `משרד ${order.officeName} (לקוח ${order.customerNo})`;
  }

  private clientButton(label: string): { label: string; url: string } {
    return { label, url: `${this.origin()}/media/orders` };
  }

  private origin(): string {
    return loadEnv().WEB_ORIGIN;
  }

  /* ==================== שליחה ==================== */

  /**
   * ללקוח — רך: כישלון נרשם ואינו זורק. המפתח הוא ההזמנה והשלב, כך
   * ששליחה חוזרת של אותו שלב (סבב נוסף, ניסיון חוזר) אינה מכפילה.
   */
  private async toClient(
    order: MailOrder,
    step: string,
    content: EmailContent & { heading: string },
    key = `media-order:${order.id}:${step}:client`,
  ): Promise<void> {
    if (order.contactEmail === "") return;
    try {
      await this.email.send(
        order.contactEmail,
        content.heading,
        { greeting: `שלום ${order.contactName},`, ...content },
        { idempotency: { key, purpose: "media" }, autoGenerated: true },
      );
    } catch (error) {
      this.logger.warn(`מייל ${step} ללקוח על הזמנה ${order.id} נכשל: ${(error as Error).message}`);
    }
  }

  /**
   * לנציג המדיה — חובה: בלי דואר מוגדר השליחה נכשלת במקום לשתוק,
   * ו„נמסר” נשאר אמת. תשובה של הנציג חוזרת ישירות למזמין.
   */
  private async toOutlet(
    order: MailOrder,
    outlet: MailOutlet | null,
    step: string,
    content: EmailContent & { heading: string },
  ): Promise<boolean> {
    if (outlet === null || outlet.contactEmail === "") return false;
    try {
      await this.email.send(
        outlet.contactEmail,
        `${content.heading} — ${order.outletName} — ${order.officeName}`,
        {
          ...(outlet.contactName === "" ? {} : { greeting: `שלום ${outlet.contactName},` }),
          ...content,
          details: this.outletDetails(order),
        },
        {
          idempotency: { key: `media-order:${order.id}:outlet`, purpose: "media" },
          required: true,
          autoGenerated: true,
          replyTo: order.contactEmail,
        },
      );
      return true;
    } catch (error) {
      this.logger.warn(`מייל ${step} לנציג המדיה על הזמנה ${order.id} נכשל: ${(error as Error).message}`);
      return false;
    }
  }

  /** למנהלי הפלטפורמה — דרך המודיע, שאינו זורק ומאחד כתובות. */
  private async toAdmins(
    order: MailOrder,
    notice: {
      subject: string;
      badge: EmailBadge;
      heading: string;
      paragraphs: string[];
      details: EmailDetail[];
    },
  ): Promise<void> {
    await this.admins.notify({
      subject: `[רכש מדיה] ${notice.subject}`,
      heading: notice.heading,
      paragraphs: notice.paragraphs,
      badge: notice.badge,
      details: notice.details,
      button: { label: "להזמנות המדיה", url: `${this.origin()}/platform?tab=media` },
      footnote: `הזמנה ${order.id} · מערכת מתווכים`,
    });
  }
}
