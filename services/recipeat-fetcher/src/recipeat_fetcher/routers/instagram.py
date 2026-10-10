"""Reading one Instagram post, logged out (#111, docs/extraction.md → Instagram).

A post carries no recipe markup, so nothing is parsed here: the caption and the
post's images go back to the app, which hands both to the model. The images are
downloaded here rather than passed on as URLs, so everything that talks to
Instagram is in one place and the app never fetches an address a post named.

The request is a shortcode, not a URL. There is nothing to point elsewhere:
the post is looked up through instaloader, and its media are fetched only from
the hosts in `instagram_media_hosts`, without following redirects.
"""

import base64
from typing import Annotated

import httpx
import instaloader
import requests
from fastapi import APIRouter, Depends, HTTPException
from instaloader.exceptions import (
    BadResponseException,
    ConnectionException,
    InstaloaderException,
    LoginRequiredException,
    QueryReturnedNotFoundException,
    TooManyRequestsException,
)

from ..config import Settings, get_settings
from ..guard import BlockedAddress, guarded_client
from ..models import InstagramImage, InstagramPost, InstagramRequest

router = APIRouter(tags=["instagram"])

# Instagram's own ceiling on a carousel.
MAX_IMAGES = 20

GONE = "That post could not be found. It may be private or deleted."
REFUSED = "Instagram is not answering requests from us right now; try again later."


def _read_post(shortcode: str, settings: Settings) -> tuple[str, str | None, list[str], bool]:
    """The post's author, caption, media URLs (a video's cover, not the video)
    and whether it is a video."""
    loader = instaloader.Instaloader(
        quiet=True,
        # One attempt: on a 429 instaloader otherwise sleeps until the limit
        # lifts, which can be minutes, with a browser waiting on the other end.
        max_connection_attempts=1,
        request_timeout=settings.fetch_timeout,
    )
    try:
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        # All read here so a failure lands in the mapping below: they are lazy,
        # and a carousel with a video in it may query again.
        nodes = list(post.get_sidecar_nodes()) if post.typename == "GraphSidecar" else []
        media = [node.display_url for node in nodes] or [post.url]
        return post.owner_username, post.caption, media, post.is_video
    except (QueryReturnedNotFoundException, BadResponseException, LoginRequiredException) as error:
        # Logged out, a private post and a deleted one look the same: no items.
        raise HTTPException(status_code=422, detail=GONE) from error
    except ConnectionException as error:
        cause = error.__cause__
        if isinstance(cause, requests.exceptions.Timeout):
            raise HTTPException(status_code=504, detail="Instagram did not answer in time.") from error
        # A 429, or the 401 "Please wait a few minutes" it sends logged-out
        # clients instead. Either way the answer is later, not never.
        if isinstance(cause, TooManyRequestsException) or "wait a few minutes" in str(error):
            raise HTTPException(status_code=503, detail=REFUSED) from error
        raise HTTPException(status_code=502, detail="Could not read that post from Instagram.") from error
    except InstaloaderException as error:
        raise HTTPException(status_code=502, detail="Could not read that post from Instagram.") from error


def _allowed(url: httpx.URL, settings: Settings) -> bool:
    host = url.host
    return url.scheme in ("http", "https") and any(
        host == allowed or host.endswith("." + allowed) for allowed in settings.instagram_media_hosts
    )


def _download(urls: list[str], settings: Settings) -> list[InstagramImage]:
    images: list[InstagramImage] = []
    total = 0
    # Guarded under the allowlist: a CDN name that resolved inward is refused
    # too (#117).
    with guarded_client(settings.fetch_allow_private, timeout=settings.fetch_timeout, follow_redirects=False) as client:
        for raw in urls[:MAX_IMAGES]:
            url = httpx.URL(raw)
            # The post names these, so they are as untrusted as the rest of it.
            if not _allowed(url, settings):
                raise HTTPException(status_code=502, detail="That post named media on a host we do not read from.")
            try:
                with client.stream("GET", url) as response:
                    if response.status_code != 200:
                        raise HTTPException(status_code=502, detail=f"Instagram's media host answered {response.status_code}.")
                    mime_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if not mime_type.startswith("image/"):
                        raise HTTPException(status_code=502, detail="Instagram's media host did not serve an image.")
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        total += len(chunk)
                        if total > settings.instagram_max_bytes:
                            raise HTTPException(status_code=413, detail="That post's images are too large to read.")
            except BlockedAddress as error:
                raise HTTPException(status_code=502, detail="That post named media on a host we do not read from.") from error
            except httpx.TimeoutException as error:
                raise HTTPException(status_code=504, detail="Instagram's media host did not answer in time.") from error
            except httpx.RequestError as error:
                raise HTTPException(status_code=502, detail="Could not reach Instagram's media host.") from error
            images.append(InstagramImage(mime_type=mime_type, data=base64.b64encode(body).decode("ascii")))
    return images


@router.post("/instagram")
def instagram(
    request: InstagramRequest, settings: Annotated[Settings, Depends(get_settings)]
) -> InstagramPost:
    author, caption, media, video = _read_post(request.shortcode, settings)
    return InstagramPost(
        url=f"https://www.instagram.com/p/{request.shortcode}/",
        author=author,
        caption=caption,
        images=[] if request.preview else _download(media, settings),
        video=video,
    )
