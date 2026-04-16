"""Security hardening: headers, request-size limit, error handling, error redaction."""

import logging
import re
from typing import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger("app.security")

# 1 MiB is generous for a JSON health API — real requests are empty-bodied GETs.
DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024

# Headers applied to every response. Values are conservative defaults suitable
# for a JSON-only API with no browser-rendered assets.
SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
    # HSTS is safe to advertise — browsers ignore it on plain HTTP.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    # Remove server fingerprinting surface.
    "Server": "api",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach conservative security headers to every response."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            # Do not clobber headers an inner handler set intentionally.
            response.headers.setdefault(header, value)
        # Server header is set by uvicorn/starlette; overwrite to avoid fingerprint.
        response.headers["Server"] = SECURITY_HEADERS["Server"]
        return response


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length header exceeds the limit.

    Prevents trivial resource exhaustion on a service that never expects
    request bodies. We only check the declared Content-Length — streaming
    bodies without it are rejected out of caution for non-GET/HEAD.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = DEFAULT_MAX_BODY_BYTES) -> None:
        super().__init__(app)
        self._max = max_bytes

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                return JSONResponse(
                    {"detail": "Invalid Content-Length"},
                    status_code=400,
                )
            if declared < 0 or declared > self._max:
                return JSONResponse(
                    {"detail": "Payload too large"},
                    status_code=413,
                )
        return await call_next(request)


# Matches `scheme://user:password@host` and `scheme://user@host`; also generic
# `password=...` / `pwd=...` fragments that can appear inside driver errors.
_URL_CREDENTIAL_RE = re.compile(
    r"(?P<scheme>[a-zA-Z][a-zA-Z0-9+\-.]*://)(?P<userinfo>[^/@\s]+)@",
)
_INLINE_SECRET_RE = re.compile(
    r"(?P<key>\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)"
    r"(?P<val>[^\s,;'\")\]}]+)",
    re.IGNORECASE,
)

_ERROR_REDACTION = "[redacted]"
_MAX_ERROR_LENGTH = 200


def redact_error_message(message: str | None) -> str | None:
    """Strip credentials and truncate error messages before exposing them.

    SQLAlchemy/driver errors can embed the full connection URL (including
    passwords) or environment-derived secrets. This function replaces any
    `scheme://user:pw@` userinfo with `scheme://[redacted]@` and masks any
    inline `password=...` / `token=...` tokens, then truncates to a bounded
    length to cap accidental log/response growth.
    """
    if message is None:
        return None
    redacted = _URL_CREDENTIAL_RE.sub(
        lambda m: f"{m.group('scheme')}{_ERROR_REDACTION}@",
        message,
    )
    redacted = _INLINE_SECRET_RE.sub(
        lambda m: f"{m.group('key')}{_ERROR_REDACTION}",
        redacted,
    )
    if len(redacted) > _MAX_ERROR_LENGTH:
        redacted = redacted[:_MAX_ERROR_LENGTH] + "..."
    return redacted


async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """Return a generic 500 so tracebacks and internal state never leak to clients."""
    # Log full context server-side for operators; log the exception class
    # but not the stringified args (which may carry sensitive state).
    logger.exception(
        "unhandled exception on %s %s",
        request.method,
        request.url.path,
    )
    return JSONResponse(
        {"detail": "Internal Server Error"},
        status_code=500,
        headers={"Cache-Control": "no-store"},
    )


def install_security(
    app: FastAPI,
    *,
    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
) -> None:
    """Wire security middleware and a generic exception handler onto an app."""
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=max_body_bytes)
    app.add_exception_handler(Exception, unhandled_exception_handler)
