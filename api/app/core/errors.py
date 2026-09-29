from __future__ import annotations

import structlog
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = structlog.get_logger()


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = "not_found" if exc.status_code == 404 else "request_error"
    if exc.status_code == 401:
        code = "unauthorized"
    elif exc.status_code == 403:
        code = "forbidden"
    return JSONResponse(
        content={"error": {"code": code, "message": str(exc.detail), "request_id": _request_id(request)}},
        status_code=exc.status_code,
    )


async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        content={
            "error": {
                "code": "validation_error",
                "message": "The request is invalid.",
                "request_id": _request_id(request),
                "details": exc.errors(),
            }
        },
        status_code=422,
    )


async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    await logger.aexception("unhandled_request_error", error_type=type(exc).__name__)
    return JSONResponse(
        content={
            "error": {
                "code": "internal_error",
                "message": "An unexpected error occurred.",
                "request_id": _request_id(request),
            }
        },
        status_code=500,
    )
