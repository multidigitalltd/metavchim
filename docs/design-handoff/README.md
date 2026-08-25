# IMPLEMENTATION SPEC — Dashboard (מתווכים.)

Build this screen exactly. Read the design system first — it defines every token, component and
rule referenced here; this file only says what goes where, in what order, with what copy.

> **הערה של המאגר.** המקור כתב „read `DESIGN-SYSTEM.md`”, וקובץ בשם הזה אינו קיים: מערכת
> העיצוב נמסרה מפוצלת לארבעה קבצים, ואת ארבעתם צריך לקרוא —
> `DESIGN-SYSTEM-1-foundations.md`, `DESIGN-SYSTEM-2-icons-and-controls.md`,
> `DESIGN-SYSTEM-3-patterns.md`, `DESIGN-SYSTEM-4-layout-and-rules.md`. סדר הקריאה המלא
> ב-`INDEX.md`.

A screenshot of the approved design accompanies this spec. Where the screenshot and this text
disagree, **this text wins** (it carries the exact values).

> **הערה של המאגר.** צילומי המסך לא נכללו בחבילה שהתקבלה — אין בה אף קובץ תמונה. הטקסט
> הזה הוא המקור היחיד, וזה גם ממילא מה שהוא מגדיר לעצמו („this text wins”).

> **הערה של המאגר — טבלת תרגום למספרי הסעיפים.**
>
> ההפניות במסמך הזה נכתבו מול מערכת עיצוב אחת, שבה הרכיבים היו תת-סעיפים של „2”. בפיצול
> לארבעה קבצים הם קיבלו מספור רץ, ולכן **אף אחת מההפניות `§2.x` אינה נפתרת כפי שהיא**.
> זו טבלת התרגום המלאה:
>
> | ההפניה במסמך | הסעיף בפועל | הקובץ |
> |---|---|---|
> | `§2.3` חיפוש ושדות | `§11 INPUT AND SEARCH` | `DESIGN-SYSTEM-2-icons-and-controls.md` |
> | `§2.4` אריח KPI | `§12 KPI TILE` | `DESIGN-SYSTEM-3-patterns.md` |
> | `§2.5` שורת רשימה | `§13 LIST ROW` | `DESIGN-SYSTEM-3-patterns.md` |
> | `§2.6` שורת מדד | `§14 METRIC ROW` | `DESIGN-SYSTEM-3-patterns.md` |
> | `§2.7` סרגל צד | `§15 SIDEBAR` | `DESIGN-SYSTEM-3-patterns.md` |
> | `§2.8` כותרת האפליקציה | `§16 APP HEADER` | `DESIGN-SYSTEM-3-patterns.md` |
> | `§2.9` פאנל הסוכן | `§17 VOICE-AGENT PANEL` | `DESIGN-SYSTEM-3-patterns.md` |
> | `§2.10` כרטיס המנטור הכהה | `§21 DARK ACCENT CARD` | `DESIGN-SYSTEM-4-layout-and-rules.md` |
> | `§2.11` מצבי ריק ואפס | `§22 EMPTY AND ZERO STATES` | `DESIGN-SYSTEM-4-layout-and-rules.md` |
> | `§3 “Counter card”` | הבלוק `COUNTER CARD` בתוך `§24 LAYOUT PATTERNS` | `DESIGN-SYSTEM-4-layout-and-rules.md` |
>
> ‎`§1` ו-`§5` שבסוף המסמך מפנים לסעיפים של **המסמך הזה עצמו** (סרגל הצד ושורת ה-KPI),
> ולא למערכת העיצוב.
>
> **וגם: סעיפים 18, 19 ו-20 אינם קיימים באף אחד מארבעת הקבצים.** הקובץ השלישי נעצר ב-17
> והרביעי פותח ב-21. שלושה סעיפים אבדו בפיצול, ואיננו יודעים מה היה בהם — לשאול, לא
> להשלים מהראש.

Hebrew, RTL: `<html dir="rtl" lang="he">`. All Hebrew strings below are final — copy them
character for character, including `״` in `שת״פים` and the `‑` in `ל‑7 קונים`.

---

## 0. Shell

```
<div dir="rtl" style="display:flex; min-height:100vh; min-width:1320px; background:#F6F7F3">
  <aside>  … 250px fixed …            </aside>
  <div style="flex:1; min-width:0; display:flex; flex-direction:column">
    <header> … 78px … </header>
    <main style="flex:1; overflow-y:auto; padding:28px 34px 46px; animation:rise .4s cubic-bezier(.22,1,.36,1) both">
      <div style="max-width:1180px; margin:0 auto; display:flex; flex-direction:column; gap:20px">
        … sections 3–7 …
      </div>
    </main>
  </div>
</div>
```

`main` scrolls; the sidebar and header do not.

---

## 1. Sidebar (§2.7 of the design system)

Order top to bottom:

1. **Logo lockup** — 29px mark, wordmark `מתווכים` + green `.`
2. **Office card** — 40px monogram tile with the office initial (`ד`), `דירומקס`, `ריקי · מנהלת משרד`.
   If the tenant has an uploaded logo, render the image in that tile instead of the monogram;
   fall back to the monogram, never to an empty box.
3. **Nav** — eyebrow `היום`, then, in this exact order:

| Label | Count | Notes |
|---|---|---|
| `דשבורד` | — | active state + 3px green edge bar |
| `נכסים` | 4 | |
| `קונים · שוכרים` | 13 | |
| `לידים` | — | |
| `שיחות` | — | |
| `התאמות` | 14 | |
| `הצעות` | — | |
| `יומן` | — | |
| `משימות` | 4 | |
| `שת״פים` | 5 | |
| `קונים - kanko` | — | badge `בקרוב` |
| `המנטור האישי שלך` | — | |
| `ניהול משרד` | — | |

Counts come from live data; render nothing (not `0`) when a count is absent.
The `בקרוב` badge element must not exist on rows that don't have it.

4. **`margin-top:auto`** → ghost CTA `יש לי רעיון` with the star icon, 50px.

---

## 2. Header (§2.8)

- Title `דשבורד`.
- Search field (§2.3), placeholder `חיפוש נכס, קונה, ליד או התאמה`, trailing `⌘K` chip
  (`dir="ltr" unicode-bidi:isolate` — required).
- Then `margin-inline-start:auto`:
  - Primary button `הסוכן הקולי` with the mic icon, 46px.
  - Bell icon button with the unread dot.
  - Profile icon button.

---

## 3. Greeting row

```
[ h1  ערב טוב, ריקי  + green "." ]        [ counter card ]
   date line: יום שני, 24 באוגוסט · י״א אלול תשפ״ו · 23:02
```

- Greeting switches by hour: `בוקר טוב` / `צהריים טובים` / `אחר הצהריים טובים` / `ערב טוב` / `לילה טוב`, then the first name.
- Date line: weekday + Gregorian date · Hebrew date · current time, separated by ` · `.
- Counter card (§3 “Counter card”): number `5`, `פעולות מחכות לך`, `מסודרות לפי דחיפות`.
  The number equals the length of the action list in §5.

---

## 4. Voice-agent panel (§2.9)

- Title `מה עכשיו?`
- Sub-line `דברו או כתבו — הסוכן יקלוט, יחפש ויעדכן בשבילכם.`
- Text link `למסך הסוכן` + chevron.
- Input placeholder, verbatim including the quotes:
  `למשל: "תוסיף קונה משה כהן, 4 חדרים בבני ברק עד 2.3 מיליון"`
- `מהיר` secondary button (mic icon) → starts dictation. `קדימה` primary → submits.
- Four suggestion chips, in this order:
  1. `"חפש את שרה לוי"`
  2. `"מי מחפש 4 חדרים בגבעתיים?"`
  3. `"מה יש לי ברמת גן עד שני מיליון"`
  4. `"תראה לי התאמות לדירה ברמת גן"`

Chips are clickable: they fill the input and submit.

---

## 5. KPI row — four tiles (§2.4)

RTL order (rightmost first):

| # | Label | Value | Note | Domain |
|---|---|---|---|---|
| 1 | `הצעות ממתינות למענה` | 0 | `אין הצעות פתוחות` | Neutral |
| 2 | `נכסים פעילים` | 4 | `כולם מוכנים לשיווק` | Blue |
| 3 | `קונים חמים` | 4 | `מתוך 13 קונים במאגר` | Peach |
| 4 | `לידים חדשים` | 0 | `הכל טופל` | Neutral |

Icons: offers = calendar-ish document (`M4.4 5.2h15.2v13.6H4.4zM4.4 9h15.2`), properties = property,
hot buyers = flame, leads = bolt. Each tile links to its list page.
Any tile whose value is 0 switches to Neutral tokens automatically — that is a data-driven rule,
not hard-coded.

---

## 6. Main grid

`display:grid; grid-template-columns:1fr 372px; gap:16px; align-items:stretch`

### 6.1 Action list card — “מה חשוב לעשות היום” (§2.5)

Card with `overflow:hidden`. Header (70px, bottom border): green check tile, title
`מה חשוב לעשות היום`, sub-line `מתעדכן לבד לפי המצב בשטח`, and at the end the pill `5 פעולות`
(`14/800 #0B6E35`, `background:#D2F2DF`, radius 999, `padding:7px 14px`).

Five flush rows, `min-height:96px`, `padding:18px 24px`, in this order. Row 1 is the primary row:
`background:#F7FCF9` + primary button. Rows 2–5: white + secondary button.

| # | Title | Why-line | Button | Domain / icon |
|---|---|---|---|---|
| 1 | `5 הצעות שיתוף פעולה ממתינות לתגובה` | `משרד אחר הציע נכס על אחד הביקושים שלכם ומחכה לתשובה.` | `לעבור על ההצעות` | Green / collaboration |
| 2 | `רבי עקיבא פינת סמטת מנשה, בני ברק מתאים ל‑7 קונים` | `כדאי לשלוח הצעות — לחיצה אחת שולחת לכל המתאימים.` | `לפרטים` | Violet / match |
| 3 | `4 קונים חמים לא קיבלו הצעה` | `קונים חמים בלי הצעה = הזדמנויות שמתפספסות. עברו על ההתאמות שלהם.` | `לעבור על ההתאמות` | Peach / flame |
| 4 | `לבדוק התאמות עבור גינטר` | `קונה חם מאוד — כדאי לוודא שקיבל הצעות רלוונטיות.` | `צפה בהתאמות` | Violet / eye |
| 5 | `לבדוק התאמות עבור יחיאל אורטנר` | `קונה חם — כדאי לוודא שקיבל הצעות רלוונטיות.` | `צפה בהתאמות` | Violet / eye |

Each row starts with its ordinal (`1`–`5`), `15px/900`, color `#4A544C`, width 26px, centred.

Ordering logic (server-side): urgency score = time waiting × domain weight, where a partner
office awaiting a reply outranks internal follow-ups. Rank 1 is always the row that costs the
most money to ignore. Rows are re-ranked on load; the tint and primary button always follow
rank 1, not a fixed row.

### 6.2 Two analysis cards (sub-grid `1fr 1fr`, `flex:1`, stretch)

**`בשלות הקונים`** — violet people icon, sub-line `לחיצה על שורה פותחת את הרשימה המסוננת.`
Four metric rows (§2.6), each clickable to the filtered buyer list:

| Row | Value | Dot | Tokens |
|---|---|---|---|
| `חם מאוד` | 2 | `#B4471F` | Peach |
| `חם` | 2 | `#D89A22` | `bg #FBEFD3` · `border #EBD59A` · `fg #79541A` |
| `מתעניין` | 9 | `#2FA954` | Green |
| `לא בשל` | 0 | `#8B958C` | Neutral, number `#4A544C` |

Footer at `margin-top:auto`: `סה״כ 13 קונים במאגר` (the number in `--ink`, bold).

**`מצב הלידים`** — peach bolt icon, sub-line `המשפך מהפנייה ועד ההמרה.`
Three neutral rows: `חדש` 0 · `בטיפול` 0 · `ממתין ללקוח` 0, numbers `#4A544C`.
Footer (§2.11): check icon + `אין לידים שממתינים — הכל טופל`.

**Do not render donuts or empty progress bars here.** This replaced exactly that, on purpose.

### 6.3 Side column (372px)

Four cards, in order, `gap:16px`; the last one gets `flex:1` so the column ends level with the
main column.

1. **`היום ביומן`** — blue calendar icon, text link `ליומן המלא`. Rows (66px, §2.5 nested):
   - `14:00` · `נתן שוורץ` · `פגישה`
   - `22:00` · `פגישה` · `בלי מיקום — כדאי להשלים`
   Times: `dir="ltr" unicode-bidi:isolate`, `18px/900`, blue `fg`.
   The second sub-line is generated: when an event has no location, show that prompt; otherwise show the location.
2. **`המשימות שלי`** — green tasks icon, text link `לכל המשימות`. Rows: date chip
   (`13.5/900 #0B6E35`, `background:#D2F2DF`, radius 999, `padding:5px 11px`) + task text `15.5/700`:
   - `25.08` · `פגישה עם שמואל`
   - `25.08` · `תזכורת לפגישה עם דוד כהן`
   - `25.08` · `פגישה להדגמת המערכת עם אלי ברנד`
   - `ללא יעד` · `להוסיף כפתור צף לפידבק מהמתווכים — מי שמעדכן מה חסר מרוויח קרדיטים`
3. **`שת״פים`** — green link icon, text link `לרשת`. Card border uses the green line
   (`#A5D9B9`). Rows are green-tinted, number-first (`22px/900 #0B6E35`, min-width 26):
   - `5` · `הצעות שהתקבלו על הביקושים שלכם`
   - `2` · `הזדמנויות להיות מחוברים לרשת`
4. **Dark mentor card** (§2.10) — `AI` badge, title `המנטור האישי שלך`,
   body `שואל אותי כל שאלה על המערכת, על שת״פים או על איך לסגור עסקה מהר יותר.`,
   full-width ghost button `לדבר עם המנטור`.

---

## 7. Behaviour

- **Every number on this screen is live data.** Nothing is hard-coded except labels and copy.
- The action list is generated server-side, max 5 rows on the dashboard; the rest live on a
  dedicated page. If there are more, add a dashed full-width button under the rows:
  `border:1px dashed #CFDCD0; radius:20px; padding:18px; font:800 16px; color:#5E6860`,
  hover `background:#F2F5F0; border-color:#BEE7CC`.
- Completing an action removes its row with a 200ms fade and re-ranks the list; the counter card
  and the header pill update together.
- Zero-state substitutions are automatic (KPI tiles, funnel rows, empty lists) per §2.11.
- All cards and rows are keyboard reachable in DOM order; DOM order equals visual order.
- Never show a spinner inside a card: render the card chrome with skeleton rows
  (`background:#F8FAF6; radius:16px; height` matching the real row) and fill in.

---

## 8. Definition of done

1. Fonts load locally, all four weights; no text renders in a fallback font.
2. Body background is `#F6F7F3` — not green-tinted.
3All cards share one radius (22px), one border (`#E3E7DE`), one resting shadow.
4. The four KPI tiles are identical in height (150px) and share the card shadow.
5. Exactly one primary button per region: header, agent panel, action list (row 1 only).
6. No text lighter than `#5E6860`; no data value lighter than `#4A544C`.
7. `⌘K` and every clock time render left-to-right.
8. Both bottom grid columns end at the same Y.
9. No donut chart, no empty progress bar, no emoji anywhere.
10. `prefers-reduced-motion` disables `rise` and `halo`.
11. Nav matches §1 exactly — 13 items, one badge, no empty badge elements.
12. Zoomed to 200% and at 1320px width nothing clips or overlaps.
