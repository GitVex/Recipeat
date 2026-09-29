from fastapi import APIRouter
from pydantic import BaseModel
from recipe_scrapers import SCRAPERS

router = APIRouter(tags=["sites"])


class Sites(BaseModel):
    hosts: list[str]


@router.get("/sites")
def sites() -> Sites:
    """The hosts with a scraper of their own, as the installed library has them.

    Read from `SCRAPERS` rather than kept by hand, so an upgrade that adds a
    site adds it here. The keys are what `scrape_html` matches a page's host
    against once a leading `www.` is gone; any other host falls back to the
    page's schema.org markup.
    """
    return Sites(hosts=sorted(SCRAPERS))
