# Design

How Recipeat looks and moves: its colours, type, shapes, the places in the
app and how getting from one to another is drawn. What is marked
**planned** is agreed but not in the CSS yet — the redesign moves the
stylesheet onto it; the rest describes the app as it stands.

The feel it is after is a kitchen notebook: warm paper, olive ink, one
terracotta accent, a serif for what a recipe is called and a quiet sans for
everything said about it. Nothing shouts, and nothing moves unless it is
going somewhere.

Everything here that has a value is meant to live as a custom property on
`:root` in `app/assets/main.css`, so that this page and the stylesheet name
the same things. Today five colours do; the rest is written out where it is
used — 82 distinct colours, 38 font sizes, 17 radii, 10 durations.

## Colour

### Named today

| Token | Value | Use |
|---|---|---|
| `--cream` | `#faf8f2` | The page |
| `--ink` | `#303c2d` | Headings and text that is read first |
| `--olive` | `#48563a` | Primary buttons, selected states, links on hover |
| `--muted` | `#7a7c70` | Secondary text |
| `--line` | `#e5e5d9` | Rules and hairline borders |
| `--orange` | `#bb603e` | The accent: italic words in headings, destructive actions |

### Palette — planned

The 82 colours fall into a handful of roles, each held by one or two values
that differ from their neighbours by less than the eye separates. Grouped,
they come to about thirty.

**Surfaces**, lightest first:

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--paper` | `#fffdf8` | `#fffdf9` `#fffdf7` `#fbfaf4` | Cards, the collection pane, inputs, lineage nodes |
| `--cream` | `#faf8f2` | | The page |
| `--cream-deep` | `#f6f5ee` | `#f2f2e8` | The lineage canvas, the sources strip |
| `--wash` | `#f0f1e7` | `#eef0e6` `#edf0e4` `#edefe3` `#eeeee4` `#f0eee4` | Hover and selected rows, quiet panels, empty states |
| `--sage-100` | `#e4e7db` | `#e9ecdf` `#e9ebdf` `#e8ecd9` `#e2e6d7` | Image placeholders, thumbnails, pressed rows |

**Lines:**

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--line` | `#e5e5d9` | | Hairlines between sections |
| `--line-strong` | `#d5d8c9` | `#d6d9c8` `#d3d6c6` `#c9ccbb` `#c8cebd` `#c7cbb8` | Input and node borders, text-button underlines |
| `--line-dashed` | `#b6bea8` | | Drop zones |

**Text**, darkest first. The three greys are where the contrast problems
are; see [Contrast](#contrast).

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--ink` | `#303c2d` | | Headings, amounts, primary text |
| `--ink-soft` | `#757b6c` | `#77796f` `#6d765e` `#656e59` | Recipe body: ingredients and steps |
| `--muted` | `#7a7c70` | `#848975` ×7 `#85857a` `#858578` `#87877b` `#898a78` `#8d8d80` `#7f8973` `#7b8569` | Eyebrows, secondary copy |
| `--faint` | `#949486` | `#999b8a` `#939485` `#a0a392` `#a3a597` `#a4aa91` `#b7baaa` | Meta lines, placeholders, separators |

**Olive**, the brand:

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--olive` | `#48563a` | | Primary buttons, the current selection |
| `--olive-deep` | `#34432b` | | Primary buttons on hover |
| `--olive-soft` | `#8c987b` | `#9aa28a` `#7c9664` | Doodles, history dots, the "ready" mark |

**Orange**, the accent:

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--orange` | `#bb603e` | `#bf7851` (focus ring) | Emphasis in headings, destructive actions, focus |
| `--orange-deep` | `#ac492f` | | Error text |
| `--orange-soft` | `#f0d8c9` | `#ead7c4` | Rings around the current version, the earlier-version border |
| `--orange-wash` | `#fbefe9` | `#f5ede3` | A chosen destructive option, the earlier-version note |

**Diff highlights:** `--added` `#e3ead3` for words that came in. Words that
went are struck through in `--faint` rather than tinted.

**Landing tints.** The landing page's source cards use three pairs of a
background and a text colour, which stay as a set of their own rather than
joining the palette: yellow `#f2ebd6` / `#ab9150`, peach `#f1e4d9` /
`#a97556`, green `#e9ecdf` / `#6f7c58`. The handwritten notes and stars
(`#8a896e`, `#9a835d`, `#ad784b`) belong with them.

**Shadows** are one colour, the olive-black `#172314`, at three strengths,
where there are nine shadows in six colours today:

| Token | Value | Use |
|---|---|---|
| `--shadow-low` | `0 6px 18px #1723140d` | Lineage nodes, tabs |
| `--shadow-raised` | `0 12px 40px #17231424` | Things lifted over the page: the save bar, the toast, floating cards |
| `--shadow-overlay` | `0 30px 100px #17231440` | Dialogs |

The dialog backdrop is `#252e246b` with a 6px blur.

### Contrast

Measured against WCAG AA, which asks for 4.5:1 for text of ordinary size.
Worst case is on `--wash`, where selected rows and empty states put text.

| Colour | On cream | On paper | On wash | |
|---|---|---|---|---|
| `--ink` | 10.9 | 11.4 | 10.2 | Passes |
| `--olive` | 7.4 | 7.7 | 6.9 | Passes; white on olive 7.9 |
| `--orange-deep` | 5.3 | 5.5 | 4.9 | Passes |
| `--ink-soft` `#757b6c` | 4.1 | 4.3 | 3.8 | **Fails** — the recipe body |
| `--muted` `#7a7c70` | 4.0 | 4.2 | 3.7 | **Fails** |
| `--orange` `#bb603e` | 4.1 | 4.3 | 3.8 | **Fails** as text; white on orange 4.3 |
| `#848975` (eyebrows) | 3.4 | 3.6 | 3.2 | **Fails** |
| `--faint` `#949486` | 2.9 | 3.0 | 2.7 | **Fails** |

These greys are also the ones used smallest, at 7–10px, where contrast
matters most. **Planned:** each is darkened just enough to reach 4.5:1 on
`--wash`, which keeps its hue and most of its softness:

| Token | Now | Planned | On wash |
|---|---|---|---|
| `--ink-soft` | `#757b6c` | `#6a6f62` | 4.5 |
| `--muted` | `#7a7c70` | `#6d6e64` | 4.5 |
| eyebrows, into `--muted` | `#848975` | `#6b6f5f` | 4.5 |
| `--orange`, as text | `#bb603e` | `#a85638` | 4.5 |

`--faint` stays as it is for what is not read — separators, dots,
placeholders — and is no longer used for meta lines, which move to `--muted`.
The orange stays `#bb603e` as a fill and for the italic words in display
headings, which are large enough for 3:1.

## Type

Two families, both from Google Fonts:

- **Playfair Display** for what things are called: recipe titles, page and
  section headings, the hero. The word that carries a heading is set in
  italic, in orange — "Your little *recipe book.*"
- **DM Sans** for everything else: body, labels, buttons, meta lines.

Eyebrows — the small line above a heading — are DM Sans in capitals, tracked
out by 1.7px, in `--muted`.

### Scale — planned

Thirty-eight sizes today, many one pixel apart. Folded into nine. **Nothing
is set smaller than 9px**: the 7px and 8px text of today moves up to it.

| Token | Size | Family | Use | Takes in |
|---|---|---|---|---|
| `--text-eyebrow` | 9px | Sans, caps | Eyebrows, chips | 7px ×5, 8px ×12 |
| `--text-meta` | 10px | Sans | Meta lines, captions | 11px |
| `--text-small` | 12px | Sans | Small buttons, secondary copy | |
| `--text-body` | 13px | Sans | Recipe body, paragraphs | |
| `--text-ui` | 14px | Sans | Inputs, primary buttons | 15px, 16px |
| `--title-s` | 17px | Serif | List entries, card titles | 18px, 19px |
| `--title-m` | 24px | Serif | Section headings, states | 22px, 23px, 26px |
| `--title-l` | 34px | Serif | Page and recipe titles | 27–33px |
| `--display` | `clamp(38px, 5vw, 61px)` | Serif | The hero and landing headings | 36–77px |

Weights: 400, 500 and 600. The stylesheet uses six (400–700 in steps of 50),
and the font is loaded with seven.

## Shape

**Radii**, seventeen today:

| Token | Value | Use |
|---|---|---|
| `--radius-s` | 6px | Buttons, inputs, chips |
| `--radius-m` | 10px | List entries, thumbnails, notes, state panels |
| `--radius-l` | 14px | Cards, the collection pane, the save bar |
| `--radius-xl` | 18px | Dialogs |
| | 999px | Pills and toggles |
| | 50% | Round icon buttons, dots |

**Width.** Content sits in `.page-width`: `min(1200px, 100% - 100px)`, then
64px and 40px of margin as the screen narrows.

**Breakpoints**, as used: 1450px and up is wide; 1100px; **800px**, where the
collection stops being two columns and the header's links go behind a menu;
600px, where the landing page restacks. `hover: none` shows controls that a
pointer would otherwise reveal.

## Places and navigation

| Place | Route | Layout |
|---|---|---|
| Landing | `/` | Full width: the hero, how it works, the sample shelf |
| Collection | `/recipes` | The list on the left, a preview of the entry under the pointer on the right |
| Recipe | `/recipes/:id` | The list folded to a rail of pictures, the recipe in the room it leaves |
| Lineage | `/recipes/:id/lineage` | Full width: a recipe's versions as a tree |
| Collections | `/collections` | Full width and quiet: a search bar, then a card per collection, its first four recipes as a 2×2 mosaic |
| Profile | `/profile` | Who is signed in, and what they have kept |

Laid over any of them: the import dialog; the recipe dialog, for samples and
fresh imports; the collection picker, opened from a list entry or a recipe;
the confirmations — leave without saving, delete; and the toast.

On a phone the collection is one column. The list is the page, and opening
a recipe replaces it; the rail is a heading with a way back.

### The spatial model

The app reads left to right, broad to particular. The list is to the left of
the recipe, and opening a recipe pushes the list further left, into the
rail. Going back reverses what going forward did, exactly: the rail's toggle
opens the list out again the way it folded.

Every move between two screens is one of four kinds, and each kind has one
way of being drawn:

| Kind | Examples | Drawn as | Where |
|---|---|---|---|
| Same place, other content | Hovering the list; one recipe to another | Crossfade, the old over the new, both at once | `preview-*`; `page-*` in the pane |
| Deeper or shallower, one layout | List ↔ recipe | The layout reshapes; what stays on screen stays put, and nothing fades | `.collection` columns |
| Another place | Landing ↔ collection ↔ profile; recipe ↔ lineage | Fade out, then in | `page-*` |
| Laid over | Dialogs, the toast | Rises and fades in, sinks and fades out | `dialog-*`, `toast-*` |

Within a screen, what is added or taken away makes room or closes up rather
than appearing — rows in the editor, the save bar.

## Motion

### Tokens — planned

| Token | Value | For |
|---|---|---|
| `--dur-exit` | 120ms | Anything leaving; hover and focus colour changes |
| `--dur-enter` | 200ms | Anything arriving; crossfades |
| `--dur-move` | 350ms | Layout moving: the fold, rows closing up |
| `--ease-enter` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Arriving: fast, then settling |
| `--ease-move` | `cubic-bezier(0.4, 0, 0.2, 1)` | Moving from one place to another |
| `--ease-exit` | `ease-in` | Leaving |

Today's ten durations map onto them: 0.12–0.16s to exit, 0.2–0.25s to
enter, 0.35–0.4s to move. The 0.4s zoom on a hovered card image is a move.

### Rules

1. **Opacity and transform.** Nothing else animates, except the collection's
   columns when it folds. A layout that does animate has tracks of one kind
   on both sides — `370px` to `72px`, never `minmax()` to a length, which
   the browser cannot interpolate and jumps half way through instead.
2. **No transform on a page.** A page that moves takes its fixed dialogs
   with it. Pages fade.
3. **Leaving is quicker than arriving**, and what is leaving is already gone
   as far as anyone using the page is concerned: `retire()` makes it inert,
   hides it from screen readers and frees its ids the moment it starts to
   fade.
4. **Crossfade over, not out-then-in**, where the two things share a frame:
   the one going is lifted out of the flow and fades over the one coming.
   Out-then-in is for pages, which do not.
5. **Switch a transition off by its CSS, never by taking it away.** A
   `<NuxtPage>` given `transition: false` loses its `<Transition>` wrapper
   and builds the page again, and an unsaved edit with it.
6. **Focus goes with what arrives.** A dialog takes it when it opens and
   hands it back when it closes; one dialog replacing another gives it to
   the one arriving.
7. **Reduced motion turns all of it off.** The stylesheet does this for CSS.
   Anything timed in script must ask `prefers-reduced-motion` itself.

### How it is built

Vue's `<Transition>` and `<TransitionGroup>`, with every style in the motion
block at the end of `main.css`. No animation library, and no View Transitions:
nothing becomes something else on its way to another screen (see
[Decisions](#decisions)), so there is nothing for them to do.

Tests that measure where something is wait for it to settle first, 400–500ms.

## Decisions

- **The smallest text is 9px.** Eyebrows and chips move up from 7–8px; the
  scale starts there.
- **The lineage fades in**, like any other place. It is the recipe seen from
  further away, but it is not drawn as a zoom.
- **A picture opens its recipe with a fade.** Clicking a card's or an
  entry's picture does what clicking its title does, and is drawn the same
  way — the recipe dialog rises, the collection folds — rather than the
  picture growing into the recipe.
- **Dark mode is out of scope for now**, and will be an issue of its own.
  Keeping every colour a token is what this page does to leave room for it.
- **The palette, contrast fixes, type scale, radii, shadows and motion
  tokens above are agreed.** The redesign moves the stylesheet onto them:
  tokens first, then a section of the stylesheet at a time, with a
  screenshot of each page before and after.
