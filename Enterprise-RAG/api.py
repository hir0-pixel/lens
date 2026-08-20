"""Loopback-only bridge between Lens BFF and the dummy-data Enterprise-RAG demo.

The browser never calls this service and it never returns the Gemini API key.
It is deliberately refused unless the synthetic-data Gemini test guard is set.
"""
import hmac
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from rag import RagServiceError, answer_query, gemini_test_settings

MAX_REQUEST_BYTES = 8 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "LensEnterpriseRag/1.0"

    def do_POST(self):
        if self.path != "/v1/ask":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        token = os.getenv("RAG_SERVICE_TOKEN", "")
        supplied = self.headers.get("x-lens-rag-token", "")
        if len(token) < 32 or not hmac.compare_digest(token, supplied):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "UNAUTHENTICATED"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            query = payload.get("query") if isinstance(payload, dict) else None
            # Refuse before any query or document text can leave this host.
            gemini_test_settings()
            result = answer_query(query)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "INVALID_ARGUMENT"})
        except RagServiceError:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "DEPENDENCY_UNAVAILABLE"})
        except Exception:
            # Raw provider, query, document, or retrieval details never enter logs or responses.
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "DEPENDENCY_UNAVAILABLE"})
        else:
            self._json(HTTPStatus.OK, result)

    def log_message(self, _format, *_args):
        # Do not write request content, credentials, or document-derived data to stdout.
        return

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    if os.getenv("RAG_BIND_HOST", "127.0.0.1") != "127.0.0.1":
        raise SystemExit("RAG service may bind only to loopback.")
    gemini_test_settings()
    port = int(os.getenv("RAG_SERVICE_PORT", "8010"))
    if not 1024 <= port <= 65535:
        raise SystemExit("RAG_SERVICE_PORT is invalid.")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
