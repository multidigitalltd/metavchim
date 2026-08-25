import { Injectable } from "@nestjs/common";
import {
  buildRecommendations,
  computeReadiness,
  type CoachRecommendation,
  jerusalemDayRange,
  type CoachSignals,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ownershipFilter } from "../../common/ownership";
import { PrismaService } from "../../core/prisma.service";
import { rowToFields } from "../properties/property.mapper";
import { loadEnv } from "../../config/env";

/*
 * ‎**המלצה לא תנקוב בשם דבר שהיעד שלה אינו יכול להציג.**
 *
 * שני האותות שמפנים לרשימה — ולא לכרטיס — נבחרו בלי קשר לחלון
 * שהרשימה טוענת, ולכן „לפרטים” היה פותח מסך שהפריט שההמלצה דיברה
 * עליו אינו בתוכו (ביקורת Codex). שני הקבועים כאן הם החלונות של
 * המסכים ההם, והשאילתות למטה נחתכות לפיהם.
 *
 * הם מוצמדים למספרים שבצד השני ולא מנוחשים: אם מסך יורחב, המקום
 * לעדכן הוא כאן, ליד ההסבר למה הערך הוא הערך.
 */
/** `GET /offers` — ברירת המחדל של `limit` ב-`ListQuerySchema`. */
const OFFERS_PAGE_SIZE = 100;
/** היומן פותח בתחילת השבוע שלפני שבועיים — 14 יום נמצאים בתוכו תמיד. */
const VIEWING_FOLLOWUP_DAYS = 14;

/**
 * אוסף את האותות מהדאטה של הדייר (מכבד בעלות — סוכן רואה המלצות על
 * הישויות שלו) ומזין את מנוע הכללים הטהור מ-shared.
 */
@Injectable()
export class CoachService {
  constructor(private readonly prisma: PrismaService) {}

  async recommendations(): Promise<CoachRecommendation[]> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;
    // סיורים כוללים כותרות שעשויות להכיל שם לקוח — רק למי שרשאי ליומן
    const canSeeCalendar = ctx.capabilities.has("calendar.manage");
    const signals = await this.prisma.withTenant(async (tx): Promise<CoachSignals> => {
      const buyerScope = ownershipFilter("buyers.view_all", "ownerUserId");
      const leadScope = ownershipFilter("leads.view_all", "assignedToUserId");
      // מזהי הקונים שהמשתמש רשאי אליהם — לסינון הצעות מתלבטות לפי בעלות
      const scopedBuyerIds = (
        await tx.buyer.findMany({
          where: { tenantId, deletedAt: null, ...buyerScope },
          select: { id: true },
        })
      ).map((b) => b.id);

      // קונים חמים בלי הצעה כלל
      const hotBuyers = await tx.buyer.findMany({
        where: { tenantId, deletedAt: null, maturity: { in: ["very_hot", "hot"] }, ...buyerScope },
        select: { id: true },
      });
      const offers = await tx.offer.findMany({ where: { tenantId }, select: { matchId: true } });
      const offeredMatches = await tx.match.findMany({
        where: { tenantId, id: { in: offers.map((o) => o.matchId) } },
        select: { buyerId: true },
      });
      const offeredBuyerIds = new Set(offeredMatches.map((m) => m.buyerId));
      const hotBuyersWithoutOffer = hotBuyers.filter((b) => !offeredBuyerIds.has(b.id)).length;

      // נכסים פעילים עם התאמות מוצעות שטרם נשלחו
      const activeProps = await tx.property.findMany({
        where: { tenantId, deletedAt: null, status: { in: ["draft", "active"] } },
      });
      // ספירת התאמות מוצעות בשאילתה מקובצת אחת — לא N שאילתות (ביקורת Codex)
      const matchCounts = await tx.match.groupBy({
        by: ["propertyId"],
        where: {
          tenantId,
          status: "suggested",
          propertyId: { in: activeProps.map((p) => p.id) },
        },
        _count: { _all: true },
      });
      const matchCountByProperty = new Map(
        matchCounts.map((row) => [row.propertyId, row._count._all]),
      );
      const propertiesWithUnsentMatches: CoachSignals["propertiesWithUnsentMatches"] = [];
      const incompleteProperties: CoachSignals["incompleteProperties"] = [];
      for (const prop of activeProps) {
        const matchCount = matchCountByProperty.get(prop.id) ?? 0;
        const title =
          prop.marketingTitle ?? ([prop.street, prop.city].filter(Boolean).join(", ") || "נכס");
        if (matchCount > 0) {
          propertiesWithUnsentMatches.push({ propertyId: prop.id, title, matchCount });
        }
        const readiness = computeReadiness(rowToFields(prop), {
          hasTitle: Boolean(prop.marketingTitle),
          hasDescription: Boolean(prop.marketingDescription),
        });
        if (readiness.missingFields.length > 0) {
          incompleteProperties.push({
            propertyId: prop.id,
            title,
            missingCount: readiness.missingFields.length,
          });
        }
      }

      // הצעות שנפתחו 3+ פעמים ולא הביעו עניין — רק על קונים שהמשתמש רשאי
      // אליהם (סינון בעלות דרך match→buyer, ביקורת Codex)
      const scopedMatchIds = (
        await tx.match.findMany({
          where: { tenantId, buyerId: { in: scopedBuyerIds } },
          select: { id: true },
        })
      ).map((m) => m.id);
      /*
       * ‎**רק מתוך מה שמסך ההצעות באמת יציג.**
       *
       * ההמלצה מפנה ל-`/offers`, שטוען את מאה ההצעות האחרונות לפי
       * ‎`createdAt`. מיון לפי `openCount` בלבד בוחר דווקא הצעות
       * ישנות — הן צברו פתיחות לאורך זמן — ואז „לפרטים” פותח רשימה
       * שההצעה שנקבה בשמה אינה בתוכה (ביקורת Codex).
       *
       * לכן החלון נלקח קודם, בדיוק כמו במסך, והמתלבטים נבחרים
       * בתוכו. הבחירה נשארת „מי הכי מתלבט” — אבל מבין מי שאפשר
       * להגיע אליו.
       */
      /*
       * ‎**העמוד נלקח ברוחב הדייר, וסינון הבעלות חל אחריו** — בדיוק
       * הסדר של `OffersService.listAll`, שלוקח את מאה האחרונות של
       * המשרד ורק אז מסתיר שמות של קונים שאינם של הסוכן.
       *
       * הסדר ההפוך מייצר בדיוק את הפער שהוא נועד לסגור: במשרד עם
       * יותר ממאה הצעות, שבו החדשות שייכות לסוכנים אחרים, „מאה
       * האחרונות **של הסוכן**” מגיעות עמוק יותר לעבר מ„מאה
       * האחרונות של המשרד” — וההמלצה חוזרת לנקוב בהצעה שהמסך אינו
       * מציג (ביקורת Codex).
       */
      const listed = await tx.offer.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: OFFERS_PAGE_SIZE,
        select: { id: true, matchId: true, openCount: true, status: true, presentation: true },
      });
      const scoped = new Set(scopedMatchIds);
      const hesitating = listed
        .filter(
          (o) =>
            scoped.has(o.matchId) &&
            o.openCount >= 3 &&
            ["opened", "sent", "delivered"].includes(o.status),
        )
        .sort((a, b) => b.openCount - a.openCount)
        .slice(0, 10);
      const hesitatingOffers: CoachSignals["hesitatingOffers"] = [];
      for (const offer of hesitating) {
        const presentation = offer.presentation as { title?: string };
        hesitatingOffers.push({
          offerId: offer.id,
          propertyTitle: presentation.title ?? "נכס",
          openCount: offer.openCount,
        });
      }

      // לידים דחופים
      const urgent = await tx.lead.findMany({
        where: { tenantId, requiresHuman: true, status: { in: ["new", "in_progress"] }, ...leadScope },
        take: 5,
      });
      const urgentLeads: CoachSignals["urgentLeads"] = urgent.map((l) => ({
        leadId: l.id,
        // אין צורך בשם המלא כאן — ה-UI מקשר לליד; מונע פענוח PII מיותר
        contactName: "לקוח",
      }));

      // סיורים שהסתיימו בלי סיכום — רק למי שרשאי ליומן (הכותרת עשויה
      // להכיל שם לקוח, ביקורת Codex)
      let pastViewingsWithoutOutcome: CoachSignals["pastViewingsWithoutOutcome"] = [];
      if (canSeeCalendar) {
        /*
         * ‎**רק סיורים שהיומן עדיין מציג.**
         *
         * בלי גבול תחתון נבחר גם סיור מלפני חצי שנה, ו„לפרטים”
         * פותח יומן שמציג שבועיים אחורה — כלומר בלי הסיור שההמלצה
         * נקבה בשמו. בלי `orderBy` גם לא היה קבוע *אילו* חמישה
         * נבחרים (ביקורת Codex).
         *
         * החלון צר מזה של היומן ולא רחב ממנו: היומן פותח בתחילת
         * השבוע שלפני שבועיים, כלומר 14–20 יום אחורה לפי היום
         * בשבוע, ו-14 יום נמצאים בתוכו תמיד.
         */
        const viewingSince = new Date(Date.now() - VIEWING_FOLLOWUP_DAYS * 24 * 60 * 60 * 1000);
        const pastViewings = await tx.appointment.findMany({
          where: {
            tenantId,
            kind: "viewing",
            status: "scheduled",
            startsAt: { lt: new Date(), gte: viewingSince },
            outcome: null,
          },
          orderBy: { startsAt: "desc" },
          take: 5,
        });
        pastViewingsWithoutOutcome = pastViewings.map((a) => ({
          appointmentId: a.id,
          title: a.title ?? "סיור",
        }));
      }

      /*
       * ------- מה שבוער היום -------
       */
      const now = new Date();

      /*
       * ליד שלא נגעו בו מעל ה-SLA של המשרד. הסף מגיע מהסביבה ולא
       * קבוע כאן — משרד עמוס מגדיר אחרת ממשרד קטן.
       *
       * `updatedAt` ולא `createdAt`: המדד הוא "מתי נגעו בו לאחרונה",
       * וליד שנפתח לפני יומיים אבל טופל לפני שעה אינו ממתין.
       */
      const slaHours = loadEnv().LEAD_SLA_HOURS;
      const slaCutoff = new Date(now.getTime() - slaHours * 3_600_000);
      const candidates = await tx.lead.findMany({
        where: {
          tenantId,
          status: { in: ["new", "in_progress"] },
          updatedAt: { lt: slaCutoff },
          ...leadScope,
        },
        orderBy: { updatedAt: "asc" },
        take: 30,
        select: { id: true, updatedAt: true },
      });

      /*
       * **הנגיעה האחרונה אינה `updatedAt` של השורה.**
       *
       * רישום שיחה, הערה או מייל יוצא יוצרים `Interaction` ואינם
       * נוגעים בשורת הליד — כלומר ליד שטופל לפני חמש דקות היה מוצג
       * כ"ממתין חמש שעות", בראש הרשימה. התראת שווא במקום הכי דחוף
       * במסך היא מה שגורם לסוכנים להפסיק להאמין למסך.
       *
       * הסינון הגס נשאר על `updatedAt` (זול, מצמצם ל-30), והשיחות
       * נבדקות רק עליהם — בשאילתה אחת ולא אחת לכל ליד.
       */
      const lastTouch = new Map<string, Date>();
      if (candidates.length > 0) {
        const touches = await tx.interaction.groupBy({
          by: ["leadId"],
          where: { tenantId, leadId: { in: candidates.map((l) => l.id) } },
          _max: { createdAt: true },
        });
        for (const touch of touches) {
          if (touch.leadId !== null && touch._max.createdAt !== null) {
            lastTouch.set(touch.leadId, touch._max.createdAt);
          }
        }
      }

      const staleLeads: CoachSignals["staleLeads"] = candidates
        .map((l) => {
          const interaction = lastTouch.get(l.id);
          const touched =
            interaction !== undefined && interaction > l.updatedAt ? interaction : l.updatedAt;
          return { lead: l, touched };
        })
        .filter(({ touched }) => touched < slaCutoff)
        .sort((a, b) => a.touched.getTime() - b.touched.getTime())
        .slice(0, 5)
        .map(({ lead, touched }) => ({
          leadId: lead.id,
          // כמו בלידים הדחופים: ה-UI מקשר לליד, ואין צורך לפענח PII כאן
          contactName: "ליד",
          hoursWaiting: (now.getTime() - touched.getTime()) / 3_600_000,
        }));

      /* פגישות היום שטרם התקיימו — רק למי שרשאי ליומן, כמו הסיורים. */
      let todayAppointments: CoachSignals["todayAppointments"] = [];
      if (canSeeCalendar) {
        /*
         * גבול היום בשעון ישראל ולא בשעון התהליך: ה-API רץ ב-UTC,
         * ו-`setHours(23,59,59)` היה גורף פגישות של מחר לפנות בוקר,
         * ובין חצות המקומית לחצות ה-UTC מפספס כמעט את כל היום החדש.
         */
        const { end: endOfDay } = jerusalemDayRange(now);
        const upcoming = await tx.appointment.findMany({
          where: { tenantId, status: "scheduled", startsAt: { gte: now, lt: endOfDay } },
          orderBy: { startsAt: "asc" },
          take: 5,
          select: { id: true, title: true, startsAt: true, kind: true },
        });
        todayAppointments = upcoming.map((a) => ({
          appointmentId: a.id,
          title: a.title ?? (a.kind === "viewing" ? "סיור" : "פגישה"),
          startsAt: a.startsAt,
        }));
      }

      /* משימות באיחור — של המשתמש עצמו, לא של המשרד כולו. */
      const overdue = await tx.task.findMany({
        where: {
          tenantId,
          status: "open",
          assignedToUserId: ctx.userId,
          dueAt: { lt: now },
        },
        orderBy: { dueAt: "asc" },
        take: 5,
        select: { id: true, title: true, dueAt: true },
      });
      const overdueTasks: CoachSignals["overdueTasks"] = overdue.map((t) => ({
        taskId: t.id,
        title: t.title,
        daysLate: Math.max(
          1,
          Math.floor((now.getTime() - (t.dueAt?.getTime() ?? now.getTime())) / 86_400_000),
        ),
      }));

      /*
       * הצעות שת"פ שממתינות לי. ספירה ולא רשימה: הפעולה היא להיכנס
       * למסך השת"פ, והפרטים שם.
       */
      const pendingCoopOffers = await tx.coopOffer.count({
        where: { toTenantId: tenantId, status: "sent" },
      });

      return {
        hotBuyersWithoutOffer,
        propertiesWithUnsentMatches,
        hesitatingOffers,
        urgentLeads,
        incompleteProperties,
        pastViewingsWithoutOutcome,
        staleLeads,
        todayAppointments,
        overdueTasks,
        pendingCoopOffers,
      };
    });

    return buildRecommendations(signals);
  }
}
