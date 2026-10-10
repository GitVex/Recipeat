"""Reading one Instagram post, logged out (#111, docs/extraction.md → Instagram).

A post carries no recipe markup, so nothing is parsed here: the caption and the
post's images go back to the app, which hands both to the model. A reel's sound
track comes from `/instagram/audio`, asked for only when they hold no recipe. The images are
downloaded here rather than passed on as URLs, so everything that talks to
Instagram is in one place and the app never fetches an address a post named.

The request is a shortcode, not a URL. There is nothing to point elsewhere:
the post is looked up through instaloader, and its media are fetched only from
the hosts in `instagram_media_hosts`, without following redirects.
"""

import base64
import subprocess
import tempfile
from pathlib import Path
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
from ..models import InstagramAudio, InstagramImage, InstagramPost, InstagramRequest

router = APIRouter(tags=["instagram"])

# Instagram's own ceiling on a carousel.
MAX_IMAGES = 20

GONE = "That post could not be found. It may be private or deleted."
REFUSED = "Instagram is not answering requests from us right now; try again later."
TOO_LONG = "That reel is too long to read: up to 3 minutes."


def _post_fields(post: instaloader.Post) -> tuple[str, str | None, list[str], bool]:
    """The post's author, caption, media URLs (a video's cover, not the video)
    and whether it is a video."""
    # A carousel with a video in it may query again.
    nodes = list(post.get_sidecar_nodes()) if post.typename == "GraphSidecar" else []
    media = [node.display_url for node in nodes] or [post.url]
    return post.owner_username, post.caption, media, post.is_video


def _read_post(shortcode: str, settings: Settings, read=_post_fields):
    """`read` applied to the post, with Instagram's failures mapped to answers."""
    loader = instaloader.Instaloader(
        quiet=True,
        # One attempt: on a 429 instaloader otherwise sleeps until the limit
        # lifts, which can be minutes, with a browser waiting on the other end.
        max_connection_attempts=1,
        request_timeout=settings.fetch_timeout,
    )
    try:
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        # Read here so a failure lands in the mapping below: a post's fields
        # are lazy and may query again.
        return read(post)
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


def _download(urls: list[str], settings: Settings, kind: str, limit: int, too_large: str) -> list[tuple[str, bytes]]:
    """Each URL's type and body, all of them together under `limit` bytes."""
    media: list[tuple[str, bytes]] = []
    total = 0
    # Guarded under the allowlist: a CDN name that resolved inward is refused
    # too (#117).
    with guarded_client(settings.fetch_allow_private, timeout=settings.fetch_timeout, follow_redirects=False) as client:
        for raw in urls:
            url = httpx.URL(raw)
            # The post names these, so they are as untrusted as the rest of it.
            if not _allowed(url, settings):
                raise HTTPException(status_code=502, detail="That post named media on a host we do not read from.")
            try:
                with client.stream("GET", url) as response:
                    if response.status_code != 200:
                        raise HTTPException(status_code=502, detail=f"Instagram's media host answered {response.status_code}.")
                    mime_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if not mime_type.startswith(kind + "/"):
                        raise HTTPException(status_code=502, detail=f"Instagram's media host did not serve an {kind}.")
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        total += len(chunk)
                        if total > limit:
                            raise HTTPException(status_code=413, detail=too_large)
            except BlockedAddress as error:
                raise HTTPException(status_code=502, detail="That post named media on a host we do not read from.") from error
            except httpx.TimeoutException as error:
                raise HTTPException(status_code=504, detail="Instagram's media host did not answer in time.") from error
            except httpx.RequestError as error:
                raise HTTPException(status_code=502, detail="Could not reach Instagram's media host.") from error
            media.append((mime_type, bytes(body)))
    return media


@router.post("/instagram")
def instagram(
    request: InstagramRequest, settings: Annotated[Settings, Depends(get_settings)]
) -> InstagramPost:
    author, caption, media, video = _read_post(request.shortcode, settings)
    return InstagramPost(
        url=f"https://www.instagram.com/p/{request.shortcode}/",
        author=author,
        caption=caption,
        images=[] if request.preview else [
            InstagramImage(mime_type=mime_type, data=base64.b64encode(body).decode("ascii"))
            for mime_type, body in _download(
                media[:MAX_IMAGES], settings, "image", settings.instagram_max_bytes,
                "That post's images are too large to read.",
            )
        ],
        video=video,
    )


def _video_fields(post: instaloader.Post) -> tuple[str | None, float | None]:
    """The video's address and length in seconds, when the post is a video."""
    return (post.video_url, post.video_duration) if post.is_video else (None, None)


def _sound_track(video: bytes, settings: Settings) -> bytes:
    """The video's first audio track, copied into an MP4 container as it is:
    no re-encoding, so nothing is lost and it takes a fraction of a second."""
    with tempfile.TemporaryDirectory() as directory:
        source, track = Path(directory, "reel.mp4"), Path(directory, "sound.m4a")
        source.write_bytes(video)
        try:
            done = subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(source),
                 "-map", "0:a:0", "-vn", "-c:a", "copy", "-f", "mp4", str(track)],
                capture_output=True, timeout=settings.ffmpeg_timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise HTTPException(status_code=504, detail="Copying the reel's sound took too long.") from error
        # ffmpeg says "matches no streams" for a video without sound; anything
        # else it refuses is a video it cannot read.
        if done.returncode != 0:
            if b"matches no streams" in done.stderr:
                raise HTTPException(status_code=422, detail="That reel has no sound to read.")
            raise HTTPException(status_code=502, detail="Could not read the reel's video.")
        # Logged out, Instagram leaves a reel's length out, so the limit is
        # usually first checked here, on the track itself.
        probed = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(track)],
            capture_output=True, text=True, timeout=settings.ffmpeg_timeout,
        )
        try:
            seconds = float(probed.stdout)
        except ValueError:
            seconds = 0.0  # Unknown: the byte limit has already held.
        if seconds > settings.instagram_max_video_seconds:
            raise HTTPException(status_code=413, detail=TOO_LONG)
        return track.read_bytes()


@router.post("/instagram/audio")
def instagram_audio(
    request: InstagramRequest, settings: Annotated[Settings, Depends(get_settings)]
) -> InstagramAudio:
    """A reel's sound track, for the app to read the recipe from (#124)."""
    video_url, duration = _read_post(request.shortcode, settings, _video_fields)
    if not video_url:
        raise HTTPException(status_code=422, detail="That post is not a video.")
    # Refused before the download when Instagram says how long it is; the
    # byte limit holds either way.
    if duration and duration > settings.instagram_max_video_seconds:
        raise HTTPException(status_code=413, detail=TOO_LONG)
    [(_, video)] = _download(
        [video_url], settings, "video", settings.instagram_max_video_bytes,
        "That reel is too large to read: up to 50 MB.",
    )
    return InstagramAudio(data=base64.b64encode(_sound_track(video, settings)).decode("ascii"))
