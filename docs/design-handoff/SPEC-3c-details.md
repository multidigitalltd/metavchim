# SPEC 3c — Details card, side column, behaviour

## 5. Details card

- Standard card. Head: icon tile + "פרטי הנכס" 22px/900 + text button "עריכה".
- Body: two-column definition list, row height 48px, rows split by 1px #EDF0EA.
- Label 15px/700 #5E6860 at the row start; value 16px/800 at the row end.
- Numbers, dates, measurements: dir ltr + unicode-bidi isolate.
- Missing value prints an em dash in #5E6860 — never an empty cell.

## 6. Side column

The overview tab is a 2-column grid: main column flexes, side column 372px, gap 20px, align start.

### A. "מה קורה עם הנכס" (activity)
- Head: icon tile + title 19px/900.
- Up to 5 timeline rows: 30px dot column with a 1px #DEE3D9 connector.
- Event 15.5px/800; time 14px #5E6860 in dir ltr isolate.
- Empty: "עוד לא נרשמה פעילות על הנכס".

### B. "מקום הנכס" (map)
- A RESERVED slot: height 220px, radius 17px, background #EAEDE6, dashed 1px #C6CEC1.
- Centred neutral label "כאן תיטען המפה".
- Never hand-draw a map from vector shapes — mount the real map component here.
- Address line under the slot, 15px #5E6860.

### C. "מסמכים"
- Rows: file name 15.5px/800 + size 14px #5E6860 in dir ltr, with a download icon button.
- Empty: "אין מסמכים על הנכס" + button "העלאת מסמך".

## 7. Behaviour

- The percentage, the "N מתוך 9" line and the "חסר" pills derive from ONE server-side computation
  over the same nine fields.
- Clicking a "חסר" pill opens the edit drawer focused on that field.
- "מצא לי קונים" runs the matching engine and lands on the התאמות tab.
- A listing missing מחיר or שטח does not enter matching. State it once — in the matching tab
  (SPEC 4a) — not in five places.
