#!/usr/bin/env node
/**
 * ‏האייקונים של האפליקציה — **מהלוגו של המערכת**, לא מסימן משלה.
 *
 * ‏המקור הוא `apps/web/public/icon.svg` (הסימן על ריבוע כהה — מה
 * ‏שמופיע בלשונית הדפדפן ובסרגל הצד) ו-`logo-mark-dark.svg` (הסימן
 * ‏לבדו, לרקע כהה). קובץ אחד לזהות — וכאן רק רסטריזציה לגדלים שהחנויות
 * ‏דורשות; שינוי במותג נעשה ב-web, ומריצים שוב:
 *
 *   node scripts/make-icons.mjs
 *
 * ‏`sharp` הוא ה-rasterizer של Next (תלות קיימת של ה-web), ולכן אינו
 * ‏מוסיף משהו למונוריפו.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "assets");
const WEB_PUBLIC = join(here, "..", "..", "web", "public");
mkdirSync(OUT, { recursive: true });

/** ‏הריבוע הכהה מאחורי הסימן — `#111513` ב-`icon.svg` של ה-web. */
const TILE = "#111513";
/** ‏רקע הסרגל הכהה — `.mv-sidebar` ב-`globals.css`. */
const SIDEBAR = "#0b0e0c";

const squareIcon = readFileSync(join(WEB_PUBLIC, "icon.svg"));
const markDark = readFileSync(join(WEB_PUBLIC, "logo-mark-dark.svg"));

/** ‏הסימן כולו בלבן — לאייקון ההתראה, שאנדרואיד צובע בעצמו. */
const markWhite = Buffer.from(
  markDark.toString("utf8").replace(/#70EE91/gu, "#FFFFFF").replace(/#70ee91/gu, "#FFFFFF"),
);

/** ‏SVG בגודל נתון, על רקע (או שקוף), עם שוליים יחסיים. */
async function render(svg, size, { background = null, inset = 0 } = {}) {
  const inner = Math.round(size * (1 - inset * 2));
  const glyph = await sharp(svg).resize(inner, inner).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glyph, gravity: "centre" }])
    .png()
    .toBuffer();
}

// ‏אייקון האפליקציה (iOS ורשימות): הריבוע הכהה עם הסימן, כמו בלשונית
writeFileSync(join(OUT, "icon.png"), await render(squareIcon, 1024));
// ‏אנדרואיד אדפטיבי: הסימן לבדו בתוך „האזור הבטוח” (המערכת חותכת שוליים);
// ‏הרקע נקבע ב-app.json (`adaptiveIcon.backgroundColor`)
writeFileSync(join(OUT, "adaptive-icon.png"), await render(markDark, 1024, { inset: 0.22 }));
// ‏מסך הפתיחה: הסימן על רקע הסרגל הכהה — אותו רקע ב-app.json
writeFileSync(join(OUT, "splash.png"), await render(markDark, 1024, { background: SIDEBAR, inset: 0.34 }));
// ‏אייקון ההתראה: צללית לבנה בלבד — אנדרואיד צובע אותה בצבע מ-app.json
writeFileSync(join(OUT, "notification-icon.png"), await render(markWhite, 96, { inset: 0.06 }));

console.log(`נכתבו ארבעה קבצים ל-${OUT} (מקור: ${WEB_PUBLIC}/icon.svg, אריח ${TILE})`);
