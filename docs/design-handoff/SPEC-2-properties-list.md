# SPEC 2 — Properties list (עמוד נכסים)

Reference render: "מתווכים - נכסים 2026". Read DESIGN-SYSTEM-1..4 first; this file only
describes what is specific to this screen.

## 1. Shell
Same app shell as the dashboard: dark sidebar (#0B0E0C, width 252px, all 13 nav items,
counters and "בקרוב" tags exactly as on the dashboard), white top bar height 78px, and the
content area on #F6F7F3 with padding 28px 34px 46px. Content column max-width 1180px,
centred, sections stacked with gap 20px.

Top bar: page title "נכסים" 19px/900, the search field (see DS-2), then pushed to the far
side: notifications button, then the primary action "נכס חדש" (green gradient, plus icon).

## 2. Page head
One row, no card:
- Title "נכסים" 27px/900, letter-spacing -.03em.
- Sub line 15.5px #5E6860: "4 נכסים פעילים · אחד עדיין בטיוטה".
- Pushed to the end of the row, purple text 15.5px/800 #4A2691: "14 התאמות מחכות לשליחה".
No pill, no check icon, no coloured strip around this line.

## 3. Filter bar (its own card, padding 20px)
Row 1 — status segmented control. Buttons height 40px, radius 13px, gap 8px:
  active = #0B0E0C background, #fff text, 800.
  inactive = #fff background, 1px #DEE3D9, #111710 text, 700; hover #F8FAF6 + border #C6CEC1.
  Labels with counts: "הכל 4" · "פעילים 3" · "בטיוטה 1" · "בבלעדיות 0" · "לא פעילים 0".
Row 2 — filter chips (radius 999px, height 36px, 14.5px/700, border #DEE3D9, bg #fff):
  "עיר" · "סוג נכס" · "חדרים" · "טווח מחירים" · "יש בלעדיות" · "חסרים שדות".
  Each chip has a chevron-down icon 15px. An active chip switches to the BLUE domain
  (#E2EDF9 / #BAD2EC / #17497C) and shows a clear icon.
Row 3 — one side: "ניקוי הכל" as a text button #0B6E35. Other side: sort select
  "מיון: עדכון אחרון" and a view toggle (table / cards) as two 36px icon buttons.

## 4. Table card
The table is a CARD, not a bare table. Header row inside the card:
- Checkbox "בחירת הכל" (18px, radius 6, border #C6CEC1; checked = #0B0E0C, white check).
- Column labels 14px/800 #5E6860: נכס · מחיר · מוכנות · התאמות · סטטוס · פעולות.
- Header bottom border 1px #E3E7DE. No zebra striping anywhere.

Each row: height 84px, padding 0 20px, bottom border 1px #EDF0EA, hover background #F8FAF6
and the row action buttons rise 1px. Row layout, in order:
1. Checkbox, 18px, flex none.
2. Property identity, flex 1: title 17px/800 (e.g. "מימון"), and under it ONE 14px #5E6860
   meta line joined by " · ": city, rooms, property type. NOTHING ELSE — do not invent
   "נכנס לפני יומיים", "פעיל 3 שבועות" or "חסרות תמונות". A brand new listing may carry
   the "חדש" pill (green domain) next to the title.
3. Price block, width 126px, aligned to the start: price 21px/900 in dir ltr isolate, and
   under it 13px #5E6860 price per meter, or an em dash when unknown.
4. Readiness, width 150px: a 6px track (#EAEDE6, radius 999) with a fill sized to the
   percentage. Band colours: 90-100 green #3FBF63; 60-89 amber #B4801F; under 60 #B4532A.
   Under the track, 13.5px #5E6860: "82% · חסרים 2 שדות".
5. Matches, width 110px: purple pill with the count ("14 התאמות"); neutral pill when zero.
6. Status, width 132px: pill in the matching domain — "פעיל" green, "בטיוטה" NEUTRAL
   (never amber), "בבלעדיות" blue, "לא פעיל" neutral.
7. Actions, flex none, gap 8px: "מצא לי קונים" (green solid, 40px), "כרטיס נכס"
   (outline 40px), and a 40px square more-actions icon button.

Selection: once a row is checked, a bar appears at the bottom of the card (background
#F8FAF6, top border 1px #E3E7DE, height 64px, sticky inside the card) reading
"נבחרו N נכסים" with three actions: "שליחה לקונים" · "שיתוף לרשת" · "שינוי סטטוס".

## 5. Empty states
- No properties: card with a 52px neutral icon tile, title 19px/900 "עוד לא הוספת נכסים",
  body 16px #5E6860, buttons "נכס חדש" (green solid) and "קליטה בקול" (outline).
- Filters match nothing: same shape, title "אין נכסים שמתאימים לסינון", plus one text
  button "ניקוי הסינון".

## 6. Behaviour
- The whole row opens the property card; action buttons stop propagation.
- Sort persists per user; filters live in the URL query so a filtered list can be shared.
- The readiness percentage comes from the same 9 fields as the property card (SPEC 3).
  One source of truth — never two different numbers for one listing.
