# DESIGN SYSTEM part 4 - DARK CARD, EMPTY STATES, LAYOUT, VOICE, A11Y

## 21. DARK ACCENT CARD - mentor or AI

background #141A15, radius 22, padding 24, color #E9EEEA. A badge tile in translucent violet with
the letters AI at 13/900. Title 18.5/900 white, body 15px #9AA89E, a full-width ghost-on-dark button
at height 48. At most ONE dark card per screen, and it is the last card in its column.

## 22. EMPTY AND ZERO STATES

Never an empty panel and never a red-flavoured warning. The pattern is Neutral tokens, the number 0
in #4A544C, and a green confirmation line with a check icon: flex, gap 10, font 700 15, #0B6E35.

## 23. CHARTS

Do NOT render donut or pie charts for small integer counts, and never draw an empty progress bar.
Use metric rows from section 14 instead: dot, label, number, one row per category, plus a total line
at margin-top auto. Charts are allowed only where the shape of the data is the message, such as a
multi-month trend.

## 24. LAYOUT PATTERNS

DASHBOARD-CLASS PAGE - any page whose job is answering "what should I do now":

    greeting row: h1 plus date line, then margin-inline-start auto, then the counter card
    grid 1fr / 372px, align-items stretch
        main column: the ranked action list card,
                     then a 1fr/1fr sub-grid of two analysis cards, stretched
        side column: calendar, tasks, network, dark mentor card with flex 1 on the last
    summary strip, same 1fr / 372px split, at the very bottom
        1fr: the voice-agent panel
        372px: the KPI tiles, two by two, in their compact form

Both columns must end at the same height: put flex 1 on the last card of the side column and on the
main column sub-grid. No dead space at the bottom of either column.

REVISED AFTER THE FIRST LIVE SCREEN. This section used to open the page with the voice-agent panel
at full width and the four KPI tiles in one full-width row, both above the grid. Together they took
the whole first fold, and the ranked action list - the one thing the page exists to answer - started
below it. The product owner asked for the reverse and was explicit about it: both blocks move to the
bottom, "the most important thing is that it is not at the top of the dashboard". He also called the
tiles too empty, which is what the compact form answers: a 150-tall tile holding a label, a number
and a short note is empty BECAUSE of its size. The compact tile drops the fixed height, puts the
number and the note on one baseline row, and takes the 372 column so the vertical seam of the grid
above runs to the bottom of the page. Enforced by apps/web/scripts/verify-screen-layout.mjs -
order is not a type error and no other gate can see it.

COUNTER CARD, top right: white, border 1px solid #DEE3D9, radius 16, padding 12px 18px, flex, gap 13.
A big number at 30px/900 in brand-ink, then two lines at 15.5/800 and 13.5 ink-2. It is a CARD, not a
pill.

LIST PAGE for properties, buyers or leads: the header, a filter bar of chips in the panel chip style,
then a card with flush rows. Row actions are secondary; the single primary lives in the header.

    header row: title, count line, then the page actions at the RTL end
    filter strip, same 1fr / 372px split as the dashboard
        1fr: the search card - field, buttons, city chips
        372px: the KPI tiles, two by two, compact
    list card: head with the sort and status controls,
               then the bulk-selection bar with a rule under it,
               then the rows

The bulk-selection bar sits ABOVE the rows, not below them. It used to close the card, which reads
fine with six rows and badly with a hundred: you tick a row at the top of the list and then scroll a
full page to reach the button that acts on it. The action belongs next to the selection. The bar is
always present and disabled until something is selected - "0 selected" is a state, not an error.

DETAIL PAGE: 1fr 372px. Left is an identity card then domain cards. Right is an activity timeline and
related items. The same card contract throughout.

MODAL: radius 24, padding 26px 28px, max-width 560, the same header pattern, actions at the RTL end
as secondary then primary, scrim rgba(16,24,18,.45).

## 25. CONTENT AND VOICE

- Hebrew, second person, plain and practical. No marketing tone inside the product.
- Every action row answers WHY NOW in one sentence: hot buyers with no offer means opportunities
  slipping away, so go over their matches.
- Buttons are verbs the user recognises, not generic labels like open or view.
- Numbers first when the number is the point: five collaboration offers awaiting your reply.
- Never blame the user for an empty state. State the fact and reassure.
- Quotation marks around example sentences the agent can hear. No emoji.
- Hebrew abbreviations keep the geresh form.

## 26. ACCESSIBILITY CHECKLIST - enforced

- Body text at least 4.5:1. #5E6860 passes on white and on #F8FAF6. Anything lighter is forbidden
  for text: #8A938B, #9AA39B, #A9B2AA and #96A199 are NOT text colors.
- Data values, including zeros and ordinals, at least #4A544C.
- Never encode meaning by color alone: every domain tint is paired with an icon and a label.
- Focus visible on every interactive element: a 4px green focus ring plus border-color #3FBF63.
- Hit targets at least 44px: nav rows 44, buttons 46 and up, list rows 66 and up.
- prefers-reduced-motion: no enter animation, no halo; hovers stay.
- Semantic markup: aside, header, main and nav elements, real buttons, one h1 per page.
