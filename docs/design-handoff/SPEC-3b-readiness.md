# SPEC 3b — Tab strip and readiness card

## 3. Tab strip

- Horizontal, scrollable, gap 8px, directly under the header card, never inside a card.
- Order: סקירה · התאמות · נכסים תואמים · שיתופי פעולה · בעל הנכס · בלעדיות · הסכמים · משימות.
- Active tab: background #0B0E0C, white text, weight 800, radius 14px, height 44px.
- Inactive tab: white, border 1px #DEE3D9, text #111710 weight 700.
- Inactive hover: background #F8FAF6, border #C6CEC1, rise 2px.
- A tab with a count prints it inside its own label ("התאמות 14"), never as a red dot.

## 4. Overview tab — readiness card

The first card of the tab, and the reason the screen exists: it names what is missing before
the listing can work.

- Head: 38px neutral icon tile + title "מוכנות הנכס" 22px/900 + percentage pill in the band colour.
- Bands: 90–100 green · 60–89 amber · under 60 red-clay.
- Progress track: full width, 8px high, radius 999, base #EAEDE6, fill in the band colour.
- Under the track, 15.5px #5E6860: "2 מתוך 9 שדות מלאים".
- That count, the grid below and the percentage above MUST agree. Never three numbers for one listing.

### Field grid

- 3 columns, gap 12px.
- Cell: background #F8FAF6, border 1px #DEE3D9, radius 17px, padding 16px.
- Label 14px/700 #5E6860, value 20px/900.
- Empty field: red-clay pill "חסר" — the pill IS the button that opens the field.
- The nine fields: מחיר · שטח במ״ר · חדרים · קומה · מעלית · חניה · תמונות · תיאור · בעל הנכס.
