"""Fetching a page.

These are the three things `scrape_me` does not do — bound the wait, bound the
read, and survive an encoding that is not UTF-8 — plus the redirect handling
that decides which URL a recipe is finally attributed to.
"""

import pytest
from fastapi import HTTPException

from recipeat_fetcher.config import Settings
from recipeat_fetcher.page import fetch_page

SETTINGS = Settings(fetch_timeout=0.5, fetch_max_bytes=1_000_000, fetch_max_redirects=2)


def status_of(url: str) -> int:
    with pytest.raises(HTTPException) as caught:
        fetch_page(url, SETTINGS)
    return caught.value.status_code


def test_a_page_comes_back_with_the_url_it_was_served_from(site):
    html, final_url = fetch_page(site("/recipe"), SETTINGS)
    assert "Pancakes" in html
    assert final_url == site("/recipe")


def test_a_redirect_is_followed_and_reported(site):
    """The URL after redirects is the better base for a page's canonical link."""
    html, final_url = fetch_page(site("/moved"), SETTINGS)
    assert "Pancakes" in html
    assert final_url == site("/recipe")


def test_a_declared_encoding_is_honoured(site):
    html, _ = fetch_page(site("/latin"), SETTINGS)
    assert "Grüße" in html


def test_an_undeclared_encoding_costs_glyphs_not_the_recipe(site):
    """scrape_me's strict UTF-8 decode raised here; a replacement character is
    a far smaller loss than the whole page."""
    html, _ = fetch_page(site("/no-charset"), SETTINGS)
    assert "aus der K" in html


def test_a_missing_content_type_is_allowed(site):
    html, _ = fetch_page(site("/no-type"), SETTINGS)
    assert "Pancakes" in html


def test_something_that_is_not_a_page_is_refused(site):
    assert status_of(site("/pdf")) == 415


def test_an_oversized_body_is_refused_while_reading(site):
    """Counted as it arrives, so a server understating Content-Length gains
    nothing by it."""
    assert status_of(site("/big")) == 413


def test_a_server_that_does_not_answer_times_out(site):
    assert status_of(site("/slow")) == 504


def test_a_redirect_loop_ends(site):
    assert status_of(site("/loop")) == 502


def test_an_error_from_the_site_is_reported_as_one(site):
    assert status_of(site("/missing")) == 502


def test_an_unreachable_host_fails_fast_rather_than_hanging():
    """Whether a closed port is refused or silently dropped is the platform's
    business. Either way it must land on a status the caller can act on."""
    assert status_of("http://127.0.0.1:1/nope") in {502, 504}
