# SPEC 4a — Tabs: התאמות and נכסים תואמים

Every property tab shares one frame: content column max-width 1180px, root padding
28px 34px 46px on #F6F7F3, sections stacked gap 20px, the SPEC 3b tab strip on top.
Every tab must render BOTH states — the empty state of a fresh listing, and the populated one.

Shared card head: 38px icon tile (radius 13) + title 22px/900 (-.025em) + optional count pill
+ actions pushed to the row end, with a 15.5px #5E6860 explanation line under the title.

## 1. התאמות — buyers from your own database

### Empty state
- Neutral 44px tile, title 19px/900 "אין עדיין קונים מתאימים".
- Body: "הוסיפו קונה למאגר — וההתאמות יחושבו אוטומטית, בלי לחפש ידנית."
- Buttons: "הוספת קונה" (green solid) + "ייבוא קונים" (outline).
- If מחיר or שטח are missing, ONE amber notice (bg #FDF3DE, border #EFD79B, text #79541A):
  the listing does not enter the matching computation until those fields are filled. Only here.

### Populated state
- Head "קונים מתאימים מהמאגר" + purple count pill + primary "שליחה ל‑N הקונים" + outline "חישוב מחדש".
- Filter chips: "ציון 90+" · "לא נשלחה הצעה" · "קונה חם".
- Row: 64px square score tile (purple domain, radius 20) with the score 24px/900 and the word
  "ציון" 11.5px/800 beneath it; buyer name 19px/900 + state pill; a "תקציב הקונה" block width
  186px with the amount 19px/900 in dir ltr; buttons "כרטיס קונה" (outline) + "לשלוח הצעה" (green soft).
- Explanation strip under each row (bg #F8FAF6, top border 1px #EDF0EA): GREEN chips for what
  matched (חדרים · אזור · סוג עסקה) and AMBER chips for what is missing or partial
  ("חסר: שטח במ״ר", "תקציב נמוך ב‑5%"). This strip is what turns a score into an action.
- Product rule: buyers whose HARD requirement (מעלית, חניה) is broken are not listed here at all.
  Do not add a "send anyway" path.
- Footer: dark strip (#0B0E0C, radius 18, white text) offering to widen the search to the office
  network, with a "פרסום לרשת" button that goes to the שיתופי פעולה tab.

## 2. נכסים תואמים — your other listings for the same kind of client

- This tab is about LISTINGS, so it lives in the BLUE domain (#E2EDF9 / #BAD2EC / #17497C).
- Empty: title 19px/900 "עדיין לא סומנו נכסים תואמים לנכס הזה", body with the inline link
  "הוסף נכס תואם", plus an "הצעה אוטומטית" outline button.
- Populated head: "נכסים תואמים" + blue count pill ("3 נכסים").
- Row: 64px blue thumbnail tile (or the real photo), listing title 19px/900 + status pill,
  a "מחיר מבוקש" block width 170px at 19px/900 dir ltr, a meta line city · rooms · type,
  and buttons "כרטיס נכס" (outline) + "הסרה" (text).
- Row hover raises the card 4px.
