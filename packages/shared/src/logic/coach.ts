/**
 * עוזר המכירות החכם (אפיון §14) — כללים דטרמיניסטיים שהופכים דאטה
 * גולמי להמלצות פעולה. פונקציה טהורה: ה-API אוסף את המדדים, זו
 * מייצרת את ההמלצות המדורגות, ה-UI מציג. שדרוג ל-LLM בעתיד = מקור
 * המלצות נוסף לצד הכללים, לא במקומם.
 */

export interface CoachSignals {
  /** קונים חמים/חמים-מאוד שלא קיבלו הצעה כלל */
  hotBuyersWithoutOffer: number;
  /** נכסים פעילים עם התאמות מוצעות שטרם נשלחו */
  propertiesWithUnsentMatches: { propertyId: string; title: string; matchCount: number }[];
  /** הצעות שנפתחו 3+ פעמים ולא הביעו עניין — הקונה מתלבט */
  hesitatingOffers: { offerId: string; propertyTitle: string; openCount: number }[];
  /** לידים "דורש טיפול אנושי" שממתינים */
  urgentLeads: { leadId: string; contactName: string }[];
  /** נכסים לא-מושלמים שחוסמים התאמות */
  incompleteProperties: { propertyId: string; title: string; missingCount: number }[];
  /** פגישות סיור שהסתיימו בלי סיכום תוצאה */
  pastViewingsWithoutOutcome: { appointmentId: string; title: string }[];
}

export interface CoachRecommendation {
  /** דירוג: ככל שגבוה יותר — דחוף יותר */
  priority: number;
  type: string;
  title: string;
  body: string;
  /** יעד לניווט */
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

export function buildRecommendations(signals: CoachSignals): CoachRecommendation[] {
  const recs: CoachRecommendation[] = [];

  for (const lead of signals.urgentLeads) {
    recs.push({
      priority: 100,
      type: "urgent_lead",
      title: `לחזור ל${lead.contactName} — דורש טיפול אנושי`,
      body: "הפנייה סומנה כרגישה. לידים חמים מתקררים מהר — כדאי לחזור עכשיו.",
      entityType: "lead",
      entityId: lead.leadId,
    });
  }

  for (const offer of signals.hesitatingOffers) {
    recs.push({
      priority: 90,
      type: "hesitating_buyer",
      title: `קונה פתח ${offer.openCount} פעמים ולא הגיב`,
      body: `${offer.propertyTitle} — הקונה מתלבט. מומלץ לשלוח הודעת המשך או להתקשר.`,
      entityType: "offer",
      entityId: offer.offerId,
    });
  }

  // הנכס עם הכי הרבה קונים ממתינים — ההזדמנות הגדולה ביותר לשליחת הצעות
  const topProperty = [...signals.propertiesWithUnsentMatches].sort(
    (a, b) => b.matchCount - a.matchCount,
  )[0];
  if (topProperty && topProperty.matchCount >= 1) {
    recs.push({
      priority: 80,
      type: "unsent_matches",
      title: `${topProperty.title} מתאים ל-${topProperty.matchCount} קונים`,
      body: "כדאי לשלוח הצעות — לחיצה אחת שולחת לכל המתאימים.",
      entityType: "property",
      entityId: topProperty.propertyId,
    });
  }

  if (signals.hotBuyersWithoutOffer > 0) {
    recs.push({
      priority: 70,
      type: "hot_buyers_idle",
      title: `${signals.hotBuyersWithoutOffer} קונים חמים לא קיבלו הצעה`,
      body: "קונים חמים בלי הצעה = הזדמנויות שמתפספסות. עברו על ההתאמות שלהם.",
      entityType: undefined,
    });
  }

  for (const viewing of signals.pastViewingsWithoutOutcome) {
    recs.push({
      priority: 60,
      type: "viewing_followup",
      title: `איך היה הסיור? — ${viewing.title}`,
      body: "עדכון תוצאת הסיור מקדם את הליד ומזין את ההתאמות הבאות.",
      entityType: "appointment",
      entityId: viewing.appointmentId,
    });
  }

  const topIncomplete = [...signals.incompleteProperties].sort(
    (a, b) => a.missingCount - b.missingCount,
  )[0];
  if (topIncomplete) {
    recs.push({
      priority: 40,
      type: "incomplete_property",
      title: `להשלים פרטים: ${topIncomplete.title}`,
      body: `חסרים ${topIncomplete.missingCount} פרטים — נכס מושלם מוצא יותר קונים.`,
      entityType: "property",
      entityId: topIncomplete.propertyId,
    });
  }

  return recs.sort((a, b) => b.priority - a.priority);
}
