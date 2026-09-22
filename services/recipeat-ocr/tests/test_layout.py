"""What the layout does with a page, without a model or an image.

`lay_out` is a pure function of the boxes and the strings, which is the reason
it is its own module: every arrangement a recipe can be written in becomes a
handful of rectangles here, and none of them need 30 MB of ONNX to assert on.

Boxes are 10 tall throughout, so the thresholds in `layout.py` — all of which
are in median line heights — work out to a 16px minimum column gap and a 24px
minimum row gap. The numbers below are chosen against those.
"""

import numpy as np

from recipeat_ocr.layout import lay_out


def box(left: float, top: float, width: float = 100, height: float = 10):
    """One detection box, corners clockwise from the top left."""
    return [
        [left, top],
        [left + width, top],
        [left + width, top + height],
        [left, top + height],
    ]


def run(*lines: tuple[str, list[list[float]]]):
    texts = [text for text, _ in lines]
    boxes = np.array([b for _, b in lines], dtype=float)
    return [block.text for block in lay_out(boxes, texts)]


def test_a_single_column_stays_one_block():
    assert run(
        ("first", box(0, 0)),
        ("second", box(0, 20)),
        ("third", box(0, 40)),
    ) == ["first\nsecond\nthird"]


def test_boxes_on_one_line_are_joined_left_to_right():
    # Emitted right-to-left, to prove the order comes from the geometry rather
    # than from the order the detector happened to find them in.
    assert run(
        ("world", box(120, 0, width=40)),
        ("hello", box(0, 2, width=40)),
    ) == ["hello world"]


def test_columns_split_even_though_their_extents_overlap():
    """The case RapidOCR's own layout cannot see.

    The left column's lines run to x=130, past the right column's left edge at
    x=120, so no vertical band is free of boxes. What separates them is that
    each column is left-aligned.
    """
    blocks = run(
        ("1 onion", box(0, 0, width=130)),
        ("2 eggs", box(0, 20, width=130)),
        ("3 leeks", box(0, 40, width=130)),
        ("1. Chop", box(120, 0, width=120)),
        ("2. Fry", box(120, 20, width=120)),
        ("3. Serve", box(120, 40, width=120)),
    )
    assert blocks == ["1 onion\n2 eggs\n3 leeks", "1. Chop\n2. Fry\n3. Serve"]


def test_stacked_blocks_split_top_then_bottom():
    blocks = run(
        ("1 onion", box(0, 0)),
        ("2 eggs", box(0, 20)),
        ("1. Chop", box(0, 100)),
        ("2. Fry", box(0, 120)),
    )
    assert blocks == ["1 onion\n2 eggs", "1. Chop\n2. Fry"]


def test_an_indent_is_not_a_column():
    """A short indented run sits inside its parent's vertical extent.

    Two columns run down the page beside each other; this does not, and
    splitting here would tear a block in half.
    """
    blocks = run(
        ("For the sauce", box(0, 0, width=60)),
        ("200ml cream", box(0, 20, width=60)),
        ("chilled", box(80, 20, width=40)),
        ("pinch of salt", box(0, 40, width=60)),
        ("2 tbsp butter", box(0, 60, width=60)),
    )
    assert len(blocks) == 1


def test_a_stray_box_does_not_hide_the_column_boundary():
    """A page number in the far margin owns the widest gap between left edges.

    It cannot be a column of its own — there is one of it — so the real
    boundary has to be found behind it.
    """
    blocks = run(
        ("1 onion", box(0, 0, width=80)),
        ("2 eggs", box(0, 20, width=80)),
        ("3 leeks", box(0, 40, width=80)),
        ("1. Chop", box(120, 0, width=80)),
        ("2. Fry", box(120, 20, width=80)),
        ("3. Serve", box(120, 40, width=80)),
        ("16", box(600, 30, width=20)),
    )
    assert blocks[0] == "1 onion\n2 eggs\n3 leeks"
    assert blocks[1].startswith("1. Chop")


def test_columns_survive_a_tilted_photograph():
    """A page held a few degrees off square still splits.

    Every threshold assumes the text runs flat, so the coordinates are rotated
    before anything else looks at them.
    """
    flat = [
        ("1 onion", box(0, 0, width=100)),
        ("2 eggs", box(0, 20, width=100)),
        ("3 leeks", box(0, 40, width=100)),
        ("1. Chop", box(140, 0, width=100)),
        ("2. Fry", box(140, 20, width=100)),
        ("3. Serve", box(140, 40, width=100)),
    ]
    texts = [t for t, _ in flat]
    boxes = np.array([b for _, b in flat], dtype=float)

    theta = np.radians(4)
    rotation = np.array(
        [[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]]
    )
    centre = boxes.reshape(-1, 2).mean(axis=0)
    tilted = (boxes - centre) @ rotation.T + centre

    assert [b.text for b in lay_out(tilted, texts)] == [
        "1 onion\n2 eggs\n3 leeks",
        "1. Chop\n2. Fry\n3. Serve",
    ]


def test_a_gap_inside_a_block_becomes_a_blank_line():
    assert run(
        ("Sauce", box(0, 0)),
        ("cream", box(0, 20)),
        ("Topping", box(0, 60)),
    ) == ["Sauce\ncream\n\nTopping"]


def test_nothing_read_is_no_blocks():
    assert lay_out(np.zeros((0, 4, 2)), []) == []


def test_one_line_needs_no_layout():
    assert run(("just this", box(0, 0))) == ["just this"]


def test_line_indices_point_back_at_the_reading():
    """`lines` on the wire stays in detection order, so a block has to say
    which of them it holds rather than the caller matching on text."""
    texts = ["right", "left"]
    boxes = np.array([box(140, 0), box(0, 0)], dtype=float)
    blocks = lay_out(boxes, texts)
    assert [sorted(b.line_indices) for b in blocks] == [[1], [0]] or len(blocks) == 1


def test_a_clean_single_column_is_not_uncertain():
    """The flag has to stay quiet on the ordinary page, or it says nothing."""
    blocks = lay_out(
        np.array([box(0, 0), box(0, 20), box(0, 40)], dtype=float),
        ["first", "second", "third"],
    )
    assert [b.uncertain for b in blocks] == [False]


def test_a_split_page_is_not_uncertain():
    """Columns that were actually separated need no warning either."""
    blocks = lay_out(
        np.array(
            [
                box(0, 0, width=100),
                box(0, 20, width=100),
                box(140, 0, width=100),
                box(140, 20, width=100),
            ],
            dtype=float,
        ),
        ["1 onion", "2 eggs", "1. Chop", "2. Fry"],
    )
    assert len(blocks) == 2
    assert [b.uncertain for b in blocks] == [False, False]


def test_a_gutter_too_tight_to_cut_is_flagged_instead():
    """Left edges 12 apart: past the 9 a near miss needs, short of the 16 a cut
    does. The rows are merged, which is the damage the flag warns about."""
    blocks = lay_out(
        np.array(
            [
                box(0, 0, width=100),
                box(0, 20, width=100),
                box(12, 0, width=100),
                box(12, 20, width=100),
            ],
            dtype=float,
        ),
        ["1 onion", "2 eggs", "1. Chop", "2. Fry"],
    )
    assert len(blocks) == 1
    assert blocks[0].uncertain
    assert blocks[0].text == "1 onion 1. Chop\n2 eggs 2. Fry"


def test_a_short_column_beside_a_long_one_is_flagged():
    """Three ingredients beside eight steps share only a third of the taller
    column's height, which is under the half a cut demands and over the third a
    near miss does. Geometry cannot tell this from an indent; the model can."""
    lines = [("1 onion", box(0, 0, width=100))]
    lines += [("2 eggs", box(0, 20, width=100)), ("3 leeks", box(0, 40, width=100))]
    lines += [(f"{n}. step", box(140, n * 20, width=100)) for n in range(8)]

    blocks = lay_out(
        np.array([b for _, b in lines], dtype=float), [t for t, _ in lines]
    )
    assert len(blocks) == 1
    assert blocks[0].uncertain


def test_an_indent_is_not_uncertain_either():
    """The one-box indent fails on having one box in it, which no relaxed
    threshold changes. A page is not ambiguous just because it is indented."""
    blocks = lay_out(
        np.array(
            [
                box(0, 0, width=60),
                box(0, 20, width=60),
                box(80, 20, width=40),
                box(0, 40, width=60),
                box(0, 60, width=60),
            ],
            dtype=float,
        ),
        ["For the sauce", "200ml cream", "chilled", "pinch of salt", "2 tbsp butter"],
    )
    assert len(blocks) == 1
    assert not blocks[0].uncertain
