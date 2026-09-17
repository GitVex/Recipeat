"""The two endpoints.

Whether recipe-scrapers can read a real page is its own business and its own
test suite; what belongs here is the mapping on top of it — which fields are
forwarded, what happens when a getter is not implemented, and how the caller's
own mistakes come back.
"""

import pytest

from recipeat_fetcher.models import MAX_INGREDIENTS

MISSING = object()


class StubScraper:
    """A scraper whose getters are whatever a test says they are.

    Every getter exists — `to_json` reflects over them, so the real ones always
    do — but calling one may fail on a page that omits the field, which is the
    case `_optional` is there for.
    """

    def __init__(self, **fields):
        self._fields = fields

    def __getattr__(self, name):
        value = self._fields.get(name, MISSING)

        def getter():
            if value is MISSING:
                raise NotImplementedError(name)
            if isinstance(value, Exception):
                raise value
            return value

        return getter


@pytest.fixture
def scraped(monkeypatch):
    """Put a stub behind /fetch, and report the URL it was handed."""

    def install(**fields):
        seen = {}

        def scrape_html(html, org_url, **kwargs):
            seen["html"] = html
            seen["org_url"] = org_url
            return StubScraper(**fields)

        monkeypatch.setattr("recipeat_fetcher.routers.fetch.scrape_html", scrape_html)
        return seen

    return install


def test_a_scraped_page_maps_onto_the_contract(client, site, scraped):
    scraped(
        title="Pancakes",
        language="en",
        yields="4 servings",
        image="https://img.example/p.jpg",
        total_time=45,
        site_name="Example Kitchen",
        author="A Cook",
        canonical_url="https://example.com/pancakes",
        ingredients=["1 1/2 cups milk", "2 eggs"],
        instructions_list=["Whisk.", "Fry."],
    )
    body = client.post("/fetch", json={"url": site("/recipe")}).json()

    assert body["title"] == "Pancakes"
    assert body["yields"] == "4 servings"
    assert body["totalTime"] == 45
    assert body["siteName"] == "Example Kitchen"
    assert body["canonicalUrl"] == "https://example.com/pancakes"
    assert body["steps"] == ["Whisk.", "Fry."]
    assert body["ingredients"][0]["parsedQuantity"] == {"value": 1.5, "maxValue": None, "unit": "cup"}
    assert body["ingredients"][1]["parsedQuantity"]["unit"] == "count"
    # Nothing the libraries return leaks through unasked.
    assert set(body) == {
        "title", "language", "yields", "image", "totalTime",
        "siteName", "author", "canonicalUrl", "ingredients", "steps",
    }


def test_a_getter_a_site_does_not_implement_becomes_null(client, site, scraped):
    scraped(ingredients=["salt"], instructions_list=["Season."], title=KeyError("no title"))
    body = client.post("/fetch", json={"url": site("/recipe")}).json()

    assert body["title"] is None
    assert body["author"] is None
    assert body["image"] is None
    assert body["steps"] == ["Season."]


def test_a_page_with_no_canonical_link_is_attributed_to_where_it_was_served(client, site, scraped):
    seen = scraped(ingredients=[], instructions_list=[])
    body = client.post("/fetch", json={"url": site("/moved")}).json()

    # The redirect resolved first, so both the scraper and the response see the
    # page's real address rather than the one that pointed at it.
    assert body["canonicalUrl"] == site("/recipe")
    assert seen["org_url"] == site("/recipe")
    assert "Pancakes" in seen["html"]


def test_more_ingredients_than_the_cap_are_not_parsed(client, site, scraped):
    scraped(ingredients=["salt"] * (MAX_INGREDIENTS + 20), instructions_list=[])
    body = client.post("/fetch", json={"url": site("/recipe")}).json()
    assert len(body["ingredients"]) == MAX_INGREDIENTS


def test_a_site_without_a_scraper_says_so(client, site):
    """The real dispatch: loopback is not a recipe site, and the fetch has
    already happened by the time anyone knows that."""
    response = client.post("/fetch", json={"url": site("/recipe")})
    assert response.status_code == 422
    assert "127.0.0.1" in response.json()["detail"]


@pytest.mark.parametrize("url", ["not-a-url", "ftp://example.com/r", "", None])
def test_a_url_that_is_not_one_is_refused(client, url):
    assert client.post("/fetch", json={"url": url}).status_code == 422


def test_ingredient_lines_keep_the_wording_they_arrived_with(client):
    lines = ["1 cup parsley, chopped, for garnish", "200ml cream", "salt, to taste"]
    body = client.post("/ingredients", json={"ingredients": lines}).json()

    # Not parsed.sentence, which is normalised: nothing may be lost to a parser
    # that will get better later.
    assert [item["originalText"] for item in body] == lines
    assert body[0]["name"] == "parsley"
    assert body[0]["extra"] == "chopped, for garnish"
    assert body[1]["parsedQuantity"] == {"value": 200.0, "maxValue": None, "unit": "ml"}
    assert body[2]["quantity"] is None
    assert body[2]["extra"] == "to taste"


def test_more_lines_than_the_cap_are_refused(client):
    """Parsing holds a worker for the whole request, so the cap is a limit on
    the request rather than something quietly sliced."""
    over = client.post("/ingredients", json={"ingredients": ["salt"] * (MAX_INGREDIENTS + 1)})
    assert over.status_code == 422
    assert client.post("/ingredients", json={"ingredients": []}).json() == []


def test_health_answers(client):
    assert client.get("/health").json() == {"status": "ok"}
