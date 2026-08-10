/**
 * ערכת האייקונים של השפה העיצובית — קווי מתאר (stroke) ב-currentColor,
 * מקובץ העיצוב. בתים, מפתחות, אנשים ועסקאות — בלי אימוג'ים.
 *
 * מקור אמת אחד: כל מסך שצריך אייקון מייבא מכאן, כדי שהמראה לא
 * יתפצל בין אימוג'י במסך אחד ל-SVG במסך אחר.
 */

interface IconProps {
  /** גודל בפיקסלים (רוחב=גובה). ברירת מחדל 18. */
  s?: number;
}

function svgProps(s?: number) {
  return {
    viewBox: "0 0 24 24",
    width: s ?? 18,
    height: s ?? 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    // בתוך שורת טקסט האייקון מתיישר לעין בלי עטיפת flex סביבו
    style: { verticalAlign: "-0.18em" as const },
  };
}

/**
 * סימן המותג — שני סוגריים וריבוע במרכז.
 *
 * מוטמע כרכיב ולא כ-`<img src="/logo-mark-dark.svg">` כדי שהצלע
 * הלבנה תהיה `currentColor`: אותו סימן בדיוק עובד על סרגל הצד הכהה
 * (לבן), על מסך ההתחברות הבהיר (כהה) ובערכת הנושא הכהה — בלי שני
 * קבצים שצריך לזכור להחליף ביניהם. הירוק נשאר ‎--color-action‎, שהוא
 * בדיוק הגוון של קובץ המקור.
 */
export const LogoMark = ({ s = 30 }: IconProps) => (
  <svg
    viewBox="0 0 48 48"
    width={s}
    height={s}
    fill="none"
    aria-hidden="true"
    className="flex-none"
  >
    <path
      d="M28.5 6.5h7a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6h-7"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
    />
    <path
      d="M19.5 6.5h-7a6 6 0 0 0-6 6v23a6 6 0 0 0 6 6h7"
      stroke="var(--color-action)"
      strokeWidth="5"
      strokeLinecap="round"
    />
    <rect x="19.4" y="19.4" width="9.2" height="9.2" rx="2.4" fill="var(--color-action)" />
  </svg>
);

export const IconHome = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.8V20h13V9.8" />
    <path d="M10 20v-5h4v5" />
  </svg>
);

export const IconKey = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12 20 3" />
    <path d="M17.5 5.5 20 8" />
    <path d="M15 8l2 2" />
  </svg>
);

export const IconUser = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" />
  </svg>
);

export const IconUsers = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.7-3.1 3.1-4.7 6-4.7s5.3 1.6 6 4.7" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6.2" />
    <path d="M18 14.6c2 .6 3.3 2.1 3.8 4.4" />
  </svg>
);

export const IconMic = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="9" y="2.6" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3.2" />
  </svg>
);

export const IconPhone = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M6.2 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.4 6.4l1.4-2 4 1.5v3c0 1-.8 1.8-1.8 1.7C10.6 19 5 13.4 4.5 5.3c0-1 .7-1.8 1.7-1.8Z" />
  </svg>
);

export const IconList = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M9 7h11M9 12h11M9 17h11M4.6 7h.01M4.6 12h.01M4.6 17h.01" />
  </svg>
);

export const IconMail = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="3" y="5" width="18" height="14" rx="2.4" />
    <path d="m3.8 6.5 8.2 6 8.2-6" />
  </svg>
);

export const IconLock = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.4" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </svg>
);

export const IconHandshake = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M3 9.5 7 6l3.4 2.6L13 7l4 3.4" />
    <path d="m9.5 14 2 2 2-2 2 2 2-2" />
    <path d="M21 9.5 17 6" />
    <path d="M3 9.5v4.2l4.5 4.3 2-2" />
  </svg>
);

export const IconCheck = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const IconX = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const IconUpload = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 15V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
  </svg>
);

export const IconSheet = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="4" y="3.5" width="16" height="17" rx="2" />
    <path d="M4 9h16M9.5 9v11.5" />
  </svg>
);

export const IconShield = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8 7 9.3 4.1-1.3 7-5 7-9.3V5.8Z" />
    <path d="m9 11.6 2.1 2.1 3.9-4.2" />
  </svg>
);

export const IconCalendar = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
    <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
  </svg>
);

export const IconSearch = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

export const IconBell = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const IconClock = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconEdit = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M14.5 5.5 18.5 9.5 8 20H4v-4L14.5 5.5Z" />
    <path d="m13 7 4 4" />
  </svg>
);

export const IconSend = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M21 3 10.5 13.5" />
    <path d="M21 3l-6.5 18-4-7.5L3 9.5Z" />
  </svg>
);

export const IconChat = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M4 5.5h16v11H9l-5 4v-15Z" />
  </svg>
);

export const IconCoins = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <ellipse cx="12" cy="6.5" rx="7" ry="3" />
    <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </svg>
);

export const IconCart = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17.5" cy="20" r="1.4" />
    <path d="M3 4h2.5l2.3 11.5h11L21 8H6.2" />
  </svg>
);

export const IconMenu = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </svg>
);

export const IconWarning = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 3.5 21.5 20h-19Z" />
    <path d="M12 9.5v4.5" />
    <path d="M12 17.2h.01" />
  </svg>
);

export const IconCard = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
    <path d="M3 10h18M6.5 14.5h4" />
  </svg>
);

export const IconStop = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" />
  </svg>
);

export const IconDoc = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M6 3.5h8l4 4v13H6Z" />
    <path d="M14 3.5v4h4" />
    <path d="M9 12h6M9 15.5h6" />
  </svg>
);

export const IconRefresh = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 3.5v3.8h-3.8" />
  </svg>
);

export const IconGear = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
  </svg>
);

export const IconThumbUp = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M7 11 11.5 3c1.2 0 2 .9 2 2.1V9h5c1.2 0 2 1 1.8 2.1l-1.1 6.5A2 2 0 0 1 17.2 19H7" />
    <rect x="3" y="10.5" width="4" height="9.5" rx="1" />
  </svg>
);

export const IconSun = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </svg>
);

export const IconMoon = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z" />
  </svg>
);

export const IconMonitor = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
    <path d="M9 20.5h6M12 17v3.5" />
  </svg>
);

export const IconMicOff = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <rect x="9" y="2.6" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3.2" />
    <path d="m4 4 16 16" />
  </svg>
);

export const IconHeadphones = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M4 14v-2.5a8 8 0 0 1 16 0V14" />
    <rect x="3.5" y="13.5" width="4.5" height="6.5" rx="1.6" />
    <rect x="16" y="13.5" width="4.5" height="6.5" rx="1.6" />
  </svg>
);

export const IconPlus = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconPrinter = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M7 8V3.5h10V8" />
    <rect x="4" y="8" width="16" height="8" rx="1.8" />
    <path d="M7 13h10v7.5H7Z" />
  </svg>
);

export const IconFlame = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 3s5.5 4.5 5.5 10a5.5 5.5 0 0 1-11 0C6.5 8.5 9 7 9.5 4.5c1 .8 1.6 1.7 2 3C12 6 12 4.5 12 3Z" />
  </svg>
);

export const IconSnow = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
  </svg>
);

export const IconCloudSun = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M16.5 6.5a3.5 3.5 0 0 0-3-2M18 3v1.2M21 6h-1.2" />
    <path d="M6.5 19.5h9a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.4 1.6A3.3 3.3 0 0 0 6.5 19.5Z" />
  </svg>
);

export const IconPin = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 21s-6.5-5.7-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21Z" />
    <circle cx="12" cy="10.5" r="2.2" />
  </svg>
);

export const IconEye = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconLink = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M10 14a4 4 0 0 0 6 .4l2.5-2.5a4 4 0 1 0-5.7-5.7l-1.2 1.2" />
    <path d="M14 10a4 4 0 0 0-6-.4l-2.5 2.5a4 4 0 1 0 5.7 5.7l1.2-1.2" />
  </svg>
);

export const IconDiamond = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M7 4h10l4 5.5L12 20.5 3 9.5Z" />
    <path d="M3 9.5h18M12 20.5 8.5 9.5 12 4l3.5 5.5Z" />
  </svg>
);

export const IconCamera = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M4 7.5h3.5L9 5.5h6l1.5 2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
);

export const IconStar = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8Z" />
  </svg>
);

export const IconInfo = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 7.8h.01" />
  </svg>
);

export const IconFilter = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M3.5 5h17l-6.5 7.6v5.4l-4 2v-7.4Z" />
  </svg>
);

export const IconDownload = ({ s }: IconProps) => (
  <svg {...svgProps(s)}>
    <path d="M12 4v11" />
    <path d="m7.5 11 4.5 4.5L16.5 11" />
    <path d="M4.5 16v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
  </svg>
);
