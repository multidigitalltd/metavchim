#!/usr/bin/env node
/**
 * ‏תמונת הנושא לחנות (Feature graphic, 1024×500) — מהלוגו ומהגופן של
 * ‏המערכת, לא מעיצוב נפרד: הסימן מ-`apps/web/public/logo-mark-dark.svg`,
 * ‏השם ב-Almoni, על רקע הסרגל הכהה. שינוי במותג נעשה ב-web, ומריצים שוב:
 *
 *   node scripts/make-feature-graphic.mjs   →  store/feature-graphic.png
 *
 * ‏הגופן נטען דרך fontconfig מ-`assets/fonts` (קובץ תצורה זמני), כדי
 * ‏שהתוצאה תהיה זהה בכל מכונה — גם כזו שאין בה Almoni מותקן.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FONTS = join(here, "..", "assets", "fonts");
const OUT = join(here, "..", "store");
const WEB_PUBLIC = join(here, "..", "..", "web", "public");

const fontsConf = join(tmpdir(), "metavchim-fonts.conf");
writeFileSync(
  fontsConf,
  `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${FONTS}</dir><cachedir>${join(tmpdir(), "metavchim-fc-cache")}</cachedir></fontconfig>`,
);
process.env.FONTCONFIG_FILE = fontsConf;
// ‏אחרי קביעת התצורה — sharp (librsvg/pango) קורא אותה בטעינה
const { default: sharp } = await import("sharp");

const W = 1024;
const H = 500;
/** ‏רקע הסרגל הכהה — `.mv-sidebar` ב-`globals.css`; אותו רקע של מסך הפתיחה. */
const BG = "#0b0e0c";
const TEXT = "#e8f0ea";
const MUTED = "#c3cfc6";
const ACCENT = "#70EE91";

const mark = readFileSync(join(WEB_PUBLIC, "logo-mark-dark.svg"));
const MARK = 300;
const markPng = await sharp(mark).resize(MARK, MARK).png().toBuffer();

/*
 * ‏הטקסט מימין (RTL), הסימן משמאל — כמו כותרת המערכת. `direction="rtl"`
 * ‏עם `text-anchor="start"` (ב-RTL „התחלה” היא הקצה הימני) מיישרים את השורות לימין.
 */
const text = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>
    .name { font-family: "Almoni"; font-weight: 800; font-size: 118px; fill: ${TEXT}; }
    .tag  { font-family: "Almoni"; font-weight: 500; font-size: 40px; fill: ${MUTED}; }
  </style>
  <text x="${W - 88}" y="238" class="name" direction="rtl" text-anchor="start">מתווכים</text>
  <rect x="${W - 88 - 120}" y="262" width="120" height="6" rx="3" fill="${ACCENT}"/>
  <text x="${W - 88}" y="334" class="tag" direction="rtl" text-anchor="start">המתווך סוגר עסקאות.</text>
  <text x="${W - 88}" y="386" class="tag" direction="rtl" text-anchor="start">המערכת מטפלת בכל השאר.</text>
</svg>`);

mkdirSync(OUT, { recursive: true });
const png = await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
  .composite([
    { input: markPng, left: 96, top: Math.round((H - MARK) / 2) },
    { input: text, left: 0, top: 0 },
  ])
  .png()
  .toBuffer();
writeFileSync(join(OUT, "feature-graphic.png"), png);
console.log(`נכתב ${join(OUT, "feature-graphic.png")} (${W}×${H})`);
