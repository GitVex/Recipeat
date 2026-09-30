"""The SSRF guard (#117).

Nothing here reaches the internet. Names are resolved by a fake that knows a
handful of `.example` hosts and passes IP literals through; the one real server
is the loopback one, which a test "pretends public" when it needs a host the
guard will let through.
"""

import socket

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from recipeat_fetcher import guard
from recipeat_fetcher.app import app
from recipeat_fetcher.config import Settings, get_settings
from recipeat_fetcher.page import fetch_page

GUARDED = Settings(fetch_timeout=0.5, fetch_max_bytes=1_000_000, fetch_max_redirects=2)
real_getaddrinfo = socket.getaddrinfo


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1", "::1",                      # loopback
        "10.0.0.5", "172.16.0.1", "192.168.1.1",  # private
        "169.254.169.254", "fe80::1",            # link-local, cloud metadata
        "100.64.0.1",                            # carrier-grade NAT
        "0.0.0.0", "::",                         # unspecified
        "224.0.0.1", "ff02::1",                  # multicast
        "240.0.0.1", "255.255.255.255",          # reserved, broadcast
        "fc00::1",                               # IPv6 unique-local
        "::ffff:127.0.0.1", "::ffff:10.0.0.5",   # IPv4-mapped
        "2002:7f00:1::",                         # 6to4 around 127.0.0.1
    ],
)
def test_internal_addresses_are_not_public(address):
    assert not guard.is_public(address)


@pytest.mark.parametrize("address", ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"])
def test_public_addresses_are(address):
    assert guard.is_public(address)


@pytest.fixture
def dns(monkeypatch):
    """Resolve the given names to the given addresses, and count lookups."""
    lookups: dict[str, int] = {}

    def install(names: dict[str, list[str] | list[list[str]]]):
        def getaddrinfo(host, port, *args, **kwargs):
            if host not in names:
                return real_getaddrinfo(host, port, *args, **kwargs)
            lookups[host] = lookups.get(host, 0) + 1
            answer = names[host]
            # A list of lists is one answer per lookup: a rebinding server.
            if answer and isinstance(answer[0], list):
                answer = answer[min(lookups[host], len(answer)) - 1]
            return [
                (socket.AF_INET6 if ":" in a else socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port))
                for a in answer
            ]

        monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
        return lookups

    return install


@pytest.fixture
def loopback_is_public(monkeypatch, site):
    """Let the loopback server through, as if it were a public host on a web port."""
    port = int(site("/").rsplit(":", 1)[1].split("/")[0])
    is_public = guard.is_public
    monkeypatch.setattr(guard, "is_public", lambda a: a == "127.0.0.1" or is_public(a))
    monkeypatch.setattr(guard, "PORTS", frozenset({80, 443, port}))
    return port


def refusal(url: str) -> str:
    with pytest.raises(HTTPException) as caught:
        fetch_page(url, GUARDED)
    assert caught.value.status_code == 422
    return caught.value.detail


def test_a_loopback_url_is_refused(site):
    assert "not a public address" in refusal(site("/recipe"))


def test_a_name_that_resolves_inward_is_refused_without_naming_the_address(dns):
    dns({"recipes.example": ["10.0.0.5"]})
    detail = refusal("http://recipes.example/pancakes")
    assert "recipes.example" in detail
    assert "10.0.0.5" not in detail


def test_one_private_address_among_public_ones_is_enough_to_refuse(dns):
    dns({"mixed.example": ["93.184.215.14", "10.0.0.5"]})
    refusal("http://mixed.example/")


@pytest.mark.parametrize("url", ["http://93.184.215.14:8080/", "http://93.184.215.14:22/", "https://93.184.215.14:8443/"])
def test_only_web_ports_are_reached(url):
    refusal(url)


def test_a_redirect_inward_is_refused_at_the_hop(site, dns, loopback_is_public):
    dns({"internal.example": ["10.0.0.5"]})
    assert "internal.example" in refusal(site("/to-internal"))


def test_the_connection_goes_to_the_address_that_was_checked(site, dns, loopback_is_public):
    # A rebinding server: public for the first lookup, private after. With a
    # second lookup between check and connect, this would reach 10.0.0.5.
    lookups = dns({"rebind.example": [["127.0.0.1"], ["10.0.0.5"]]})
    html, _ = fetch_page(f"http://rebind.example:{loopback_is_public}/recipe", GUARDED)
    assert "Pancakes" in html
    assert lookups == {"rebind.example": 1}


def test_a_public_host_is_fetched_normally(site, loopback_is_public):
    html, final_url = fetch_page(site("/moved"), GUARDED)
    assert "Pancakes" in html
    assert final_url == site("/recipe")


def test_the_endpoint_answers_a_refusal_as_the_callers_mistake(site):
    app.dependency_overrides[get_settings] = lambda: GUARDED
    try:
        with TestClient(app) as client:
            response = client.post("/fetch", json={"url": site("/recipe")})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422
    assert "not a public address" in response.json()["detail"]


def test_the_guard_is_on_by_default():
    assert Settings().fetch_allow_private is False
