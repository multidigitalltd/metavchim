# DESIGN SYSTEM - Metavchim SaaS

Hebrew, RTL-first design language for the whole product. Users are working real-estate agents,
often mid-drive, mid-showing, distracted. Everything optimises for LOW COGNITIVE LOAD: one obvious
next action, large legible type, color only where it carries meaning.

## 1. TYPOGRAPHY

Almoni (Hebrew), 4 weights from fonts/, font-display swap. No Google Fonts.

    weight 400      fonts/almoni-regular-aaa.woff
    weight 500 600  fonts/almoni-medium-aaa.woff
    weight 700      fonts/almoni-bold-aaa.woff
    weight 800 900  fonts/almoni-ultrabold-aaa.woff
    body: font-family Almoni, system-ui, sans-serif; -webkit-font-smoothing antialiased

Scale in px:

    page greeting h1       38 / 900 / -.035em / lh 1.06 / ink
    KPI number             46 / 900 / -.04em / lh 1 / domain fg
    inline metric number   20 / 900 / -.02em / #4A544C or domain fg
    card title             18.5 / 900 / -.02em / ink
    panel headline         22 / 900 / -.025em / ink
    row title              17.5 / 800 / -.015em / lh 1.4 / ink
    body, row subtitle     15 to 15.5 / 400-600 / lh 1.45 / ink-2
    caption, meta          13.5 to 14.5 / 400-700 / ink-2
    nav item               15.5 / 600, active 800
    eyebrow, group label   11.5 / 800 / .09em / #6F7A72
    button label           15.5 to 17 / 800-900

HARD FLOORS: never below 13.5px anywhere; never below 15px for anything read to make a decision;
data numbers never lighter than #4A544C.

## 2. COLOR TOKENS

    canvas          #F6F7F3   app background, warm neutral, NOT green-tinted
    surface         #FFFFFF   cards
    surface-sunken  #F8FAF6   inner rows, inputs, list cells
    line            #E3E7DE   card border
    line-2          #E7EAE3   inner row border
    line-strong     #C6CEC1   input border
    ink             #111710   primary text
    ink-2           #5E6860   secondary text, AA-safe on white and on sunken
    ink-3           #4A544C   muted DATA: zeros, ordinals. Never lighter.
    brand           #3FBF63
    brand-ink       #0B6E35   green text on light
    brand-ink-deep  #08240F   text on green fills
    brand-tint      #D2F2DF
    brand-tint-2    #DFF6E7
    brand-line      #A5D9B9
    brand-grad      linear-gradient(180deg, #7DF39C 0%, #5FE083 100%)
    dark            #0B0E0C   sidebar
    dark-2          #141A15   accent card
    dark-text       #E9EEEA
    dark-text-2     #B6C0B8
    dark-text-3     #8C978E
    dark-line       rgba(255,255,255,.09)
    on-dark-brand   #70EE91

DOMAIN COLORS, the only place color varies. Color says WHAT KIND OF THING this is, never decoration.
Each domain is bg / border / icon-tile / fg:

    GREEN    collaborations, voice agent, confirmations   #DFF6E7 / #A5D9B9 / #C6EED6 / #075E2C
    PEACH    urgency: hot buyers, leads, time-critical    #FBE3D5 / #EDBC9D / #F7D2B9 / #8F3D1C
    VIOLET   matching engine: matches, offers             #E9E1FB / #C9BAF0 / #DCD1F7 / #4A2691
    BLUE     properties, calendar                         #E2EDF9 / #BAD2EC / #D0E2F4 / #17497C
    NEUTRAL  anything at zero, nothing waiting            #F8FAF6 / #DEE3D9 / #EAEDE6 / #5E6860

Rules:
1. A metric at 0 switches to NEUTRAL with a reassuring note. Zero must never look like failure.
2. Never two domain colors in one component. One card equals one domain.
3. Red is not in the palette. Peach is as loud as the product gets.
4. Gradients only on the primary green button and on brand icon tiles. Never on backgrounds.

> **הערה של המאגר — כלל 3 מול שאר החבילה.**
>
> כפי שכלל 3 מנוסח כאן הוא סותר שלושה מסמכים אחרים באותה חבילה:
>
> - ‎`INDEX.md` מונה ברשימת הבלתי-ניתנים-למשא-ומתן „red-clay = blocking problem”.
> - ‎`SPEC-3b-readiness.md` דורש אדום-חמרה לציון מוכנות מתחת ל-60 ולשדות חסרים.
> - ‎`DESIGN-SYSTEM-2-icons-and-controls.md` ‏§10 קובע בעצמו נקודת „לא נקרא” בגוון
>   ‎`#C05E36` — כלומר החבילה **משתמשת** באדום-חמרה במפרט רכיב משלה.
>
> ‎`DESIGN-SYSTEM-4` ‏§22 מוסיף „never a red-flavoured warning” למצבי ריק.
>
> **הקריאה שאנחנו מיישמים לפיה:** כלל 3 חל על **פלטת הדומיינים** — הרשימה בת החמישה
> שמעליו. אדום אינו דומיין שישי, כלומר לעולם אינו אומר „זה סוג כזה של דבר”, ולעולם אינו
> צובע כרטיס, אריח או שורה שלמים. הוא כן נשאר **סימן** צר: פעולה הרסנית, שגיאה, וחסימה
> אמיתית — בנקודה, בטקסט או בתג, לא במילוי.
>
> קריאה זו מיישבת את ארבעת המסמכים. הקריאה החלופית — „אדום לעולם לא מופיע” — סותרת את
> ‎§10 של החבילה עצמה, ולכן אינה יכולה להיות הכוונה. השורה של §22 עקבית איתה: מצב ריק אינו
> חסימה, ולכן אין בו אדום.
>
> ‎**זו הכרעה שלנו ולא של המסמכים, והיא פתוחה לבעל המערכת.** היא נרשמת כאן ולא מוסתרת,
> כי מימוש חייב לבחור אחת מהשתיים.

## 3. SHAPE AND ELEVATION

    card, panel                      radius 22
    large feature panel, agent bar   radius 24
    inner row, input, button         radius 15 to 17
    icon tile                        radius 13 at 38px, 15 at 44px, 17 at 52px
    avatar, monogram                 radius 12
    pill, chip                       radius 999

ONE resting elevation for every card, nothing else at rest:

    box-shadow 0 1px 2px rgba(16,24,18,.04), 0 14px 32px -26px rgba(16,24,18,.32)
    hover on interactive cards: translateY(-4px) plus 0 22px 40px -28px rgba(16,24,18,.45)
    green button: 0 12px 24px -14px rgba(40,170,88,.8), hover 0 18px 30px -14px rgba(40,170,88,.7)

## 4. SPACING AND GRID

8px base. Steps in use: 4, 8, 9, 11, 16, 18, 20, 22, 24, 26, 34.

    sidebar         250px fixed, never collapses on desktop
    app header      78px, white, bottom border #E6EBE2
    main padding    28px 34px 46px, content max-width 1180px centred
    section gap     20px between top-level sections, 16px between cards in a grid
    card padding    24px, feature panel 26px 28px
    two-col grid    1fr 372px, align-items stretch
    min app width   1320px, below that the shell scrolls horizontally

## 5. MOTION

    enter   animation rise .4s cubic-bezier(.22,1,.36,1) both, opacity 0 to 1, translateY 14px to 0
    hover   transition transform .16s cubic-bezier(.22,1,.36,1), box-shadow .2s ease
    tint    transition background .18s ease, border-color .18s ease
    active  transform translateY(0) scale(.98)

Only ONE continuous animation in the whole product: the pulsing halo behind the voice-agent mic,
2.6s ease-in-out infinite, opacity .45 to .85, scale 1 to 1.08. Nothing else loops.
prefers-reduced-motion: drop the enter animation and the halo, keep hovers.

## 6. RTL

Root element gets dir rtl and lang he. Logical properties only: margin-inline-start,
padding-inline-end, inset-inline-start. Never margin-left or margin-right in layout code.
Clock times, keyboard shortcuts, 50/50, currency and any Latin or number run inside Hebrew text get
dir ltr plus unicode-bidi isolate. Without it a shortcut chip renders reversed.
Chevrons point right to left: forward is the path M14 6l-6 6 6 6
