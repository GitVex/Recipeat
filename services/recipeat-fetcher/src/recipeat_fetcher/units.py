"""The unit vocabulary shared with the Nuxt side.

`units.json` maps pint's canonical unit names onto the `Unit` union in
`server/extraction/recipe.ts`. It is a data file rather than a dict in here
because a test on the TypeScript side reads it to prove the two agree: where
they drift, nothing throws — `normalizeRecipe` simply stops linking a step's
amount to the ingredient it restates.

Two rules keep the parsers comparable:

* Only units `parseQuantity` can also produce. Regional cup and spoon sizes are
  never resolved here, so `cup`, `tbsp`, `tsp` and `fl_oz` stay ambiguous and
  are settled at display time, exactly as the text pipeline leaves them.
* An unrecognised unit is reported as no unit, never guessed at.
"""

import json
from fractions import Fraction
from importlib.resources import files

import pint
from ingredient_parser.dataclasses import CompositeIngredientAmount, IngredientAmount

Amount = IngredientAmount | CompositeIngredientAmount

UNITS: dict[str, str] = json.loads(
    files(__package__).joinpath("units.json").read_text(encoding="utf-8")
)

# "count" is not a pint unit: it is what an amount with no unit at all means.
VOCABULARY: frozenset[str] = frozenset(UNITS.values()) | {"count"}


def _unit_of(unit: str | pint.Unit) -> str | None:
    return UNITS.get(str(unit))


def _simple(amount: IngredientAmount) -> tuple[float, float | None, str | None] | None:
    # A quantity the parser could not read as a number ("a pinch of saffron")
    # is no quantity at all, which is what parseQuantity says about it too.
    if not isinstance(amount.quantity, Fraction):
        return None

    if isinstance(amount.unit, pint.Unit):
        unit = _unit_of(amount.unit)
    elif amount.unit == "":
        # The parser positively found no unit, which is what a count is.
        unit = "count"
    else:
        # A unit outside pint's registry — "cans", "sticks", "cm pieces". The
        # parser cannot place it, so the whole amount is dropped and the text
        # parser gets its turn at the same string.
        return None

    maximum = (
        float(amount.quantity_max)
        if amount.RANGE and isinstance(amount.quantity_max, Fraction)
        else None
    )
    return float(amount.quantity), maximum, unit


def _composite(amount: CompositeIngredientAmount) -> tuple[float, None, str | None] | None:
    # "1 lb 2 oz" and "1 cup plus 1 tablespoon" combine into the unit the
    # source led with, so the number stays recognisable against the line.
    try:
        combined = amount.combined()
    except (TypeError, pint.DimensionalityError):
        return None
    return float(combined.magnitude), None, _unit_of(combined.units)


def read_amount(amount: Amount) -> tuple[float, float | None, str | None] | None:
    """Read one parsed amount into a value, an optional range end, and a unit.

    Returns None when the amount carries no usable number, leaving the caller
    to fall back to the amount's text.
    """
    if isinstance(amount, CompositeIngredientAmount):
        return _composite(amount)
    return _simple(amount)
