"""Saved pages from sites with a scraper of their own.

The parse is the installed library's, so an upgrade that breaks it fails here
rather than on a cook's import. Each page is trimmed to what its scraper reads.
"""

from pathlib import Path

from recipe_scrapers import scrape_html

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
