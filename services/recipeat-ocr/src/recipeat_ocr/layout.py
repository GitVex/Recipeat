"""Turning detected boxes into a page laid out the way it was written.

RapidOCR's own `to_markdown` groups boxes into rows across the full page width.
On a single-column page that is right. On a recipe with ingredients in one
column and steps in another it is fatal: two unrelated lines at the same height
are concatenated into one, and the reading order alternates between columns. A
model handed that sees a recipe whose ingredients and steps are shuffled
together, and there is nothing downstream that can undo it.

What this owes the model is narrower than document layout analysis. The model
decides what is an ingredient and what is a step; this only has to avoid gluing
unrelated lines together, keep the order within a block, and show where one
block ends. Getting the blocks in the wrong order is recoverable. Merging them
is not — so where the two cannot be told apart, the block is returned whole
and marked, and the model is told to expect a seam it may have to find itself.

So: recursive XY-cut. Project the boxes onto an axis, find the widest band that
almost nothing crosses, split there, recurse. A vertical cut handles
ingredients beside steps, a horizontal one handles ingredients above or below
them, and the recursion handles a sidebar inside either. One mechanism for
every arrangement, and when no confident cut exists the page stays one block,
which is the old behaviour and the right answer for a page that really is one
column.

The two axes are not found the same way, and that is the part worth reading.
Rows really are separated by whitespace, so a coverage profile finds them. A
column boundary often is not: on the page this was written against the left
column's longest lines run to x=718 while the right column begins at x=685, so
there is no band of any width that no box crosses. What separates columns is
that text is left-aligned within one — the left edges fall into tight clusters
with a wide gap between, even while the extents overlap. So a vertical cut
looks for a gap in left edges, and earns it by checking that the two groups
occupy the same vertical extent: real columns run down the page beside each
other, whereas an indented sub-list sits inside its parent's range.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# A gutter has to be wider than the space between lines, or every blank line
# becomes a block boundary and the page shreds. Measured in median line
# heights, which is the only scale on the page that means anything.
_MIN_COLUMN_GAP = 1.6
_MIN_ROW_GAP = 2.4

# Two groups of left edges are two columns only if they run down the page
# beside each other. Below this much shared vertical extent — as a fraction of
# the taller group's range — an apparent column is an indent.
_MIN_COLUMN_OVERLAP = 0.5

# What the two column thresholds relax to once the question stops being whether
# to cut and becomes whether the page might have needed it. Evidence this weak
# is not enough to split a block on — a tight gutter is as likely to be an
# indent — but it is enough to say the page could not be read with confidence,
# which is a different answer from a page that is genuinely one column.
_NEAR_COLUMN_GAP = 0.9
_NEAR_COLUMN_OVERLAP = 0.3

# A cut that leaves almost nothing on one side is noise, not structure.
_MIN_SIDE = 2

# Recipes are not deeply nested. This bounds the work and stops a pathological
# page from being cut into single lines.
_MAX_DEPTH = 3

# Two boxes belong to the same line when their tops are within this much of a
# line height. Compared against the row's own top edge, never the last box
# added: chaining near-misses swallows a whole column into one line.
_ROW_TOLERANCE = 0.7

# A blank line is emitted inside a block at this much empty space between two
# rows — free space, the same quantity `_MIN_ROW_GAP` uses, not the distance
# between their tops. Comparing tops instead measures line pitch, which is
# already more than a line height on any normally set page, so every line got
# its own stanza. Below the cut threshold on purpose: this separates stanzas,
# not blocks.
_STANZA_GAP = 1.2


@dataclass(frozen=True)
class Block:
    """One region of the page, already laid out."""

    text: str
    line_indices: list[int]
    # Whether a column boundary inside this block was nearly good enough to cut
    # on. The block is returned whole either way; this only distinguishes a
    # page that is one column from one whose columns could not be told from an
    # indent. See `_near_column` for what the caller is expected to do with it.
    uncertain: bool = False


def lay_out(boxes: np.ndarray, texts: list[str]) -> list[Block]:
    """Lay a page out from its detected boxes.

    `boxes` is RapidOCR's shape: one quadrilateral of four (x, y) points per
    recognised line, in the order the detector emitted them. `texts` runs
    parallel to it. Pure, so it can be tested without an engine.
    """
    if len(texts) == 0:
        return []
    if len(texts) == 1:
        return [Block(text=texts[0], line_indices=[0])]

    quads = np.asarray(boxes, dtype=float)
    quads = _deskew(quads)

    x0 = quads[:, :, 0].min(axis=1)
    x1 = quads[:, :, 0].max(axis=1)
    y0 = quads[:, :, 1].min(axis=1)
    y1 = quads[:, :, 1].max(axis=1)

    # Every threshold is in units of this. A page photographed closer has
    # bigger everything, and nothing here should care.
    line_h = float(np.median(y1 - y0)) or 1.0

    groups = _cut(list(range(len(texts))), x0, x1, y0, y1, line_h, depth=0)
    return [
        Block(
            text=_rows(g, x0, y0, y1, texts, line_h),
            line_indices=sorted(g, key=lambda i: (y0[i], x0[i])),
            uncertain=unsure,
        )
        for g, unsure in groups
    ]


def _deskew(quads: np.ndarray) -> np.ndarray:
    """Rotate the coordinates so the text runs flat.

    A photograph of a page is rarely square to the camera, and every threshold
    below assumes axis-aligned text — a page tilted by a couple of degrees
    smears the gutter until it is no longer findable. Only the coordinates are
    rotated, never the image, so this costs microseconds and the crops the
    recogniser already read are untouched.
    """
    # The top edge of each box, which runs along its baseline.
    edges = quads[:, 1, :] - quads[:, 0, :]
    angles = np.arctan2(edges[:, 1], edges[:, 0])
    # Boxes the detector emitted rotated by a quarter turn would drag the
    # median away from the page's own skew.
    upright = angles[np.abs(angles) < math.radians(30)]
    if len(upright) < max(3, len(quads) // 4):
        return quads

    theta = float(np.median(upright))
    if abs(theta) < math.radians(0.5):
        return quads

    centre = quads.reshape(-1, 2).mean(axis=0)
    cos, sin = math.cos(-theta), math.sin(-theta)
    rotation = np.array([[cos, -sin], [sin, cos]])
    return (quads - centre) @ rotation.T + centre


def _cut(
    idx: list[int],
    x0: np.ndarray,
    x1: np.ndarray,
    y0: np.ndarray,
    y1: np.ndarray,
    line_h: float,
    depth: int,
) -> list[tuple[list[int], bool]]:
    """Split a set of boxes into blocks, recursively, or return it whole.

    Each group comes back with whether it was left whole over a column
    boundary that nearly qualified, which is the only thing a caller can act
    on that this module cannot.
    """
    # Too few boxes to hold two columns of any substance, or already cut as
    # deeply as a recipe is ever laid out. Neither is a judgement call, so
    # neither is worth warning about.
    if depth >= _MAX_DEPTH or len(idx) < _MIN_SIDE * 2:
        return [(idx, False)]

    vertical = _column_gap(
        idx, x0, y0, y1, line_h * _MIN_COLUMN_GAP, _MIN_COLUMN_OVERLAP
    )
    horizontal = _widest_gap(idx, y0, y1, line_h * _MIN_ROW_GAP)

    # Whichever gap is more emphatic in its own units. Ties go to the vertical
    # cut, because reading order across columns is the thing that goes wrong.
    best = None
    if vertical and horizontal:
        best = (
            vertical
            if vertical[1] / _MIN_COLUMN_GAP >= horizontal[1] / _MIN_ROW_GAP
            else horizontal
        )
    else:
        best = vertical or horizontal
    if best is None:
        return [(idx, _near_column(idx, x0, y0, y1, line_h))]

    at, _, axis_starts = best
    near = [i for i in idx if axis_starts[i] < at]
    far = [i for i in idx if axis_starts[i] >= at]
    if len(near) < _MIN_SIDE or len(far) < _MIN_SIDE:
        return [(idx, _near_column(idx, x0, y0, y1, line_h))]

    return _cut(near, x0, x1, y0, y1, line_h, depth + 1) + _cut(
        far, x0, x1, y0, y1, line_h, depth + 1
    )


def _near_column(
    idx: list[int],
    x0: np.ndarray,
    y0: np.ndarray,
    y1: np.ndarray,
    line_h: float,
) -> bool:
    """Whether a column boundary was nearly there.

    `_column_gap` answers with a boundary or with nothing, and nothing covers
    two very different pages: one that is genuinely a single column, and one
    whose columns are set too tight, or run beside each other too briefly, to
    be called apart. Both are returned whole — that part is right, because a
    block wrongly split cannot be put back together — but they are not the same
    page to the model downstream. It can read one line holding an ingredient
    and half a step and separate them again from context, and it will only look
    for that seam if it is told the seam may be there.

    So the scan runs a second time with both thresholds relaxed. Nothing it
    finds is acted on here. It is only the difference between "one column" and
    "could not tell", and an indent deep enough to reach this is exactly the
    case that could not be told either way.
    """
    return (
        _column_gap(
            idx, x0, y0, y1, line_h * _NEAR_COLUMN_GAP, _NEAR_COLUMN_OVERLAP
        )
        is not None
    )


def _column_gap(
    idx: list[int],
    x0: np.ndarray,
    y0: np.ndarray,
    y1: np.ndarray,
    minimum: float,
    overlap: float,
) -> tuple[float, float, np.ndarray] | None:
    """The boundary between two columns, found by left edge rather than by gap.

    Coverage cannot find this: a column's longest lines routinely overrun the
    next column's left edge, so the whitespace between them is not a band any
    profile can see. What is reliable is that text is left-aligned within a
    column, so the left edges cluster and the widest gap between sorted
    clusters is the boundary.

    That alone would also fire on an indented block, which is why the split has
    to earn it — two columns occupy the same vertical extent, an indent does
    not. `minimum` and `overlap` are passed rather than read from the module so
    that `_near_column` can ask the same question at a lower bar.
    """
    lefts = np.sort(x0[idx])
    gaps = np.diff(lefts)
    if len(gaps) == 0:
        return None

    # Every candidate, widest first, rather than the widest alone. One stray
    # box — a page number in the margin — otherwise owns the largest gap on the
    # page, fails the checks below, and takes the real column boundary down
    # with it.
    for candidate in np.argsort(gaps)[::-1]:
        width = float(gaps[candidate])
        if width < minimum:
            break

        at = float((lefts[candidate] + lefts[candidate + 1]) / 2)
        near = [i for i in idx if x0[i] < at]
        far = [i for i in idx if x0[i] >= at]
        if len(near) < _MIN_SIDE or len(far) < _MIN_SIDE:
            continue

        near_lo, near_hi = float(np.min(y0[near])), float(np.max(y1[near]))
        far_lo, far_hi = float(np.min(y0[far])), float(np.max(y1[far]))
        # Against the longer of the two ranges, not the shorter. A short
        # indented run sits wholly inside its parent's extent and so overlaps
        # the shorter range completely — measuring that way calls every indent
        # a column.
        shared = min(near_hi, far_hi) - max(near_lo, far_lo)
        longer = max(near_hi - near_lo, far_hi - far_lo)
        if longer <= 0 or shared / longer < overlap:
            continue

        return at, width, x0

    return None


def _widest_gap(
    idx: list[int], starts: np.ndarray, ends: np.ndarray, minimum: float
) -> tuple[float, float, np.ndarray] | None:
    """The widest band across this axis that almost nothing crosses.

    Returns where to split, how wide the band was, and the axis it was found
    on — or None when nothing beats `minimum`. Used for row gaps only, where
    the whitespace between blocks is real.
    """
    lo = float(np.min(starts[idx]))
    hi = float(np.max(ends[idx]))
    if hi - lo < minimum:
        return None

    # One bucket per unit of the axis, rounded outward, with a difference array
    # so coverage is one pass rather than one per box.
    span = int(math.ceil(hi - lo)) + 1
    delta = np.zeros(span + 1, dtype=np.int32)
    for i in idx:
        a = max(0, int(starts[i] - lo))
        b = min(span, int(math.ceil(ends[i] - lo)))
        if b > a:
            delta[a] += 1
            delta[b] -= 1
    coverage = np.cumsum(delta[:span])

    # Strictly empty, with no allowance for a box crossing. Text lines do not
    # overlap vertically, so ordinary coverage on this axis is 1 inside a row
    # and 0 between them — allowing even a single crossing makes the whole axis
    # read as one continuous gap and finds nothing at all. The column axis is
    # the one that needs tolerance, and it gets it by clustering left edges
    # instead of profiling coverage.
    empty = coverage == 0

    best_at, best_width = None, 0.0
    run_start = None
    for position, free in enumerate(empty):
        if free and run_start is None:
            run_start = position
        elif not free and run_start is not None:
            width = position - run_start
            # A band touching either margin is the page's own edge, not a gap
            # between blocks.
            if run_start > 0 and width > best_width:
                best_at, best_width = run_start + width / 2, float(width)
            run_start = None
    # A run reaching the end of the axis is the right margin, not a gutter, so
    # the loop leaving it unclosed is correct rather than an oversight.

    if best_at is None or best_width < minimum:
        return None
    return lo + best_at, best_width, starts


def _rows(
    idx: list[int],
    x0: np.ndarray,
    y0: np.ndarray,
    y1: np.ndarray,
    texts: list[str],
    line_h: float,
) -> str:
    """The text of one block, in reading order."""
    ordered = sorted(idx, key=lambda i: (y0[i], x0[i]))

    rows: list[list[int]] = [[ordered[0]]]
    for i in ordered[1:]:
        # Against the row's own top edge. See _ROW_TOLERANCE.
        if y0[i] - y0[rows[-1][0]] < line_h * _ROW_TOLERANCE:
            rows[-1].append(i)
        else:
            rows.append([i])

    lines: list[str] = []
    for n, row in enumerate(rows):
        if n:
            free = y0[row[0]] - max(y1[i] for i in rows[n - 1])
            if free > line_h * _STANZA_GAP:
                lines.append("")
        lines.append(" ".join(texts[i] for i in sorted(row, key=lambda i: x0[i])))
    return "\n".join(lines)
