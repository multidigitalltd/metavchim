/**
 * מסך הקליטה של משרד חדש — "מה נשאר להפעיל".
 *
 * הבעיה שזה פותר: מתווך שנרשם היום לא יודע שיש תמלול קולי, שאפשר
 * לחבר טופס לידים מהאתר שלו, ושאפשר לייבא מאקסל במקום להקליד. הוא
 * מגלה מסך ריק, מנסה להקליד נכס אחד, ונוטש. השבוע הראשון הוא שקובע
 * אם המשרד יאמץ את המערכת — ולכן הרשימה כאן מדורגת לפי מה שמחזיר
 * ערך הכי מהר, לא לפי סדר טכני.
 *
 * פונקציה טהורה: ה-API אוסף את העובדות, זו מייצרת את הרשימה, ה-UI
 * מציג — אותה תבנית כמו coach ו-readiness.
 */

export interface OnboardingFacts {
  /** שם, מספר רישיון, כתובת וטלפון — נכנסים לנוסחי ההסכמים */
  officeProfileComplete: boolean;
  /** כמה משתמשים פעילים במשרד (כולל הבעלים) */
  activeUsers: number;
  properties: number;
  buyers: number;
  /** טופס הלידים מאתר המשרד מחובר */
  leadWebhookConfigured: boolean;
  /** מספר וואטסאפ עסקי משויך למשרד */
  whatsappConfigured: boolean;
  /**
   * הדומיין של המשרד מחובר ומאומת — כלומר המיילים יוצאים בשמו.
   *
   * ‎**„מאומת” ולא „הוזן”.** דומיין שהוזן ורשומות ה-DNS שלו טרם
   * עברו אימות אינו משנה דבר: השליחה עדיין נופלת לכתובת המערכת.
   * צעד שמסומן „בוצע” על סמך הזנה בלבד היה מכריז על הצלחה שלא
   * קרתה, ומשאיר את המשרד לשלוח מכתובת שאינה שלו בלי לדעת.
   */
  emailDomainVerified: boolean;
  /**
   * ‎**האם הפלטפורמה בכלל מסוגלת להציע את זה.**
   *
   * חיבור דומיין דורש טוקן חשבון אצל ספק הדואר, ובלעדיו נתיב
   * החיבור **דוחה** את הבקשה במפורש. צעד שאי אפשר לבצע אינו „טרם
   * בוצע” — הוא אינו קיים, וכך גם אינו מוריד את אחוז ההתקדמות של
   * משרד שלא עשה דבר רע (ביקורת Codex).
   */
  emailDomainAvailable: boolean;
  /** שירות התמלול המקומי מוכן בשרת */
  transcriptionAvailable: boolean;
}

export interface OnboardingStep {
  key: string;
  title: string;
  /** למה זה שווה את הזמן — לא מה צריך לעשות */
  why: string;
  href: string;
  done: boolean;
  /** צעד שבלעדיו המערכת לא באמת עובדת */
  essential: boolean;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
  percent: number;
  /** הצעד הבא שכדאי לעשות — הראשון שטרם הושלם */
  nextStep?: OnboardingStep;
  /** כל החיוניים הושלמו — הבאנר בדשבורד נעלם */
  ready: boolean;
}

export function onboardingSteps(facts: OnboardingFacts): OnboardingProgress {
  const steps: OnboardingStep[] = [
    {
      key: "office_profile",
      title: "פרטי המשרד",
      why: "מספר רישיון התיווך, הכתובת והטלפון נכנסים אוטומטית לכל הסכם שתשלחו לחתימה.",
      href: "/settings",
      done: facts.officeProfileComplete,
      essential: true,
    },
    {
      key: "properties",
      title: "הנכסים הראשונים",
      why: "אפשר להקליט תיאור בקול והמערכת בונה את הכרטיס — מהיר בהרבה מהקלדה.",
      href: "/properties/voice",
      done: facts.properties > 0,
      essential: true,
    },
    {
      key: "buyers",
      title: "מאגר הקונים",
      why: "בלי קונים במערכת אין התאמות. ייבוא מאקסל מעלה את כל המאגר הקיים בבת אחת.",
      href: "/import",
      done: facts.buyers > 0,
      essential: true,
    },
    {
      key: "team",
      title: "הוספת הסוכנים",
      why: "כל סוכן מקבל משתמש משלו, ורואים דוח ביצועים לכל אחד בנפרד.",
      href: "/settings",
      done: facts.activeUsers > 1,
      essential: false,
    },
    {
      key: "lead_webhook",
      title: "לידים מהאתר של המשרד",
      why: "כל פנייה מטופס יצירת הקשר נכנסת ישירות כליד — בלי העתקה ידנית ובלי פניות שנופלות בין המיילים.",
      href: "/settings",
      done: facts.leadWebhookConfigured,
      essential: false,
    },
    {
      key: "voice",
      title: "קליטה בדיבור",
      why: "מתארים נכס או קונה בקול והמערכת ממלאת את הכרטיס. התמלול רץ בשרת של המערכת, ההקלטה לא נשלחת לספק חיצוני ואינה נשמרת.",
      href: "/voice",
      done: facts.transcriptionAvailable,
      essential: false,
    },
    /*
     * ‎**לפני הוואטסאפ, ואחרי טופס הלידים.**
     *
     * זה אינו „עוד חיבור”: כל מייל שיוצא ללקוח — הצעה, הסכם לחתימה,
     * תשובה מהתיבה — נושא כתובת שולח, והיא זו שהלקוח רואה ושומר.
     * כשהיא של המערכת, המשרד בונה זיהוי של מישהו אחר; מסירה
     * שנחסמת או נופלת לספאם היא רק התוצאה הגלויה.
     */
    /*
     * ‎**הצעד נשמט לגמרי כשהספק אינו מחובר** — ולא מוצג כ„בוצע”.
     * „בוצע” על משהו שלא נעשה הוא שקר קטן שמצטבר, והשמטה היא
     * התיאור הנכון: בפריסה כזו הפיצ'ר אינו קיים.
     */
    ...(facts.emailDomainAvailable
      ? [
          {
            key: "email_domain",
            title: "שליחה מהדומיין של המשרד",
            why: "המיילים ללקוחות יוצאים מהכתובת של המשרד ולא מכתובת המערכת — הלקוח רואה את השם שהוא מכיר, והמסירה טובה יותר.",
            href: "/settings#email-domain",
            done: facts.emailDomainVerified,
            essential: false,
          },
        ]
      : []),
    {
      key: "whatsapp",
      title: "מספר וואטסאפ עסקי",
      why: "ההצעות יוצאות ללקוחות מהמספר של המשרד, והתשובות חוזרות לכרטיס שלהם.",
      href: "/settings",
      done: facts.whatsappConfigured,
      essential: false,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);

  return {
    steps,
    doneCount,
    totalCount: steps.length,
    percent: Math.round((doneCount / steps.length) * 100),
    ...(nextStep ? { nextStep } : {}),
    ready: steps.filter((step) => step.essential).every((step) => step.done),
  };
}
