"""The wire contract.

Field names are camelCase on the wire because there is exactly one consumer and
it is TypeScript. An ingredient deliberately mirrors the draft shape the model
produces in `server/extraction/ollama.ts`: `quantity` is the amount *as
written*, so the Nuxt side reads both sources through one code path, and the
numbers this service could read sit beside it under `parsedQuantity`.

Nothing here is passed through from a library. `recipe-scrapers` returns
whatever getters a given site's scraper happens to implement, so narrowing to
these models is what makes the response stable across an upgrade.
"""

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator
from pydantic.alias_generators import to_camel

from .units import VOCABULARY

MAX_INGREDIENTS = 200


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Quantity(Wire):
    """An amount read into numbers. Mirrors `Quantity` in `recipe.ts`."""

    value: float
    # Set only for a range ("2-3 tbsp"). Null otherwise, including where the
    # parser reports an upper limit equal to the value: a quantity that looks
    # like a range would never compare equal to the same amount found in a step.
    max_value: float | None = None
    # Null where the wording is unrecognised, never guessed at.
    unit: str | None = None

    @field_validator("unit")
    @classmethod
    def known_unit(cls, unit: str | None) -> str | None:
        if unit is not None and unit not in VOCABULARY:
            raise ValueError(f"{unit!r} is outside the shared unit vocabulary")
        return unit


class Ingredient(Wire):
    original_text: str
    name: str | None = None
    # The amount as written, under the same key the model uses for it.
    quantity: str | None = None
    # The same amount read into numbers, or null when it could not be. The Nuxt
    # side falls back to parsing `quantity` itself, which is also what happens
    # for every ingredient the model extracted.
    parsed_quantity: Quantity | None = None
    # What is left of the line once the amount and the name are out: how the
    # ingredient is prepared, an aside, what it is for. One field because the
    # three read as one phrase and no consumer needs to tell them apart.
    extra: str | None = None


class Recipe(Wire):
    title: str | None = None
    language: str | None = None
    # As written — "4 servings", "1 loaf". The portion count is read out of it
    # on the Nuxt side, where the recipe shape is owned.
    yields: str | None = None
    image: str | None = None
    total_time: int | None = None
    site_name: str | None = None
    author: str | None = None
    # The page's own canonical URL where it declares one, else the URL asked
    # for. This is the better key to store and to dedupe on.
    canonical_url: str
    ingredients: list[Ingredient]
    steps: list[str]


class FetchRequest(Wire):
    url: HttpUrl


class IngredientsRequest(Wire):
    ingredients: list[str] = Field(
        max_length=MAX_INGREDIENTS,
        description="Ingredient lines to parse, one per entry.",
    )
