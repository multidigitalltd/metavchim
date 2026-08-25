# SPEC 4c — Tabs: בלעדיות and משימות

## 5. בלעדיות — exclusivity

- Head: "בלעדיות" + status pill ("אין בלעדיות פעילה", NEUTRAL) + primary "פתיחת בלעדיות".
- Three summary tiles, equal width, soft tile style. Each: 20px icon + label 15px/800 #5E6860,
  then value 22px/900.
- In the empty state all three values are grey #5E6860 — nothing is coloured, because nothing
  has happened yet: "לא נפתחה", an em dash, and "0 מתוך 2".
  1. "תקופת הבלעדיות" — sub "תאריך התחלה וסיום ייקבעו בפתיחה".
  2. "מועד השליש" — sub "המועד שבו נדרשות 2 פעולות שיווק מתועדות".
  3. marketing-actions counter — value "0" + "מתוך 2".
- Card "מה נפתח עם בלעדיות": green icon tile #C6EED6, then four green soft rows — benefit
  15.5px/800 + reason 14px #5E6860: פרסום לרשת · דוח פעילות לבעל הנכס · דף נחיתה ממותג ·
  עדיפות בהתאמות.
- Card "היסטוריית בלעדיות": empty state with a 52px neutral tile (radius 17) and
  "עוד לא נפתחה בלעדיות על הנכס".
- "פתיחת בלעדיות" opens a form: start date, end date, commission percentage. While active, the
  head shows the end date in dir ltr and an outline "סיום בלעדיות".

## 6. משימות — tasks

- Head: "משימות (N)" + neutral state pill + the line "אין משימות פתוחות על הכרטיס הזה." when N is 0.

### New-task form (soft tile: bg #F8FAF6, border 1px #E3E7DE, radius 17, padding 20)
- Text field: flex 1, min-width 340px, height 50px, border 1px #C6CEC1, radius 15,
  placeholder "למשל: לחזור אליו מחר בבוקר"; focus ring 4px rgba(112,238,145,.22) + border #5FE083.
- Date field: width 230px, height 50px, same border, calendar icon, "dd/mm/yyyy --:--" in dir ltr.
- "הוסף": green solid, height 50px, plus icon.
- Under the row: label "מועד מהיר" + four chips — היום · מחר בבוקר · בעוד 3 ימים · בשבוע הבא.

### "משימות מוצעות לנכס הזה" (green icon tile #C6EED6)
- Rows generated from the listing REAL gaps: task 15.5px/800 + reason 14px #5E6860 + green soft
  "הוסף" chip (15.5px).
- Only ever suggest something the record actually lacks. If the price exists, never suggest
  completing the price.

### "משימות שהושלמו"
- Empty: 52px neutral tile (radius 17) + the explanation that completed tasks are archived here
  with date and time.
- Populated row: checkbox, task 15.5px/800, due-date chip (amber when overdue, else neutral) in
  dir ltr, and a more-actions icon button.
- Checking a task strikes it through, fades it to #5E6860 over 400ms, and moves it to the
  completed card.
