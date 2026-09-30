"""Fetching a recipe page.

`scrape_me` does its own HTTP, and all of it in one line: it downloads before it
decides whether a scraper exists for the host, with no timeout, no limit on how
much it will read, and a hard `.decode("utf-8")` that fails outright on a page
served in any other encoding. Fetching here and handing the HTML to
`scrape_html` puts those three under our control.

The client comes from `guard.py`, so every connection this makes, redirects
included, goes to a public address on port 80 or 443 (#117).
"""

import httpx
from fastapi import HTTPException
from recipe_scrapers import HEADERS

from .config import Settings
from .guard import BlockedAddress, guarded_client

HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})


def fetch_page(url: str, settings: Settings) -> tuple[str, str]:
    """Return a page's HTML and the URL it was finally served from.

    The final URL matters because it is what redirects resolved to, which is a
    better base for the page's canonical link than the URL that was asked for.
    """
    host = httpx.URL(url).host
    try:
        with guarded_client(
            settings.fetch_allow_private,
            timeout=settings.fetch_timeout,
            follow_redirects=True,
            max_redirects=settings.fetch_max_redirects,
            headers=HEADERS,
        ) as client:
            with client.stream("GET", url) as response:
                if response.status_code >= 400:
                    raise HTTPException(
                        status_code=502,
                        detail=f"{host} answered {response.status_code}.",
                    )

                # Parameters after ";" are the charset, which is read below.
                content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if content_type and content_type not in HTML_TYPES:
                    raise HTTPException(
                        status_code=415,
                        detail=f"{host} served {content_type}, not a web page.",
                    )

                # Counted while reading rather than trusted from Content-Length,
                # which a server is free to understate or omit.
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > settings.fetch_max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail="That page is too large to read.",
                        )

            # Only the header's charset is known here; a page that declares its
            # encoding in a meta tag alone is decoded as UTF-8. Either way the
            # replacement character costs a few glyphs, where a strict decode
            # would cost the whole recipe.
            encoding = response.charset_encoding or "utf-8"
            return bytes(body).decode(encoding, errors="replace"), str(response.url)

    except BlockedAddress as error:
        # The host, which may be a redirect's rather than the one asked for,
        # and never the address it resolved to.
        raise HTTPException(
            status_code=422,
            detail=f"{error.host} is not a public address, so it can't be read.",
        ) from error
    except httpx.TooManyRedirects as error:
        raise HTTPException(status_code=502, detail=f"{host} redirected too many times.") from error
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail=f"{host} did not answer in time.") from error
    except httpx.RequestError as error:
        raise HTTPException(status_code=502, detail=f"Could not reach {host}.") from error
