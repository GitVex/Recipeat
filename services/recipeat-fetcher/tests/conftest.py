"""Fixtures for the service's own tests.

Nothing here reaches the internet. `site` is a real HTTP server on loopback, so
the fetch layer is exercised over a socket rather than against a mocked client:
timeouts, redirect limits and encodings only behave like themselves when
something is actually serving them.
"""

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from recipeat_fetcher.app import app
from recipeat_fetcher.config import Settings, get_settings

RECIPE_HTML = b"<html><head><title>Pancakes</title></head><body>Pancakes</body></html>"
GERMAN_HTML = "<html>Gr\u00fc\u00dfe aus der K\u00fcche</html>".encode("iso-8859-1")


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D102 - quiet during tests
        pass

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's spelling
        routes = {
            "/recipe": (RECIPE_HTML, "text/html; charset=utf-8"),
            "/latin": (GERMAN_HTML, "text/html; charset=iso-8859-1"),
            "/no-charset": (GERMAN_HTML, "text/html"),
            "/pdf": (b"%PDF-1.4", "application/pdf"),
            "/no-type": (RECIPE_HTML, None),
            "/big": (b"<html>" + b"x" * 2_000_000, "text/html"),
        }

        if self.path == "/slow":
            time.sleep(1.5)
            body, content_type = RECIPE_HTML, "text/html"
        elif self.path == "/loop":
            self.send_response(302)
            self.send_header("Location", "/loop")
            self.end_headers()
            return
        elif self.path == "/moved":
            self.send_response(302)
            self.send_header("Location", "/recipe")
            self.end_headers()
            return
        elif self.path in routes:
            body, content_type = routes[self.path]
        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"not here")
            return

        self.send_response(200)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(scope="session")
def site():
    """A server on loopback. Returns a function from path to URL."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    yield lambda path: base + path
    server.shutdown()


@pytest.fixture
def client():
    """The app, with limits small enough that the tests stay quick."""
    app.dependency_overrides[get_settings] = lambda: Settings(
        fetch_timeout=0.5,
        fetch_max_bytes=1_000_000,
        fetch_max_redirects=2,
    )
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
