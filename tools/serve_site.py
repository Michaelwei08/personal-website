"""Serve the site the way Cloudflare Pages does, for local checking.

`python -m http.server` gets two things wrong about this site:

1. **Clean routes.** Production serves `/clinical-agent`; the file is
   `clinical-agent.html`. A plain static server 404s on every internal link.
2. **No `_headers`.** Cloudflare applies the CSP; the stdlib server does not, so
   a policy mistake stays invisible until deploy. This repo's own history has an
   incident of exactly that kind -- a route's module script was blocked in
   production because two CSP rules both matched and their intersection banned it.

This serves clean routes, applies every matching `_headers` rule in file order
(which is what reproduces that two-policies bug class), and returns the real
404 page with a 404 status.

Usage (from the site root):
    python tools/serve_site.py
    python tools/serve_site.py --port 4173
"""
from __future__ import annotations

import argparse
import functools
import http.server
import os
import re
import socketserver

DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_headers_file(root: str) -> list[tuple[str, list[tuple[str, str]]]]:
    """Parse Cloudflare `_headers` into [(url_pattern, [(name, value), ...])]."""
    path = os.path.join(root, "_headers")
    if not os.path.exists(path):
        return []
    rules: list[tuple[str, list[tuple[str, str]]]] = []
    current: str | None = None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            current = line.strip()
            rules.append((current, []))
        elif rules:
            name, _, value = line.strip().partition(":")
            if value:
                rules[-1][1].append((name.strip(), value.strip()))
    return rules


def pattern_matches(pattern: str, url_path: str) -> bool:
    """Cloudflare-style match: literal path, or a trailing * wildcard."""
    if not pattern.startswith("/"):
        return False
    regex = "^" + re.escape(pattern).replace(r"\*", ".*") + "$"
    if pattern.endswith("*"):
        return re.match(regex, url_path) is not None
    # An exact rule for "/foo" should also cover the clean route form.
    return url_path == pattern


class CleanRouteHandler(http.server.SimpleHTTPRequestHandler):
    """Static handler with clean-route resolution and `_headers` applied."""

    header_rules: list[tuple[str, list[tuple[str, str]]]] = []

    def log_message(self, fmt, *args):  # quieter, one line per request
        print(f"  {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    def _apply_configured_headers(self) -> None:
        url_path = self.path.split("?", 1)[0].split("#", 1)[0]
        for pattern, headers in self.header_rules:
            if pattern_matches(pattern, url_path):
                for name, value in headers:
                    # Every matching rule contributes, duplicates included --
                    # that is what makes the intersecting-CSP failure visible.
                    self.send_header(name, value)

    def end_headers(self) -> None:
        self._apply_configured_headers()
        super().end_headers()

    def translate_path(self, path: str) -> str:
        resolved = super().translate_path(path)
        if os.path.isdir(resolved) or os.path.exists(resolved):
            return resolved
        # /clinical-agent -> clinical-agent.html
        if not os.path.splitext(resolved)[1] and os.path.exists(resolved + ".html"):
            return resolved + ".html"
        return resolved

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            custom = os.path.join(self.directory, "404.html")
            if os.path.exists(custom):
                body = open(custom, "rb").read()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        super().send_error(code, message, explain)


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve the site with clean routes and _headers.")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--port", type=int, default=4173)
    ap.add_argument("--bind", default="127.0.0.1")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.exists(os.path.join(root, "index.html")):
        raise SystemExit(f"{root} has no index.html; pass --root")

    CleanRouteHandler.header_rules = parse_headers_file(root)
    handler = functools.partial(CleanRouteHandler, directory=root)

    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    print(f"root:    {root}")
    print(f"_headers: {len(CleanRouteHandler.header_rules)} rule(s) applied")
    print(f"serving: http://{args.bind}:{args.port}/\n")
    print("  /                 homepage (clinical agent is now the feature)")
    print("  /projects         archive, clinical-agent first")
    print("  /clinical-agent   the walkthrough and sandbox")
    print("\nCtrl+C to stop.\n")

    with Server((args.bind, args.port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
