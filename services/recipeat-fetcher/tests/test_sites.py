"""Saved pages from sites with a scraper of their own.

The parse is the installed library's, so an upgrade that breaks it fails here
rather than on a cook's import. Each page is trimmed to what its scraper reads.
"""

from pathlib import Path

import pytest
from recipe_scrapers import scrape_html

from recipeat_fetcher.routers.fetch import strip_emphasis

PAGES = Path(__file__).parent / "pages"


def test_a_picnic_recipe_parses():
    """Saved from a share link, https://picnic.app/de/go/inv8wwj (#188)."""
    html = (PAGES / "picnic.html").read_text(encoding="utf-8")
    scraper = scrape_html(
        html, org_url="https://picnic.app/de/rezepte/6718ba91a5bf6b2f389e9115", supported_only=False
    )

    assert scraper.title() == "Tomatenreis mit Hühnchen-Souvlaki"
    assert "4 Zehen Knoblauch" in scraper.ingredients()
    steps = scraper.instructions_list()
    assert len(steps) > 1
    assert steps[0].startswith("Mit dem Marinieren des Hähnchens beginnen.")


def test_a_picnic_step_loses_its_bold_and_keeps_its_words():
    """Picnic bolds every quantity (#215)."""
    html = (PAGES / "picnic.html").read_text(encoding="utf-8")
    scraper = scrape_html(
        html, org_url="https://picnic.app/de/rezepte/6718ba91a5bf6b2f389e9115", supported_only=False
    )
    step = strip_emphasis(scraper.instructions_list()[0])

    assert "*" not in step
    assert "Hierfür 1 Zitrone pressen und 4 Knoblauchzehen zerdrücken" in step
    assert step.endswith("mind. 15 Min. marinieren lassen.")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("**1 Zitrone** pressen", "1 Zitrone pressen"),
        ("__200 g__ Mehl", "200 g Mehl"),
        ("Bake *until golden*.", "Bake until golden."),
        ("**Salz** und **Pfeffer**", "Salz und Pfeffer"),
        # Unpaired, or not emphasis: left as they are.
        ("5 * 2 * 3 Eier", "5 * 2 * 3 Eier"),
        ("Salz* nach Geschmack", "Salz* nach Geschmack"),
        ("Salz* und Pfeffer*", "Salz* und Pfeffer*"),
        ("snake_case__name__x", "snake_case__name__x"),
    ],
)
def test_only_paired_emphasis_is_stripped(text, expected):
    assert strip_emphasis(text) == expected
