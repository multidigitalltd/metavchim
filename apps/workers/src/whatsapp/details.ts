import {
  appointmentKindLabel,
  shekelLabel,
  propertyHeadline,
  OfferPresentationSchema,
  type NotifyDetail,
  type NotifyPerson,
  propertyAddressOr,
} from "@metavchim/shared";
import { withTenant } from "../runtime.js";
import { decryptSetting } from "./config.js";

/* ==================== הפרטים שההתראה נושאת ==================== */

/**
 * כמה נכסים מקבלים את רשימת הקונים שנמצאו להם, וכמה קונים בכל אחד.
 *
 * שניהם גבולות של **סבב**, לא של תצוגה: הסבב רץ בכל דקה על כל
 * משרד, ומשרד שהעלה חמישים נכסים ביום אחד לא אמור להפוך אותו
 * לסריקה. שלושה קונים הם גם מה שנכנס להודעה בלי לבלוע את שאר
 * הפריטים שבה.
 */
const MATCH_DETAIL_PROPERTIES = 10;
const MATCH_DETAIL_BUYERS = 3;

/** מה שנטען מהמסד לכל התראה, לפני שער ההרשאה. */
type NotifyDetailMap = Map<string, NotifyDetail>;

interface PendingNotification {
  id: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
}

/** אוסף מזהים לפי סוג — הבסיס לטעינה אחת לכל טבלה במקום אחת לשורה. */
function idsOf(items: readonly PendingNotification[], entityType: string): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.entityType === entityType && item.entityId !== null) ids.add(item.entityId);
  }
  return [...ids];
}

function addAll(target: Set<string>, values: readonly (string | null)[]): void {
  for (const value of values) if (value !== null) target.add(value);
}

/** שם וטלפון מפוענחים. כרטיס שאי אפשר לפענח אינו מוצג כ„???”. */
function personOf(
  contact: { nameEncrypted: string; phoneEncrypted: string } | undefined,
): NotifyPerson | null {
  if (contact === undefined) return null;
  const name = decryptSetting(contact.nameEncrypted);
  if (name === null || name === "") return null;
  const phone = decryptSetting(contact.phoneEncrypted);
  return { name, phone: phone === null || phone === "" ? null : phone };
}

function moneyOf(agorot: bigint | null): string | null {
  return agorot === null ? null : shekelLabel(Number(agorot));
}

/** טווח החדרים כפי שהוא נאמר — "3–4 חדרים", "מ-4 חדרים", "4 חדרים". */
function roomsLabel(min: unknown, max: unknown): string | null {
  const lo = min === null || min === undefined ? null : Number(min);
  const hi = max === null || max === undefined ? null : Number(max);
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null) return lo === hi ? `${lo} חדרים` : `${lo}–${hi} חדרים`;
  return lo !== null ? `מ-${lo} חדרים` : `עד ${hi} חדרים`;
}

function budgetLabel(min: bigint | null, max: bigint | null): string | null {
  if (max !== null) return `עד ${shekelLabel(Number(max))}`;
  if (min !== null) return `מ-${shekelLabel(Number(min))}`;
  return null;
}

/**
 * ‎**הפרטים שמאחורי ההתראה — טעינה אחת למשרד, לא אחת לשורה.**
 *
 * ההתראה עצמה נושאת רק כותרת ומזהה ישות, וזה בדיוק מה שהפך את
 * ההודעה בוואטסאפ לבלתי-שמישה: „הקונה פתח את ההצעה” בלי לומר
 * איזה קונה. כאן נטענות השורות, מפוענח ה-PII, ונבנה אובייקט
 * עובדות — **בלי להחליט למי מותר לראות אותו.** ההחלטה הזו נעשית
 * פר-נמען ב-`canSeeNotifyDetail`, כי אותה התראה משרדית מגיעה
 * לכמה סוכנים עם הרשאות שונות.
 *
 * שלושה סבבים ולא שאילתה לשורה: הסבב הראשון פותח ישויות שמצביעות
 * על אחרות (הצעה → התאמה, משימה ופגישה → הכרטיס שלהן), השני טוען
 * את הכרטיסים עצמם, והשלישי את אנשי הקשר. כישלון בכל אחד מהם אינו
 * מפיל את הסבב — התראה בלי פרטים היא בדיוק מה שהיה עד היום.
 */
export async function loadNotifyDetails(
  tenantId: string,
  items: readonly PendingNotification[],
): Promise<NotifyDetailMap> {
  const details: NotifyDetailMap = new Map();
  const withEntity = items.filter((item) => item.entityId !== null);
  if (withEntity.length === 0) return details;

  try {
    return await withTenant(tenantId, async (tx) => {
      /* ---------- סבב א': ישויות שמצביעות על אחרות ---------- */

      const offerIds = idsOf(withEntity, "offer");
      const offers =
        offerIds.length === 0
          ? []
          : await tx.offer.findMany({
              where: { tenantId, id: { in: offerIds } },
              select: { id: true, matchId: true, openCount: true, presentation: true },
            });
      const offerMatches =
        offers.length === 0
          ? []
          : await tx.match.findMany({
              where: { tenantId, id: { in: offers.map((offer) => offer.matchId) } },
              select: {
                id: true,
                propertyId: true,
                buyerId: true,
                explanation: true,
              },
            });
      const matchById = new Map(offerMatches.map((match) => [match.id, match]));

      const taskIds = idsOf(withEntity, "task");
      const tasks =
        taskIds.length === 0
          ? []
          : await tx.task.findMany({
              where: { tenantId, id: { in: taskIds } },
              select: {
                id: true,
                title: true,
                dueAt: true,
                assignedToUserId: true,
                entityType: true,
                entityId: true,
              },
            });

      const appointmentIds = idsOf(withEntity, "appointment");
      const appointments =
        appointmentIds.length === 0
          ? []
          : await tx.appointment.findMany({
              where: { tenantId, id: { in: appointmentIds } },
              select: {
                id: true,
                kind: true,
                startsAt: true,
                ownerUserId: true,
                propertyId: true,
                buyerId: true,
                leadId: true,
              },
            });

      /*
       * הסיכום השבועי של המנטור — לא כרטיס אלא מה שיש בו: בקשה
       * לשבוע הבא ושאלה, שמהן נגזרים הכפתורים. הגוף נשמר כ-JSON
       * (`MentorReviewBody`), ומספיק לדעת אם השדות קיימים.
       */
      const reviewIds = idsOf(withEntity, "mentor");
      const reviews =
        reviewIds.length === 0
          ? []
          : await tx.mentorReview.findMany({
              where: { tenantId, id: { in: reviewIds } },
              select: { id: true, userId: true, body: true },
            });
      const reviewById = new Map(reviews.map((review) => [review.id, review]));

      /* ---------- סבב ב': הכרטיסים עצמם ---------- */

      const propertyIds = new Set(idsOf(withEntity, "property"));
      const buyerIds = new Set(idsOf(withEntity, "buyer"));
      const leadIds = new Set(idsOf(withEntity, "lead"));
      const contactIds = new Set(idsOf(withEntity, "contact"));

      for (const match of offerMatches) {
        propertyIds.add(match.propertyId);
        buyerIds.add(match.buyerId);
      }
      for (const appointment of appointments) {
        addAll(propertyIds, [appointment.propertyId]);
        addAll(buyerIds, [appointment.buyerId]);
        addAll(leadIds, [appointment.leadId]);
      }
      /*
       * ‎**וגם שורות גיוס** (ביקורת Codex, P2).
       *
       * ‏„גיוס” נכנס לאוצר המילים של המשימות ולא לכאן, ולכן פולואפ
       * ‏עליו הפיק `about: null` — תזכורת „לחזור לבעלים” בלי לומר
       * ‏על איזה נכס, כלומר בדיוק המידע שבגללו שולחים אותה.
       */
      const recruitmentIds = new Set<string>();
      for (const task of tasks) {
        if (task.entityId === null) continue;
        if (task.entityType === "property") propertyIds.add(task.entityId);
        if (task.entityType === "buyer") buyerIds.add(task.entityId);
        if (task.entityType === "lead") leadIds.add(task.entityId);
        if (task.entityType === "recruitment") recruitmentIds.add(task.entityId);
      }
      const recruitmentTargets =
        recruitmentIds.size === 0
          ? []
          : await tx.recruitmentTarget.findMany({
              where: { tenantId, id: { in: [...recruitmentIds] }, deletedAt: null },
              select: {
                id: true,
                street: true,
                houseNumber: true,
                neighborhood: true,
                city: true,
              },
            });
      const recruitmentAddressById = new Map(
        recruitmentTargets.map((target) => [
          target.id,
          propertyAddressOr(target, "נכס לגיוס"),
        ]),
      );

      /*
       * ‎**מי הקונים שנמצאו** — ההתאמות של נכס שקיבל התראת התאמה.
       *
       * ‏„נמצא קונה חדש שמתאים לנכס” בלי לומר מי הוא, זו בדיוק
       * ההתראה שאילצה כניסה למערכת. שלוש החזקות ביותר, לפי ציון —
       * מי שיש לו עשר התאמות יתקשר קודם לטובה שבהן.
       */
      const matchNotified = [
        ...new Set(
          withEntity
            .filter(
              (item) =>
                item.entityType === "property" &&
                (item.type === "matches_found" || item.type === "opportunity_opened"),
            )
            .map((item) => item.entityId)
            .filter((id): id is string => id !== null),
        ),
      ].slice(0, MATCH_DETAIL_PROPERTIES);
      /*
       * שאילתה לכל נכס ולא אחת ל-`in` — ו**בכוונה**. מיון משותף
       * לפי נכס ואז ציון מחייב לשלוף את כל התאמותיו של הראשון לפני
       * שמגיעים לשני; נכס עם מאות התאמות היה מרעיב את השאר, או
       * שהיינו טוענים את כולן לזיכרון בכל סבב. `take: 3` לכל נכס
       * הוא הגבול היחיד שנשמר גם כשמספר ההתאמות גדל, ומספר הנכסים
       * חסום מלמעלה ממילא.
       */
      const matchesOfProperty = new Map<
        string,
        { propertyId: string; buyerId: string; explanation: string; score: number }[]
      >();
      for (const propertyId of matchNotified) {
        const rows = await tx.match.findMany({
          where: { tenantId, propertyId, status: "suggested" },
          orderBy: { score: "desc" },
          take: MATCH_DETAIL_BUYERS,
          select: { propertyId: true, buyerId: true, explanation: true, score: true },
        });
        if (rows.length === 0) continue;
        matchesOfProperty.set(propertyId, rows);
        for (const match of rows) buyerIds.add(match.buyerId);
      }

      const properties =
        propertyIds.size === 0
          ? []
          : await tx.property.findMany({
              where: { tenantId, id: { in: [...propertyIds] } },
              select: {
                id: true,
                city: true,
                neighborhood: true,
                street: true,
                houseNumber: true,
                rooms: true,
                priceAgorot: true,
              },
            });
      const propertyById = new Map(properties.map((property) => [property.id, property]));

      const buyers =
        buyerIds.size === 0
          ? []
          : await tx.buyer.findMany({
              where: { tenantId, id: { in: [...buyerIds] } },
              select: {
                id: true,
                contactId: true,
                ownerUserId: true,
                cities: true,
                budgetMinAgorot: true,
                budgetMaxAgorot: true,
                roomsMin: true,
                roomsMax: true,
              },
            });
      const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer]));

      const leads =
        leadIds.size === 0
          ? []
          : await tx.lead.findMany({
              where: { tenantId, id: { in: [...leadIds] } },
              select: {
                id: true,
                contactId: true,
                assignedToUserId: true,
                source: true,
                summary: true,
                propertyId: true,
              },
            });
      const leadById = new Map(leads.map((lead) => [lead.id, lead]));

      /* ---------- סבב ג': אנשי הקשר ---------- */

      for (const buyer of buyers) contactIds.add(buyer.contactId);
      for (const lead of leads) contactIds.add(lead.contactId);
      const contacts =
        contactIds.size === 0
          ? []
          : await tx.contact.findMany({
              where: { tenantId, id: { in: [...contactIds] } },
              select: { id: true, nameEncrypted: true, phoneEncrypted: true },
            });
      const contactById = new Map(contacts.map((contact) => [contact.id, contact]));

      const headlineOf = (propertyId: string | null): string | null => {
        if (propertyId === null) return null;
        const property = propertyById.get(propertyId);
        if (property === undefined) return null;
        return propertyHeadline({
          street: property.street ?? undefined,
          houseNumber: property.houseNumber ?? undefined,
          neighborhood: property.neighborhood ?? undefined,
          city: property.city ?? undefined,
          rooms: property.rooms === null ? undefined : Number(property.rooms),
        });
      };
      const buyerPerson = (buyerId: string | null): NotifyPerson | null =>
        buyerId === null ? null : personOf(contactById.get(buyerById.get(buyerId)?.contactId ?? ""));

      /* ---------- ההרכבה ---------- */

      const offerById = new Map(offers.map((offer) => [offer.id, offer]));
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const appointmentById = new Map(appointments.map((row) => [row.id, row]));

      for (const item of withEntity) {
        const id = item.entityId;
        if (id === null) continue;
        switch (item.entityType) {
          case "lead": {
            const lead = leadById.get(id);
            if (lead === undefined) break;
            details.set(item.id, {
              kind: "lead",
              ownerUserId: lead.assignedToUserId,
              person: personOf(contactById.get(lead.contactId)),
              source: lead.source,
              summary: lead.summary,
              property: headlineOf(lead.propertyId),
            });
            break;
          }
          case "buyer": {
            const buyer = buyerById.get(id);
            if (buyer === undefined) break;
            details.set(item.id, {
              kind: "buyer",
              ownerUserId: buyer.ownerUserId,
              person: personOf(contactById.get(buyer.contactId)),
              budget: budgetLabel(buyer.budgetMinAgorot, buyer.budgetMaxAgorot),
              cities: buyer.cities,
              rooms: roomsLabel(buyer.roomsMin, buyer.roomsMax),
            });
            break;
          }
          case "property": {
            const property = propertyById.get(id);
            if (property === undefined) break;
            const matched = matchesOfProperty.get(id) ?? [];
            details.set(item.id, {
              kind: "property",
              ownerUserId: null,
              headline: headlineOf(id) ?? "נכס ללא כתובת",
              price: moneyOf(property.priceAgorot),
              /*
               * כל קונה עם הבעלים שלו — הסינון נעשה פר-נמען
               * ‏ב-`notifyDetailLines`, כי אותה שורה נשלחת לכמה
               * סוכנים עם הרשאות שונות.
               */
              people: matched.flatMap((match) => {
                const person = buyerPerson(match.buyerId);
                return person === null
                  ? []
                  : [{ person, ownerUserId: buyerById.get(match.buyerId)?.ownerUserId ?? null }];
              }),
              why: matched[0]?.explanation ?? null,
            });
            break;
          }
          case "offer": {
            const offer = offerById.get(id);
            const match = offer === undefined ? undefined : matchById.get(offer.matchId);
            if (offer === undefined || match === undefined) break;
            /*
             * ‎**מה שהקונה ראה, לא מה שהנכס אומר היום.**
             *
             * ‏`presentation` הוא ה-Snapshot הבלתי-משתנה שנשלח לקונה,
             * וזו כל הסיבה שהוא נשמר. נכס שהמחיר שלו ירד אתמול היה
             * גורם להתראה לומר „הקונה פתח הצעה על 1,900,000” על
             * הצעה שהוצגה לו ב-2,100,000 — כלומר המתווך מתקשר עם
             * מספר שהלקוח מעולם לא ראה. השורה הנוכחית היא הנפילה
             * בלבד, לשורות ישנות שנשמרו לפני שדה כזה.
             */
            const shown = OfferPresentationSchema.safeParse(offer.presentation);
            const snapshot = shown.success ? shown.data : null;
            const property = propertyById.get(match.propertyId);
            details.set(item.id, {
              kind: "offer",
              ownerUserId: buyerById.get(match.buyerId)?.ownerUserId ?? null,
              person: buyerPerson(match.buyerId),
              property: snapshot?.title ?? headlineOf(match.propertyId),
              price:
                snapshot?.priceAgorot === undefined
                  ? moneyOf(property?.priceAgorot ?? null)
                  : shekelLabel(snapshot.priceAgorot),
              openCount: offer.openCount,
              why: match.explanation,
            });
            break;
          }
          case "task": {
            const task = taskById.get(id);
            if (task === undefined) break;
            const about =
              task.entityType === "property"
                ? headlineOf(task.entityId)
                : task.entityType === "buyer"
                  ? (buyerPerson(task.entityId)?.name ?? null)
                  : task.entityType === "lead" && task.entityId !== null
                    ? (personOf(contactById.get(leadById.get(task.entityId)?.contactId ?? ""))
                        ?.name ?? null)
                    : task.entityType === "recruitment" && task.entityId !== null
                      ? (recruitmentAddressById.get(task.entityId) ?? null)
                      : null;
            details.set(item.id, {
              kind: "task",
              ownerUserId: task.assignedToUserId,
              title: task.title,
              dueAt: task.dueAt,
              about,
              /*
               * ‏שורת גיוס נשענת על `properties.view`, כמו הנתיב
               * ‏שלה וכמו התווית במסך המשימות. השאר רוכבים על
               * ‏נראות המשימה עצמה — ראו `TaskDetail.aboutNeeds`.
               */
              aboutNeeds: task.entityType === "recruitment" ? "properties.view" : null,
            });
            break;
          }
          case "appointment": {
            const appointment = appointmentById.get(id);
            if (appointment === undefined) break;
            const person =
              buyerPerson(appointment.buyerId) ??
              (appointment.leadId === null
                ? null
                : personOf(contactById.get(leadById.get(appointment.leadId)?.contactId ?? "")));
            details.set(item.id, {
              kind: "appointment",
              ownerUserId: appointment.ownerUserId,
              kindLabel: appointmentKindLabel(appointment.kind),
              startsAt: appointment.startsAt,
              property: headlineOf(appointment.propertyId),
              person,
            });
            break;
          }
          case "contact": {
            const person = personOf(contactById.get(id));
            if (person === null) break;
            details.set(item.id, { kind: "contact", ownerUserId: null, person });
            break;
          }
          case "mentor": {
            const review = reviewById.get(id);
            if (review === undefined) break;
            const body =
              typeof review.body === "object" && review.body !== null
                ? (review.body as { ask?: unknown; reflection?: unknown })
                : {};
            details.set(item.id, {
              kind: "mentor_review",
              ownerUserId: review.userId,
              ask: body.ask !== null && body.ask !== undefined,
              reflection: typeof body.reflection === "string" && body.reflection !== "",
            });
            break;
          }
          default:
            break;
        }
      }
      return details;
    });
  } catch (error) {
    /*
     * ‎**כישלון בהעשרה אינו מבטל את ההתראה.**
     *
     * מפתח הצפנה שאינו זמין, שאילתה שנכשלה — כל אלה מחזירים אותנו
     * בדיוק להתנהגות שהייתה עד היום: כותרת וקישור. התראה שלא נשלחה
     * בגלל שם שלא נטען היא הרעה משתי הרעות.
     */
    console.warn(`[notify] טעינת פרטי ההתראות נכשלה: ${String(error)}`);
    return new Map();
  }
}
