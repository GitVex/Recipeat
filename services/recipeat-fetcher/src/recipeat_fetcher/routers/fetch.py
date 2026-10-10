import re
from typing import Annotated, Callable, TypeVar

from fastapi import APIRouter, Depends, HTTPException
from ingredient_parser import parse_multiple_ingredients
from ingredient_parser.dataclasses import ParsedIngredient
from recipe_scrapers import NoSchemaFoundInWildMode, RecipeSchemaNotFound, scrape_html

from ..config import Settings, get_settings
from ..models import (
    MAX_INGREDIENTS,
    FetchRequest,
    Ingredient,
    IngredientsRequest,
    Quantity,
    Recipe,
)
from ..page import fetch_page
from ..units import read_amount

router = APIRouter(tags=["fetch"])

T = TypeVar("T")


def _optional(getter: Callable[[], T]) -> T | None:
    """Read one scraper field, or None.

    Every getter is a site-specific parser that may be unimplemented or may
    fail on a page that does not carry the field, which is how `to_json`
    treats them too.
    """
    try:
        return getter()
    except Exception:
        return None


# Markdown emphasis some sites write their steps in: Picnic bolds every
# quantity (#215). A pair only, opening on a word and closing on one, so the
# lone `*` of "5 * 2" or a footnote mark stays. scripts/strip-step-emphasis.ts
# applies the same three to steps already stored.
_EMPHASIS = [
    re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*"),
    re.compile(r"(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)"),
    re.compile(r"(?<![*\w])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?![*\w])"),
]


def strip_emphasis(text: str) -> str:
    for pattern in _EMPHASIS:
        text = pattern.sub(r"\1", text)
    return text


def _extra(parsed: ParsedIngredient) -> str | None:
    """Preparation, comment and purpose, joined as the line reads them.

    They appear in that order in a sentence — "chopped, for garnish" — so
    joining them in it reconstructs the phrase rather than inventing one.
    """
    parts = [
        item.text.strip()
        for item in (parsed.preparation, parsed.comment, parsed.purpose)
        if item is not None and item.text.strip()
    ]
    return ", ".join(parts) or None


def _ingredient(line: str, parsed: ParsedIngredient) -> Ingredient:
    amount = parsed.amount[0] if parsed.amount else None
    read = read_amount(amount) if amount is not None else None

    return Ingredient(
        # The line as it was given, not `parsed.sentence`, which is normalised.
        # Nothing may be lost to a parser that will get better later.
        original_text=line,
        # More than one name appears for "salt and pepper"; the first is the
        # one a step is most likely to mention, and the line keeps the rest.
        name=parsed.name[0].text if parsed.name else None,
        quantity=amount.text if amount is not None else None,
        parsed_quantity=Quantity(value=read[0], max_value=read[1], unit=read[2])
        if read
        else None,
        extra=_extra(parsed),
    )


def _parse(lines: list[str]) -> list[Ingredient]:
    if not lines:
        return []
    # string_units and imperial_units stay off: pint units are what `units.py`
    # maps, and resolving a cup regionally is a display decision made later.
    parsed = parse_multiple_ingredients(lines)
    return [_ingredient(line, item) for line, item in zip(lines, parsed)]


@router.post("/fetch")
def fetch(
    request: FetchRequest, settings: Annotated[Settings, Depends(get_settings)]
) -> Recipe:
    html, final_url = fetch_page(str(request.url), settings)

    try:
        # A host with no scraper of its own falls back to the page's schema.org
        # Recipe markup. Passed explicitly, because the library's default is to
        # refuse such a host, and a default can change under an upgrade. With
        # the fallback on, no host is refused for being unknown, so
        # WebsiteNotImplementedError cannot be raised here.
        scraper = scrape_html(html, org_url=final_url, supported_only=False)
    except (NoSchemaFoundInWildMode, RecipeSchemaNotFound) as error:
        raise HTTPException(
            status_code=422,
            detail="That page does not contain a recipe.",
        ) from error

    lines = _optional(scraper.ingredients) or []
    return Recipe(
        title=_optional(scraper.title),
        language=_optional(scraper.language),
        yields=_optional(scraper.yields),
        image=_optional(scraper.image),
        total_time=_optional(scraper.total_time),
        site_name=_optional(scraper.site_name),
        author=_optional(scraper.author),
        canonical_url=_optional(scraper.canonical_url) or final_url,
        ingredients=_parse(lines[:MAX_INGREDIENTS]),
        steps=[strip_emphasis(step) for step in _optional(scraper.instructions_list) or []],
    )


@router.post("/ingredients")
def parse_ingredients(request: IngredientsRequest) -> list[Ingredient]:
    return _parse(request.ingredients)
