## 12. KPI TILE

Fixed height 150, radius 22, padding 20px 22px, background and border from the domain, the shared
card shadow, cursor pointer, hover translateY(-4px).
Internal order: header row with a 38px icon tile and the label at 15.5/800 #3B443D, then
margin-top auto pushes the number to the bottom at 46px/900/-.04em in the domain fg, then the note
at 14px ink-2 with margin-top 8.
ALL TILES IN A ROW SHARE ONE HEIGHT. Four per row, 1fr each, gap 16.

## 13. LIST ROW - the workhorse

Used for actions, calendar events, tasks, network items and funnel steps.

    flex row, align center, gap 15
    min-height 66 compact, or 96 for action rows
    padding 14px 16px inside a card, or 18px 24px for flush rows
    nested variant: border 1px solid #E7EAE3, background #F8FAF6, radius 16
    flush variant: bottom border 1px solid #EFF2EC, background #fff
    hover background #F6F9F3; nested hover background #DFF6E7 with border #BEE7CC

Anatomy: the ordinal at 15/900 #4A544C in a 26px centred column, then a 44px icon tile, then the
title at 17.5/800 with a why-line at 15px ink-2 and margin-top 4, then margin-inline-start auto and
the button.

PRIORITY RULE. In a ranked list the FIRST ROW ONLY gets the tinted background #F7FCF9 and the
PRIMARY button. Rows 2 and on stay white with SECONDARY buttons. This is the core UX decision of the
product. Never five rows with five identical calls to action.

## 14. METRIC ROW - label plus number

height 52, padding 0 16, radius 15, domain bg and border, an optional 11px status dot, the label at
16/800 in the domain fg, the number pushed to the end at 20px/900/-.02em.
Interactive - it opens the filtered list: hover translateY(-2px), cursor pointer.
A zero row uses Neutral tokens with the number in #4A544C, legibly zero.

## 15. SIDEBAR

width 250, background #0B0E0C, padding 20px 13px 16px, gap 16, column flex.

1. Logo lockup: a 29px mark plus the 23px wordmark.
2. Office card: padding 10, border 1px solid rgba(255,255,255,.09), radius 16, background
   rgba(255,255,255,.03), a 40px monogram tile in brand-grad, the office name at 14.5/800 #fff and
   the user line at 12.5 #8C978E. If the tenant uploaded a logo show the image in that tile; fall
   back to the monogram, never to an empty box.
3. Nav: a group eyebrow at 11.5/800/.09em #6F7A72 with padding 0 12px 8px, then the items at
   height 44, padding 0 12, radius 14, gap 12, font 600 15.5, color #B6C0B8. Hover background
   rgba(255,255,255,.07) and color #fff.
   ACTIVE: background rgba(112,238,145,.14), color #70EE91, weight 800, plus a 3 by 22px #70EE91 bar
   at inset-inline-end -13px, flush to the sidebar edge.
   Trailing count 13px/800 #70EE91. A status badge is 11.5/800, background rgba(112,238,145,.14),
   radius 999, padding 3px 9px, and is rendered ONLY when present. Never leave an empty badge
   element on rows that have none.
4. margin-top auto, then the ghost CTA button at height 50.

## 16. APP HEADER

height 78, background #fff, bottom border #E6EBE2, padding 0 34px, gap 14.
RTL order: the page title at 19/900/-.02em, then the search field capped at 440 with
margin-inline-start 22, then margin-inline-start auto, then the primary voice-agent button, the bell
button and the profile button.

## 17. VOICE-AGENT PANEL

White card, border 1px solid #A5D9B9, radius 24, padding 26px 28px, plus the deep panel shadow.
Header: a 52px mic tile in brand-grad radius 17, with the pulsing halo behind it. Then the title at
22/900, a sub-line at 15.5 ink-2, and a text link with a chevron at the end.
Then the 58px input, the dictate secondary button, the submit primary button.
Then the suggestion chips at radius 999, padding 11px 18px, font 700 14.5.
Chips are real example sentences in quotes, in the user own voice; clicking one fills and submits.
