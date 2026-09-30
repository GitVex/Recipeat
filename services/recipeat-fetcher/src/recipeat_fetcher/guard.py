"""The SSRF guard (#117): every outbound connection goes to a public address.

The check sits in the network backend, at the point where a socket is opened,
rather than in front of the request. There the host is resolved once, every
address it resolves to is checked, and the socket is opened to the address that
was checked — so there is no second lookup for a rebinding DNS server to answer
differently, and every redirect hop is checked by the same code because it
opens a connection of its own. TLS is unaffected: httpcore takes the SNI name
and the certificate check from the request's host, not from what was dialled.

`guarded_client` is the only way the fetcher should make an HTTP client.
"""

import ipaddress
import socket
import ssl
from typing import Any, Iterable

import certifi
import httpcore
import httpx

PORTS = frozenset({80, 443})


class BlockedAddress(Exception):
    """A host that resolves to an address the fetcher must not reach.

    Deliberately not an httpcore error, so httpx passes it through unchanged
    and it can be answered as the caller's mistake rather than an outage.
    Carries the host, never the address: which internal addresses exist is
    not the caller's business.
    """

    def __init__(self, host: str):
        super().__init__(host)
        self.host = host


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address):
        # An IPv4 address carried inside IPv6 is judged as itself.
        embedded = ip.ipv4_mapped or ip.sixtofour or (ip.teredo and ip.teredo[1])
        if embedded:
            ip = embedded
    # `is_global` already excludes loopback, private, link-local, shared (CGNAT),
    # unspecified and reserved ranges. It counts multicast as global.
    return ip.is_global and not ip.is_multicast


def resolve(host: str, port: int) -> list[str]:
    """Every address `host` resolves to, if all of them are public."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as error:
        raise httpcore.ConnectError(f"could not resolve {host}") from error
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    # All, not any: a name with one public and one private address would
    # otherwise reach the private one whenever the public one fails.
    if not addresses or not all(is_public(address) for address in addresses):
        raise BlockedAddress(host)
    return addresses


class GuardedBackend(httpcore.SyncBackend):
    def __init__(self, allow_private: bool = False):
        self.allow_private = allow_private

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.NetworkStream:
        if self.allow_private:
            return super().connect_tcp(host, port, timeout, local_address, socket_options)
        if port not in PORTS:
            raise BlockedAddress(host)

        error: httpcore.ConnectError | None = None
        for address in resolve(host, port):
            try:
                # An IP literal: create_connection does no lookup of its own.
                return super().connect_tcp(address, port, timeout, local_address, socket_options)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as failed:
                error = failed
        raise error  # type: ignore[misc]  # resolve() never returns an empty list


class GuardedTransport(httpx.HTTPTransport):
    def __init__(self, allow_private: bool = False):
        super().__init__()
        # HTTPTransport takes no network backend of its own, so its pool is
        # rebuilt with one. Everything else is httpx's default: certifi's CA
        # bundle, HTTP/1.1, default limits.
        self._pool = httpcore.ConnectionPool(
            ssl_context=ssl.create_default_context(cafile=certifi.where()),
            network_backend=GuardedBackend(allow_private),
        )


def guarded_client(allow_private: bool = False, **kwargs: Any) -> httpx.Client:
    """An httpx client whose every connection, redirects included, is guarded.

    `allow_private` is for the tests' loopback server only. It turns the guard
    off entirely, and nothing sets it outside the tests.
    """
    return httpx.Client(transport=GuardedTransport(allow_private), **kwargs)
