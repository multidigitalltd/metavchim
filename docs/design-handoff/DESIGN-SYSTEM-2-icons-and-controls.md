# DESIGN SYSTEM part 2 - ICONS, LOGO, CORE COMPONENTS

## 7. ICONOGRAPHY

Inline SVG only, viewBox 0 0 24 24, fill none, stroke is the domain fg or currentColor,
stroke-width 1.8 to 2.2, round caps and joins, rendered 17 to 23px inside a tinted tile.
NO EMOJI anywhere in the product UI. No icon libraries. This is the vocabulary:

    dashboard      four squares 7x7 rx 2.2 at (3.5,3.5) (13.5,3.5) (3.5,13.5) (13.5,13.5)
    property       M3.8 10.5 12 4.2l8.2 6.3V19a1.4 1.4 0 0 1-1.4 1.4H5.2A1.4 1.4 0 0 1 3.8 19v-8.5Z
    buyer, people  M3.6 19.6c0-3.1 2.6-5.6 5.8-5.6s5.8 2.5 5.8 5.6M9.4 5a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z
    lead, bolt     M13.2 3.2 5.8 13h5.3l-1 7.8L17.9 11h-5.4l.7-7.8Z
    call           M5 4.6h3.4l1.7 4.3-2.1 1.3c.9 2.2 2.9 4.2 5.1 5.1l1.3-2.1 4.3 1.7v3.4a1.3 1.3 0 0 1-1.4 1.3C10.2 20.1 3.9 13.8 3.7 6A1.3 1.3 0 0 1 5 4.6Z
    match          M9.6 6.8a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4Zm4.8 0a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4Z
    collaboration  M9.2 9.2l5.6 5.6M7 4.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm10 10a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z
    calendar       M3.6 5.2h16.8v15.2H3.6zM3.6 10h16.8
    tasks          M4 6.6h12M4 12h12M4 17.4h8
    mic            rect 9,2.8 6x10.4 rx 3   plus   M5.6 11a6.4 6.4 0 0 0 12.8 0   plus   M12 17.4V21
    check          M5 12.5l4.4 4.4L19 7.4
    hot, flame     M12 21c4-2.4 6.4-5.4 6.4-8.6A6.4 6.4 0 0 0 12 6a6.4 6.4 0 0 0-6.4 6.4C5.6 15.6 8 18.6 12 21Z
    eye, review    M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12Zm9.4-2.8a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z
    shield, mentor M12 3.4 4.6 7.2v5c0 4.4 3.1 7.6 7.4 8.4 4.3-.8 7.4-4 7.4-8.4v-5L12 3.4Z
    idea, star     M12 3.6l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 10l6-.8L12 3.6Z
    search         circle 10.8,10.8 r 6.4   plus   M15.6 15.6 20 20
    bell           M6.4 9.6a5.6 5.6 0 0 1 11.2 0c0 4.6 1.8 5.6 1.8 5.6H4.6s1.8-1 1.8-5.6Z
    office         M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2ZM12 2.8v2.4M12 18.8v2.4M4.6 12H2.2M21.8 12h-2.4

## 8. LOGO

Two rounded brackets around a square. SVG viewBox 0 0 48 48, fill none, three shapes:

    path d="M28.5 6.5h7a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6h-7"   stroke #fff     stroke-width 5, round cap
    path d="M19.5 6.5h-7a6 6 0 0 0-6 6v23a6 6 0 0 0 6 6h7"    stroke #70EE91  stroke-width 5, round cap
    rect x 19.4  y 19.4  w 9.2  h 9.2  rx 2.4                 fill #fff

On light backgrounds swap #fff for #141A15. The wordmark is the brand name at weight 900,
letter-spacing -.02em, followed by a GREEN PERIOD. The period is part of the mark, never dropped.
The folder brand/ holds ready SVGs: logo-mark, logo-mark-dark, logo-mono, favicon, app-icon-512.

## 9. CARD

    background #fff, border 1px solid #E3E7DE, radius 22, padding 24
    box-shadow 0 1px 2px rgba(16,24,18,.04), 0 14px 32px -26px rgba(16,24,18,.32)

Card header, the same three parts everywhere: a 38px icon tile with radius 13 in the domain
icon-tile color, then the title at 18.5/900/-.02em, then margin-inline-start auto and a text link at
14.5/800 in brand-ink. Optional sub-line below the header: 14.5px ink-2 at margin-top 10.
A card whose body is a list of rows uses overflow hidden and a 70px header with a bottom border
#E7EAE3; the rows then run flush to the card edge.

## 10. BUTTONS

PRIMARY, one per screen region, the recommended action:
height 46 to 58, padding 0 22 to 30, no border, radius 15 to 17, background brand-grad,
color #08240F, font 900 16 to 17, shadow 0 12px 24px -14px rgba(40,170,88,.8).
Hover translateY(-2px) and a larger shadow, active scale(.98).

SECONDARY, alternate actions in a list:
height 46, padding 0 20, border 1px solid #DEE3D9, radius 15, background #fff, color #28312A,
font 800 15.5. Hover background #F2F5F0, border #C6CEC1, translateY(-2px).

DOMAIN-TINTED, an action that belongs to a domain:
border 1px solid the domain border, background the domain icon-tile, color the domain fg.

GHOST ON DARK, sidebar CTA and mentor card:
border 1px solid rgba(112,238,145,.35), background rgba(112,238,145,.1), color #70EE91.

TEXT LINK, for links like "to the full calendar" or "to all tasks":
no border, no background, color #0B6E35, font 800 14.5 to 15. With a chevron the hover animates the
gap from 8 to 12.

ICON BUTTON, header utilities:
46 by 46, border 1px solid #DEE3D9, radius 15, background #fff, hover border #BEE7CC and
translateY(-2px). Unread dot 9px #C05E36 with a 2px white ring.

Minimum hit target 44px. Never two primary buttons in one region.

## 11. INPUT AND SEARCH

    height 48, background #fff, border 1.5px solid #C6CEC1, radius 15,
    padding 0 9px 0 15px, flex row, align center, gap 11

Icon 19px, stroke #3B443D, width 2.2. Placeholder 15.5px/600 #4A544C. Placeholders are READABLE,
not pale. Trailing shortcut chip 13px/800, background #F2F4EF, border 1px solid #DEE3D9, radius 9,
padding 5px 10px, dir ltr plus unicode-bidi isolate.
Hover and focus: border #3FBF63 plus box-shadow 0 0 0 4px rgba(63,191,99,.15).

The large agent input: height 58, background #F8FAF6, border 1px solid #DEE3D9, radius 17,
padding 0 20px, font-size 16.5, color #5E6860, hover turns white.
