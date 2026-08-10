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
  };
}

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
