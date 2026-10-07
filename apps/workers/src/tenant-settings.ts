import {
  DEFAULT_PLANS,
  effectiveFeatures,
  sanitizeFeatures,
  type PlanFeature,
  resolveAutomationSettings,
  type AutomationKey,
  type AutomationSettings,
} from "@metavchim/shared";
import { prisma } from "./runtime.js";

/**
 * הגדרת האוטומציות של משרד.
 *
 * נקראת בכל סוויפ ובכל Job, ולכן היא במטמון קצר: הסוויפים עוברים על
 * כל המשרדים בלופ, וקריאה לכל משרד בכל סבב הייתה שאילתה מיותרת על
 * נתון שמשתנה פעם בשבוע. חצי דקה קצרה מכדי שמישהו ישים לב, וארוכה
 * מספיק כדי לחסוך את הלופ.
 *
 * חוסר או שגיאה נופלים לברירת המחדל דרך `resolveAutomationSettings` —
 * אוטומציה שנכבית בגלל תקלת קריאה היא בדיוק התקלה שאי אפשר לאבחן.
 */
const AUTOMATION_CACHE_TTL_MS = 30_000;
const automationCache = new Map<
  string,
  { settings: AutomationSettings; until: number }
>();

export async function automationSettings(
  tenantId: string,
): Promise<AutomationSettings> {
  const now = Date.now();
  const hit = automationCache.get(tenantId);
  if (hit && hit.until > now) return hit.settings;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const raw = (tenant?.settings ?? {}) as Record<string, unknown>;
  const settings = resolveAutomationSettings(raw["automations"]);
  automationCache.set(tenantId, {
    settings,
    until: now + AUTOMATION_CACHE_TTL_MS,
  });
  return settings;
}

/** האם האוטומציה פועלת אצל המשרד. */
export async function automationOn(
  tenantId: string,
  key: AutomationKey,
): Promise<boolean> {
  return (await automationSettings(tenantId))[key].enabled;
}

/**
 * זכאות המסלול — בתוך ה-Worker.
 *
 * השער בשרת חוסם העלאת הקלטה חדשה, אבל הסורק ממשיך לעבוד על מה
 * שכבר בתור. משרד שהפיצ'ר בוטל אצלו היה ממשיך לקבל תמלולים —
 * ולצרוך STT ו-diarization — עד שהתור מתרוקן (ביקורת Codex).
 *
 * הקטלוג נקרא ישירות מהטבלה (היא ברמת הפלטפורמה, בלי RLS) ונופל
 * לברירות המחדל שבקוד, בדיוק כמו PlanCatalogService בשרת. מטמון קצר
 * כדי לא לשאול בכל סריקה.
 */
const PLAN_CACHE_TTL_MS = 30_000;
let planCache: { features: Map<string, PlanFeature[]>; until: number } | null =
  null;

async function planFeatures(): Promise<Map<string, PlanFeature[]>> {
  const now = Date.now();
  if (planCache && planCache.until > now) return planCache.features;
  const rows = await prisma.plan.findMany({
    select: { code: true, features: true },
  });
  const features = new Map<string, PlanFeature[]>();
  for (const plan of DEFAULT_PLANS) features.set(plan.code, [...plan.features]);
  for (const row of rows)
    features.set(row.code, sanitizeFeatures(row.features));
  planCache = { features, until: now + PLAN_CACHE_TTL_MS };
  return features;
}

/**
 * מסלול שאינו נפתר אינו מזכה בכלום — אותו כיוון בטוח כמו בשרת.
 *
 * חריגי הפלטפורמה נקראים **גם כאן** ולא רק ב-API. תמלול שנפתח
 * למשרד מעבר למסלול היה נראה פתוח במסך ולא רץ בפועל, ותכונה
 * שנסגרה הייתה ממשיכה לרוץ ברקע — שתי תקלות שאיש אינו מדווח עליהן
 * כי שום מסך אינו סותר אותן.
 */
export async function tenantFeatures(tenantId: string): Promise<PlanFeature[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, featureGrants: true, featureDenials: true },
  });
  if (!tenant) return [];
  const planCodes = (await planFeatures()).get(tenant.plan);
  if (!planCodes) return [];
  return effectiveFeatures(planCodes, {
    grants: tenant.featureGrants,
    denials: tenant.featureDenials,
  });
}

export async function tenantHasFeature(
  tenantId: string,
  feature: PlanFeature,
): Promise<boolean> {
  return (await tenantFeatures(tenantId)).includes(feature);
}
