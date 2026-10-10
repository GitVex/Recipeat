"""POST /instagram.

instaloader is stubbed: whether it can read Instagram today is the live check
in docs/extraction.md, not something a test can promise. The media downloads
run against the loopback server, which stands in for Instagram's CDN.
"""

import base64

import pytest
from instaloader.exceptions import BadResponseException, ConnectionException

from recipeat_fetcher.app import app
from recipeat_fetcher.config import Settings, get_settings


class StubPost:
    def __init__(self, media, caption="Pancakes\n• 2 eggs", author="cook", video=False):
        self.typename = "GraphSidecar" if len(media) > 1 else "GraphVideo" if video else "GraphImage"
        self.is_video = video
        self.owner_username = author
        self.caption = caption
        self._media = media
        self.url = media[0]

    def get_sidecar_nodes(self):
        for url in self._media:
            yield type("Node", (), {"display_url": url})


@pytest.fixture
def post(monkeypatch):
    """Put a post, or an instaloader failure, behind any shortcode."""

    def install(result):
        def from_shortcode(context, shortcode):
            if isinstance(result, Exception):
                raise result
            return result

        monkeypatch.setattr("instaloader.Post.from_shortcode", from_shortcode)

    return install


@pytest.fixture
def loopback_cdn():
    """Let the loopback server count as Instagram's media host."""
    app.dependency_overrides[get_settings] = lambda: Settings(
        fetch_timeout=0.5, instagram_media_hosts=("127.0.0.1",), instagram_max_bytes=1_000_000,
        fetch_allow_private=True,
    )


def test_a_carousel_comes_back_as_caption_author_and_images_in_order(client, site, post, loopback_cdn):
    post(StubPost([site("/slide1.jpg"), site("/slide2.png")]))
    response = client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"})

    assert response.status_code == 200
    body = response.json()
    assert body["url"] == "https://www.instagram.com/p/DbXWEUaxWVd/"
    assert body["author"] == "cook"
    assert body["caption"] == "Pancakes\n• 2 eggs"
    assert [(i["mimeType"], base64.b64decode(i["data"])) for i in body["images"]] == [
        ("image/jpeg", b"jpeg-first"),
        ("image/png", b"png-second"),
    ]


def test_a_preview_reads_the_caption_and_downloads_nothing(client, post):
    # The client fixture's settings refuse loopback media, so a download would 502.
    post(StubPost(["http://127.0.0.1:1/cover.jpg"], video=True))
    response = client.post("/instagram", json={"shortcode": "DbXWEUaxWVd", "preview": True})

    assert response.status_code == 200
    body = response.json()
    assert (body["caption"], body["images"], body["video"]) == ("Pancakes\n• 2 eggs", [], True)


@pytest.mark.parametrize("shortcode", ["../../etc", "a b c d e", "http://x", ""])
def test_only_a_shortcode_is_accepted(client, shortcode):
    assert client.post("/instagram", json={"shortcode": shortcode}).status_code == 422


def test_media_on_any_other_host_is_not_fetched(client, site, post):
    # The client fixture's settings: Instagram's hosts only, not loopback.
    post(StubPost([site("/slide1.jpg")]))
    response = client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"})
    assert response.status_code == 502
    assert "host" in response.json()["detail"]


def test_an_allowed_media_host_that_resolves_inward_is_refused(client, site, post, monkeypatch):
    # On the allowlist, but the name resolves to a private address: the guard
    # under the allowlist refuses it.
    import socket
    real = socket.getaddrinfo
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port))] if host == "scontent.cdninstagram.com" else real(host, port, *a, **k))
    app.dependency_overrides[get_settings] = lambda: Settings(fetch_timeout=0.5)
    post(StubPost(["https://scontent.cdninstagram.com/v/slide.jpg"]))
    response = client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"})
    assert response.status_code == 502
    assert "host" in response.json()["detail"]


def test_a_redirect_from_the_media_host_is_not_followed(client, site, post, loopback_cdn):
    post(StubPost([site("/moved")]))
    assert client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"}).status_code == 502


def test_images_past_the_byte_limit_are_refused(client, site, post, loopback_cdn):
    post(StubPost([site("/big.jpg")]))
    assert client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"}).status_code == 413


def test_a_missing_or_private_post_is_a_422(client, post):
    post(BadResponseException("Fetching Post metadata failed."))
    response = client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"})
    assert response.status_code == 422
    assert "private or deleted" in response.json()["detail"]


def test_being_throttled_is_a_503(client, post):
    post(ConnectionException('401 Unauthorized - "fail" status, message "Please wait a few minutes before you try again."'))
    assert client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"}).status_code == 503


def test_any_other_instagram_failure_is_a_502(client, post):
    post(ConnectionException("something else"))
    assert client.post("/instagram", json={"shortcode": "DbXWEUaxWVd"}).status_code == 502
