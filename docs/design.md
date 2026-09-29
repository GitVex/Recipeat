# Design

How Recipeat looks and moves: its colours, type, shapes, the places in the
app and how getting from one to another is drawn.

The feel it is after is a kitchen notebook: warm paper, olive ink, one
terracotta accent, a serif for what a recipe is called and a quiet sans for
everything said about it. Nothing shouts, and nothing moves unless it is
going somewhere.

Everything here that has a value is a custom property on `:root` in
`app/assets/main.css`, so that this page and the stylesheet name the same
things, and the stylesheet sets colour, size, radius, shadow and motion only
through them. A new component takes its values from here rather than
writing its own; a theme is a second set of values for the same names.

## Colour

### Palette

The stylesheet had 82 colours, falling into a handful of roles, each held by
one or two values that differed from their neighbours by less than the eye
separates. Grouped, they came to about thirty. The "Takes in" columns say
which of the old values each token replaced.

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
| `--line-strong` | `#d5d8c9` | `#d6d9c8` `#d3d6c6` `#c9ccbb` `#c8cebd` `#c7cbb8` `#dde1d1` `#d2d4c5` `#cfd3c2` `#dcdccf` | Input and node borders, text-button underlines, the lineage canvas's dots |
| `--line-dashed` | `#b6bea8` | `#b9bca9` | Drop zones, the dotted line under a scalable amount |

**Text**, darkest first. The three greys were darkened to pass contrast;
see [Contrast](#contrast).

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--ink` | `#303c2d` | | Headings, amounts, primary text |
| `--ink-soft` | `#6a6f62` | `#757b6c` `#77796f` `#6d765e` `#656e59` | Recipe body: ingredients and steps |
| `--muted` | `#6d6e64` | `#7a7c70` `#848975` ×7 `#85857a` `#858578` `#87877b` `#898a78` `#8d8d80` `#7f8973` `#7b8569` `#6b6f5f` | Eyebrows, meta lines, secondary copy |
| `--faint` | `#949486` | `#999b8a` `#939485` `#a0a392` `#a3a597` `#a4aa91` `#b7baaa` | What is not read: placeholders, separators, dots, handles |
| `--on-fill` | `#fff` | `white` | Text and icons on an olive or orange fill, and over photos |

**Olive**, the brand:

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--olive` | `#48563a` | | Primary buttons, the current selection |
| `--olive-deep` | `#34432b` | | Primary buttons on hover |
| `--olive-soft` | `#8c987b` | `#9aa28a` `#7c9664` | Doodles, history dots, the "ready" mark, lineage edges |
| `--olive-black` | `#172314` | `#15211485` (the hero photo's shade) | The one shadow colour; mixed, never used flat |

**Orange**, the accent:

| Token | Value | Takes in | Use |
|---|---|---|---|
| `--orange` | `#bb603e` | `#bf7851` (focus ring) | Fills, the italic word in a heading, the logo's dot, focus |
| `--orange-text` | `#a85638` | | Orange as text of ordinary size: destructive actions, hovers, problems |
| `--orange-deep` | `#ac492f` | | Error text |
| `--orange-soft` | `#f0d8c9` | `#ead7c4` | Rings around the current version, the earlier-version border |
| `--orange-wash` | `#fbefe9` | `#f5ede3` | A chosen destructive option, the earlier-version note |

**Diff highlights:** `--added` `#e3ead3` for words that came in. Words that
went are struck through in `--orange-text`.

**Translucent paper**, over a photo, is `--paper` mixed to 93% — `#fffdf5ed`
and `#fffdf4ec` were two hand-written versions of it.

**Landing tints.** The landing page's source cards use three pairs of a
background and a text colour, which stay as a set of their own rather than
joining the palette: the one decorative exception, kept as `--tint-*` tokens
so a theme can still reach them.

| Token | Value |
|---|---|
| `--tint-yellow` / `--tint-yellow-ink` | `#f2ebd6` / `#ab9150` |
| `--tint-peach` / `--tint-peach-ink` | `#f1e4d9` / `#a97556` |
| `--tint-green` / `--tint-green-ink` | `#e9ecdf` / `#6f7c58` |
| `--hand-ink` | `#74735a` — the handwritten note, darkened from `#8a896e` to 4.5:1 on cream, as it is read |
| `--hand-brown` | `#9a835d` — the source note's sparkle |
| `--hand-star` | `#ad784b` — the rating stars |

**Shadows** are one colour, `--olive-black`, at three strengths, where there
were nine shadows in six colours:

| Token | Value | Use |
|---|---|---|
| `--shadow-low` | `0 6px 18px`, 5% | Lineage nodes, the chosen import tab |
| `--shadow-raised` | `0 12px 40px`, 14% | Things lifted over the page: the save bar, the toast, menus, floating cards |
| `--shadow-overlay` | `0 30px 100px`, 25% | Dialogs |

The strengths are `color-mix()` of `--olive-black` with transparent. The
dialog backdrop is `--backdrop`, `#252e246b`, with a 6px blur.

### Contrast

Measured against WCAG AA, which asks for 4.5:1 for text of ordinary size.
Worst case is on `--wash`, where selected rows and empty states put text.

| Colour | On cream | On paper | On wash | |
|---|---|---|---|---|
| `--ink` | 10.9 | 11.4 | 10.2 | Passes |
| `--olive` | 7.4 | 7.7 | 6.9 | Passes; white on olive 7.9 |
| `--orange-deep` | 5.3 | 5.5 | 4.9 | Passes |
| `--ink-soft` `#6a6f62` | 4.9 | 5.1 | 4.5 | Passes — the recipe body |
| `--muted` `#6d6e64` | 4.9 | 5.1 | 4.5 | Passes |
| `--orange-text` `#a85638` | 4.9 | 5.1 | 4.5 | Passes |
| `--orange` `#bb603e` | 4.1 | 4.3 | 3.8 | Large text only; white on orange 4.3 |
| `--faint` `#949486` | 2.9 | 3.0 | 2.7 | Not for text that is read |

These greys are also the ones used smallest, where contrast matters most.
Each was darkened just enough to reach 4.5:1 on `--wash`, which keeps its
hue and most of its softness:

| Token | Was | Is | On wash |
|---|---|---|---|
| `--ink-soft` | `#757b6c` | `#6a6f62` | 4.5 |
| `--muted` | `#7a7c70` | `#6d6e64` | 4.5 |
| eyebrows, into `--muted` | `#848975` | `#6d6e64` | 4.5 |
| orange as text, `--orange-text` | `#bb603e` | `#a85638` | 4.5 |

`--faint` stays as it is for what is not read — separators, dots,
placeholders, the drag handle — and meta lines are `--muted`. The landing
page's big step numerals, 01 to 03, are `--line-strong`: drawn rather than
read, like the dots. The orange stays `#bb603e` as a fill and for
the italic words in display headings, which are large enough for 3:1.

## Type

Two families, both from Google Fonts:

- **Playfair Display** for what things are called: recipe titles, page and
  section headings, the hero. The word that carries a heading is set in
  italic, in orange — "Your little *recipe book.*"
- **DM Sans** for everything else: body, labels, buttons, meta lines.

Eyebrows — the small line above a heading — are DM Sans in capitals, tracked
out by 1.7px, in `--muted`.

### Scale

There were thirty-eight sizes, many one pixel apart, folded into ten.
**Nothing is set smaller than 7px**, and 7px is only for the smallest UI
elements — tags, chips, badges, the landing page's stamp — never for
anything read as a line or a sentence. Text that is read starts at 9px:
the 8px eyebrows, and the 7px lines that were read, moved up to it.

| Token | Size | Family | Use | Takes in |
|---|---|---|---|---|
| `--text-tag` | 7px | Sans, caps | Tags, chips, badges — the smallest UI elements only | 6px, 7px where it is a badge |
| `--text-eyebrow` | 9px | Sans, caps | Eyebrows | 8px ×12, 7px where it is read |
| `--text-meta` | 10px | Sans | Meta lines, captions, tags, text buttons | 11px |
| `--text-small` | 12px | Sans | Small buttons, secondary copy | |
| `--text-body` | 13px | Sans | Recipe body, paragraphs | |
| `--text-ui` | 14px | Sans | Inputs, primary buttons | 15px, 16px |
| `--title-s` | 17px | Serif | List entries, card titles | 18px, 19px |
| `--title-m` | 24px | Serif | Section headings, states, a phone's titles | 21–23px, 26px |
| `--title-l` | 34px | Serif | Page and recipe titles, the logo | 27–33px |
| `--display` | `clamp(38px, 5vw, 61px)` | Serif | The hero and landing headings | 36–77px |

The sizes are named by step rather than by family: the logo, in DM Sans, is
`--title-l`, and an ingredient heading can be `--title-s`.

**A size for a narrower screen folds to its nearest step**, not to the
step its range folds into above: it is there to be smaller than the one it
replaces, so a phone's 27–29px titles are `--title-m`, not `--title-l`.

Weights: 400, 500 and 600, and those are all that are loaded — DM Sans at
the three, Playfair Display at 400 and its italic, the only ones it is set
in. `b`, `strong` and `h3` ask for 600 rather than the browser's 700.

## Shape

**Radii**, from seventeen. The landing hero's photo keeps its 135px corner,
a shape rather than a radius; its other three are `--radius-m`.

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
| Collection | `/collections/:id` | One column: the recipes in their order, a row each, dragged by a handle or moved by buttons |
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

### Tokens

| Token | Value | For |
|---|---|---|
| `--dur-exit` | 120ms | Anything leaving; hover and focus colour changes |
| `--dur-enter` | 200ms | Anything arriving; crossfades |
| `--dur-move` | 350ms | Layout moving: the fold, rows closing up |
| `--ease-enter` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Arriving: fast, then settling |
| `--ease-move` | `cubic-bezier(0.4, 0, 0.2, 1)` | Moving from one place to another |
| `--ease-exit` | `ease-in` | Leaving |

The ten durations there were map onto them: 0.12–0.16s to exit,
0.2–0.25s to enter, 0.35–0.4s to move, and hover and focus colour changes
to exit. The 0.4s zoom on a hovered card image is a move. A delay waiting
for something to leave is `--dur-exit`.

Where an arriving and a leaving transition share a rule, the leave still
takes the arrival's time and easing. Splitting those rules, so leaving is
quicker as the rules below ask, is still to do.

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

- **The smallest text is 7px, and only for the smallest UI elements.** Tags,
  chips and badges may use `--text-tag`; anything read as a line or a
  sentence starts at `--text-eyebrow`, 9px, and eyebrows move up to it from
  8px. At 7px the colour still has to reach 4.5:1 on its surface.
- **The lineage fades in**, like any other place. It is the recipe seen from
  further away, but it is not drawn as a zoom.
- **A picture opens its recipe with a fade.** Clicking a card's or an
  entry's picture does what clicking its title does, and is drawn the same
  way — the recipe dialog rises, the collection folds — rather than the
  picture growing into the recipe.
- **Dark mode is out of scope for now**, and will be an issue of its own.
  Keeping every colour a token is what this page does to leave room for it.
- **The stylesheet sets its values only through these tokens** (#64). The
  landing page's tints are the one exception, and are still tokens, of a
  set of their own.
