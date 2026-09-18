"""Reading a parsed amount into the vocabulary Nuxt shares.

The rules these pin down are the ones that fail silently if they break: a unit
outside the shared vocabulary, or an upper limit on an amount that is not a
range, stops an ingredient matching the same amount written into a step, and
nothing raises.
"""

import json
from importlib.resources import files

import pytest
from ingredient_parser import parse_ingredient

from recipeat_fetcher.units import UNITS, VOCABULARY, read_amount


def read(line: str):
    parsed = parse_ingredient(line)
    return read_amount(parsed.amount[0]) if parsed.amount else None


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        # A pint unit maps to the vocabulary, and only ever to one entry in it.
        ("1 1/2 cups milk", (1.5, None, "cup")),
        ("200g plain flour", (200.0, None, "g")),
        ("8 fl oz water", (8.0, None, "fl_oz")),
        ("3 pounds beef", (3.0, None, "lb")),
        ("250 ml milk", (250.0, None, "ml")),
        # A range keeps its upper limit; nothing else grows one.
        ("2-3 tbsp olive oil", (2.0, 3.0, "tbsp")),
        ("1 teaspoon vanilla", (1.0, None, "tsp")),
        # No unit at all is a count, which is what the text parser calls it too.
        ("2 eggs", (2.0, None, "count")),
        ("1 onion, finely diced", (1.0, None, "count")),
        # Composites combine into the unit the line led with.
        ("1 lb 2 oz potatoes", (1.125, None, "lb")),
        # A unit pint knows but the vocabulary does not keeps its number and
        # reports no unit, rather than being guessed at.
        ("1 gallon water", (1.0, None, None)),
        # A unit outside pint's registry drops the amount, leaving the text
        # parser to try the same string.
        ("2 (28 ounce) cans tomatoes", None),
        ("2 sticks butter", None),
        # No number is no amount.
        ("a pinch of saffron", None),
        ("salt and pepper", None),
    ],
)
def test_amounts_read_into_the_shared_vocabulary(line, expected):
    assert read(line) == expected


def test_regional_sizes_are_never_resolved():
    """cup, tbsp, tsp and fl_oz stay ambiguous, as the text pipeline leaves them.

    A line cannot say whether it means US or metric, so resolving one here
    would invent a fact and break every comparison against a step's amount.
    """
    assert set(UNITS.values()).isdisjoint(
        {"cup_us", "cup_metric", "tbsp_us", "tbsp_metric", "tbsp_au", "tsp_us", "tsp_metric", "fl_oz_us", "fl_oz_imperial"}
    )


def test_vocabulary_is_the_map_plus_count():
    assert VOCABULARY == frozenset(UNITS.values()) | {"count"}


def test_unit_map_is_the_file_the_other_side_reads():
    """units.json is data, not code, because a test in Nuxt reads it as well."""
    on_disk = json.loads(files("recipeat_fetcher").joinpath("units.json").read_text(encoding="utf-8"))
    assert UNITS == on_disk
    assert all(isinstance(name, str) and isinstance(unit, str) for name, unit in on_disk.items())
