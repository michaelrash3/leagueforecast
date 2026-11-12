# Accessibility and design

_Part of the design documents; the map is in the repository's [README](../README.md)._

## Accessibility

- Dialogs use `role="dialog"` + `aria-modal="true"`.
- Tabs support keyboard navigation.
- Inputs are programmatically labeled.
- Standings rows support Enter/Space.
- A club's name is never cut to "…". On a 360px phone a name had 112 to 134px, and
  most real club names need more: five of eight Standings names, 21 Schedule cells
  and 15 of the National Top 25 were cut, and clubs of one organisation were cut to
  the same label. Names wrap onto a second line instead, on every League tab, the
  bracket and Team Rankings' top lists. League Stats keeps its ellipsis from `xl`,
  where its six-column grid would otherwise split names mid-word, and only for a
  league that keeps box scores: one that keeps final scores has two lists, R/G and
  RA/G, which in six columns sat in a third of the card with every name cut
  ("Lakesi…") beside four empty columns. Those two share the card's width, names
  whole (`StatRankingsPanel.test.tsx`).
- Below `sm` the Scouting report is cards, one per fixture and one per opponent,
  rendered in place of the tables (`useWideViewport`) rather than beside them: a
  six-column table in a card's width left the win chance and outlook past the edge
  of every row. The search boxes have a visible edge, and on a phone the picker's
  question sits whole above its box, where "fare?" used to print over the name.
- Below `sm` the Forecast bracket stacks its rounds, one under another, each game
  card the width of the screen. Side by side, a round's column was as wide as its
  longest line, so at 360px every card was 421 to 438px in a 286px scroller and all
  18 of the demo's run boxes and Set Final buttons sat past the edge. From `sm` up
  the rounds run left to right as before; `e2e/phone.spec.ts` holds both.

- **On a phone the tabs are a bar along the bottom of the screen** (2.4,
  `src/components/TabNav.tsx`, below `sm` as `useNarrowViewport` asks it). League
  Standings' bar holds Dashboard, Schedule, Standings and Forecast, each an icon over
  its label, and **More** for Power Ratings, League Stats, Data Quality, Settings,
  the tour and the keyboard shortcuts; Team Rankings' holds Rankings, Games, Import
  and Scouting, with Archive and Setup under More. Before, all eight League tabs sat
  in one row that scrolled sideways, with Settings past the edge. A row of the five
  would not fit either: their labels alone measured 295px in 12px type against the
  288px a 320px screen leaves, so the bar sizes its labels with the screen, 9px at
  320px and below to 11px from 390px, which keeps "Dashboard" inside its cell even
  at 125% browser zoom (a 360px phone is then 288px of page).
  - A view under More whose badge is urgent, Data Quality while something needs
    attention, is also a strip across the top of the bar ("Data Quality: 1 needs
    attention") rather than a sixth cell, which would not fit. More carries the
    badges of what is behind it, and names the view open under it to a screen reader
    ("More: Settings"). A badge's words describe its tab rather than join its name.
  - The open view's cell, or More while the open view is behind it, is dark and has
    a bar across its top edge. The dark label alone measured 2.67:1 against a
    closed one (2.63:1 in dark mode), under the 3:1 a state shown by colour alone
    needs.
  - The cells keep their tab roles, the roving `tabIndex`, the arrow keys and now
    Home and End; More is a disclosure button. Escape closes its list, and so does a
    tap anywhere else, a tab in the bar included, or the keyboard moving on past the
    list's end or back past More. A view or an action chosen from the list, or from
    the strip, leaves the focus on More, which then names the view. The button
    pressed goes with the list, and the focus used to fall to the top of the page
    with it, or be handed back there by a dialog the action opened (the keyboard
    shortcuts). The list is never taller than the screen leaves above the bar and
    scrolls inside itself past that; at 320 by 256 (1280 by 1024 at 400% zoom) Power
    Ratings had sat wholly above the screen, out of reach. The panel is named by its
    view's tab, and a view under More has none in the bar, so the bar carries a
    hidden name for it in that tab's place. Wide screens keep the row of tabs, with
    the same keys and badges.
  - Pages leave room below for the bar, and toasts sit above it. The page's scroll
    padding keeps the bar and its strip clear too, so a control the keyboard moves
    to is scrolled above the bar rather than to the screen's edge behind it: at 360
    by 640, tabbing down Settings had left two fields wholly under the bar and two
    partly, and leaves none now.
  - The app-mode switch fills a phone's row, each tab as wide as its label and the
    room left over shared between them. At its old size it was 336px wide in the
    288px a 320px screen leaves, which widened the whole page there; the new 320px
    checks found it. In equal halves "League Standings" ran out past its tab at
    288px unless its type was let down to 11px; sized by label, both stay at 12px
    or more with their text inside them from 280px up.
  - `e2e/phone.spec.ts` holds the bar at 320, 360 and 390px and at 125% zoom (every
    cell and More on screen, each label inside its cell, More's list on screen), the
    last of a page clear of the bar, and a tablet keeping all eight tabs in a row.
    Team Rankings' sections keep their links (`?section=`); League's views are, as
    before, carried by a share link rather than the address.

## Design system

The looks the app shares live in `src/styles/tokens.ts` (2.5), so a page title, a
footnote or a failed panel reads the same on every League view.

- **Text roles** (`textRole`): page title, the line under it, section title, card
  title, body, meta (dates, counts, sources), numeric (figures in tabular digits, so
  columns line up) and overline, a label a reader can do without. League's tables
  (Standings, Power Ratings, the Forecast's projected table, a team's games) set their
  figures in tabular digits too.
- **Three surfaces** (`surface`): the page itself, a card for what a page is about,
  and a quiet inset, without a border or shadow of its own, for what groups within
  one, so not every piece of content is an equally loud white card.
- **Page headers** (`PageHeader`): Standings, Power Ratings, League Stats, Forecast,
  Data Quality and Settings open the same way, with the title the tab named, its help
  button and a line saying what the view is for. On the Dashboard, Power Ratings is a
  section of that page and is titled as one.
- **States** (`StatePanel`, `stateTone`): empty, loading, error, offline and stale,
  each on a surface of its own. A failure interrupts a screen reader
  (`role="alert"`), the passing states are announced (`role="status"`), and an empty
  panel is simply part of the page. A view's placeholder while its code loads, the
  empty panels, a view that failed to draw (with Try again), and the line over League
  Standings kept live (stale while it connects, offline, or an error when the season
  can't be edited) all go through it.
- **No text under 12px.** The app set 10px and 11px type in 89 places: table headings,
  the names of figures, the run labels on a game card, a team's record. It is all 12px
  now, but for the phone's tab bar, whose labels are sized with the screen, and a line
  chart's labels inside its SVG. Section headings that were small capitals, such as
  Data Quality's "Worth reviewing", are now section titles.
- **4.5:1 contrast for text, 3:1 for large text.** What fell short, and what it is now:
  - Grey on the page: slate-500 measured 4.35:1 on the page's slate-100, under the
    line on the "Updated through" leads and on inactive tabs. The text roles and tabs
    are slate-600 at the lightest, 6.90:1.
  - White on emerald-600 measured 3.67:1 (Save + Final, the Safe seed badge, the
    success toast), and emerald-600 text on white the same. Both are emerald-700,
    5.37:1.
  - White on orange-500, the Chasing seed badge, measured 2.89:1; its figures are dark
    now, 6.98:1.
  - Red-600 on a dark game card's slate-800, the Delete button, measured 3.08:1;
    red-400 is 5.07:1.
  - The seed odds grid shaded up to full blue-500, under which white figures measured
    3.68:1 and grey ones less. It stops at 80% blue, with dark figures in light mode
    (7.26:1 at the strongest) and white in dark (5.01:1). Its cut-line column heading
    was red-500 on white, 3.81:1, and is red-700, 6.42:1.
  - The schedule-difficulty cards drew their opponents at 80% opacity (4.46:1 on the
    amber card); they are full strength now. The toast's dismiss button was 70% white
    on the toast, 2.53:1, and is white.
  - Team Rankings, since 1 November 2026: "not played" beside a half with no games was
    its tab's colour at 60%, 2.88:1 in light mode and 3.33:1 in dark; it is the tab's own
    colour, 7.56:1 and 7.68:1, told apart by its weight. The town and figures on your own
    club's highlighted row were slate-500 on blue-50, 4.38:1, and are slate-600, 6.94:1, on
    every row. The My Team card's star was amber-500 on white, 2.13:1, and is amber-700,
    5.05:1 (amber-400 in dark). The Games tab's day was slate-400 on white, 2.63:1, and is
    slate-500, as is the full table's grey place on the whole board beside a state's own,
    which measured the same. A tidy step that found nothing printed its zero in slate-400
    on slate-100, 2.40:1 (slate-600 on slate-900 in dark, 2.35:1), and is slate-600 (dark
    slate-400) on the same grey. One that found something faded its whole cell, white bold
    figure and all, to show less found, from emerald-500 down: 2.46:1 at its strongest and
    nearer 1:1 at its faintest. Only its ground is shaded now (`heatCell`, by `--heat`), an
    emerald-950 figure on emerald-500 in light mode and white on emerald-700 in dark, 6.14:1
    and 5.37:1 at the strongest and more as it fades, as the seed odds grid does it; the
    audit's seeded pool gives the tidy nothing to find, so `tokens.test.ts` measures it at
    every strength.
- **A thumb's tap area on a phone** (`tapArea`): Team Rankings' buttons and links are 44 px
  each way below `sm`, where its main ones were text links 16 to 26 px tall (Scout 34 by 16,
  What if? 48 by 16, the club sheet's Close 33 by 16, Got it 49 by 26, "Open on 10U by
  default" 136 by 16, measured at 390 px; Scouting's "Write this up with AI" pill 172 by 24 at
  360 px). From `sm` up a pointer aims and each keeps its own size, and its own line: What if?
  and Scout are each set on a line of their own under a game's opponent, since inline, side by
  side, a wide screen read them as "What if?Scout". A board's row is one button, the whole row opening its club where only its name did,
  a line 20 px tall: named by the club, described by the rest of the row, and reached by the
  keyboard once a row. A club's name inside a sentence of The Weekly is sized by its line, as
  WCAG's inline exception allows.
- **Words a parent reads** (since 1 November 2026). A count of a thousand or more has its
  comma wherever Team Rankings, its pull or League's Fill scores prints one: a board's "of
  1,190 ranked" and "Show all 1,190 teams", a place on it ("#1,203") in the full table,
  Scouting, The Weekly, Watching, the archive and the Since line, a week's move on the My Team
  card and a board's row ("▼1,300 since last week", which read "▼1300"), a pulled list's counts, and
  Fill scores' "1,993 pool results not on this schedule", which a nationwide pool printed as
  "1993". Nothing says "(s)": "About 1 minute of requests", "2 lines ignored", "1 row
  skipped", "Imported 1 game". A control with nothing to act on is not offered: the full
  table's toggle is not drawn for a board with no teams, where it read "Show all 0 teams",
  and Fill scores with nothing ticked says "Tick a game above to fill it." where its button
  read "Fill 0 games", or with nothing that can be ticked (every row one it cannot tell apart,
  and no game to add) says nothing at all. Scouting asks "How would this team fare?" whole above its box on
  every screen, where a wide one split it around the box. Nothing is said when the service
  worker has stored the app for use offline on a first visit (the owner's decision of the same
  day): "App shell cached for offline use." sat above the tab bar over the My Team card, and
  then, from #508, "Ready to use offline." at the top of the screen over the header. The banner
  that says a device is offline stays (`AppOfflineReady.test.tsx`). League's start screen opens on
  "Start your season" in place of "a guided flow" and "a visual setup lane", and calls the
  sample season "Made-up teams and scores", where "Safe sandbox mode" was not so: loaded over
  a season, it replaces it, with an undo.
- **How it is checked.**
  - `src/styles/tokens.test.ts` reads Tailwind's palette from its own theme
    (`tailwindcss/theme.css`, in OKLCH, converted as a browser draws it: slate-500
    comes out #62748e) and measures every text role on every surface, each status
    pill on a card, each state panel's words, and a heat cell's figure at every
    strength from none to full, in light mode and dark.
  - `src/components/textSize.test.ts` reads every component, Team Rankings' too, and
    the shared styles in `tokens.ts` for a size set below 12px, a size sized with the
    screen counted by its floor (the app-mode switch's `clamp(11px,…)` was 11.52px on
    a 320px phone, under the 360px the browser checks measure at).
  - `e2e/design.spec.ts` measures the built app: League Standings in light mode and
    dark, on a phone (360px), a tablet (768px) and a desktop (1280px), on every view of
    the demo season, on the first launch with no season, and while a view is loading
    and after it fails to; and Team Rankings at the same sizes on a pool seeded as an
    older version kept it, on every section, a club's sheet, the full table cut to one
    state, and the My Team card telling what moved since a visit two days before, its
    clock held so each run draws the same board. At every size it also finds any two of
    Team Rankings' buttons and links laid out together whose words touch on a line, less
    than a space apart, and on the phone every one under 44 px either way, but for one
    that shares its line with the page's own words, as a club's name in a sentence does
    (`controlProblems`). Words elsewhere in a control's box do not let it off: counted
    that way, as the check first was, the opponent's name above What if? and Scout let
    both off, and with their tap area taken away it still passed. With the star put back
    to amber-500 the contrast check fails at 2.13:1; with "Open on 10U by default" back
    to a text link the tap check fails at 136 by 16 px; with What if? and Scout back to
    inline text links it fails at 48 by 16 and 34 by 16 px on the phone and at "What if?
    and Scout Hawks: 0 px apart" on the tablet and the desktop. Every visible run of text is measured against what is
    actually painted behind it (see-through layers blended down to the first solid
    one), no text may be under 12px, and nothing may be wider than the screen. On the
    2.4 build it found 10 or 11px text in about 40 places on League's pages and a
    dozen colour pairs under 4.5:1; it finds none now. Text over a gradient or a
    picture, in a chart's SVG, or on a control that is switched off is counted but not
    measured.
  - **No pixel-by-pixel screenshot comparison in CI.** A screenshot from one Chromium
    and its fonts differs from another's, so a baseline taken here would fail in CI on
    how text is drawn rather than on the design. The checks above read the styles the
    browser computed, which do not depend on fonts. To look the pages over by eye,
    `SCREENS=1 npx playwright test e2e/design.spec.ts` (after a build) keeps a
    full-page screenshot of every state in `test-results/`.
  - The offline and stale states appear only for a member's League kept live, which the
    browser tests cannot sign in to; the unit tests (`StatePanel.test.tsx`) and the
    contrast test cover them instead.

## Platform baseline

This project tracks the newest dependency/runtime baseline that can be installed and verified in the current environment. The npm registry was unavailable through the configured proxy during the latest modernization pass, so the package manifest was advanced to the newest versions already present in the local lockfile/cache and runtime (`node` 24). When registry access is available, the next modernization target is the current stable major line for React, Vite, Tailwind CSS, ESLint, Vitest, and vite-plugin-pwa.
