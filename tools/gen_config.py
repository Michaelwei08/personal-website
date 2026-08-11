"""Generate `_headers` and `sitemap.xml` from `site.json`.

Adding a route used to mean editing three files by hand: the page, a `_headers`
block carrying a copy-pasted 330-character CSP, and `sitemap.xml`. The CSP was
duplicated ten times and differed in exactly one token. Two failure modes follow
from that: a route silently ships without its policy, or a stylesheet ships
without its cache header, and neither is visible until production.

This makes `site.json` the source of truth and derives both files from it. The
stylesheet cache list is read from the filesystem, so a new stylesheet cannot be
forgotten.

What this deliberately does NOT change: every route still gets its own explicit,
complete CSP. Per D013/D016 the site does not use a global policy plus narrow
overrides, because Cloudflare applies every matching rule and the intersection of
two policies blocked the game's module script in production on 2026-07-30.

Usage (from the site root):
    python tools/gen_config.py --check      # exit 1 if the files are stale
    python tools/gen_config.py --diff       # show what would change
    python tools/gen_config.py              # write both files
"""
from __future__ import annotations

import argparse
import difflib
import glob
import json
import os
import re
import sys

SITE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def backup_file(path: str) -> str:
    """Copy into `.backup/`, never overwriting an existing copy.

    Not beside the file: Cloudflare Pages deploys the whole repo, so a
    `_headers.bak` in the root would be served at `/_headers.bak`.
    """
    backup_dir = os.path.join(SITE_ROOT, ".backup")
    os.makedirs(backup_dir, exist_ok=True)
    base = os.path.basename(path)
    for n in range(1, 100):
        name = f"{base}.bak" if n == 1 else f"{base}.bak{n}"
        candidate = os.path.join(backup_dir, name)
        if not os.path.exists(candidate):
            with open(candidate, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(open(path, encoding="utf-8").read())
            return candidate
    raise SystemExit(f"too many backups of {base} in .backup/; clean them up first")


def load_manifest() -> dict:
    with open(os.path.join(SITE_ROOT, "site.json"), encoding="utf-8") as fh:
        return json.load(fh)


def csp_for(manifest: dict, route: dict) -> str:
    """Build one route's full, explicit policy (D013/D016).

    A route may carry its own complete `csp` directive list, used verbatim.
    That exists for routes the shared template cannot express -- the bundled
    Next.js demo needs `unsafe-inline`, `blob:` and `data:`, none of which a
    boolean `scripts` flag can reach. Everything else takes the template with
    `{script_src}` filled in.
    """
    directives = route.get("csp")
    if directives:
        return "; ".join(directives)
    script_src = "'self'" if route.get("scripts", False) else "'none'"
    return "; ".join(
        d.replace("{script_src}", script_src) for d in manifest["csp_directives"]
    )


def stylesheets() -> list[str]:
    """Root-level stylesheets, sorted so the output is deterministic."""
    return sorted(
        os.path.basename(p) for p in glob.glob(os.path.join(SITE_ROOT, "*.css"))
    )


def render_headers(manifest: dict) -> str:
    lines = ["/*"]
    for name, value in manifest["global_headers"]:
        lines.append(f"  {name}: {value}")
    lines.append("")

    for route in manifest["routes"]:
        lines.append(route["match"])
        lines.append(f"  Content-Security-Policy: {csp_for(manifest, route)}")
        lines.append("")

    lines.append("/assets/*")
    lines.append(f"  Cache-Control: {manifest['asset_cache']}")
    lines.append("")

    for match, policy in manifest.get("extra_cache_rules", []):
        lines.append(match)
        lines.append(f"  Cache-Control: {policy}")
        lines.append("")

    # Contiguous, no blank lines between -- matches the existing file's shape.
    for name in stylesheets():
        lines.append(f"/{name}")
        lines.append(f"  Cache-Control: {manifest['stylesheet_cache']}")

    return "\n".join(lines) + "\n"


def render_sitemap(manifest: dict) -> str:
    by_loc = {r["loc"]: r for r in manifest["routes"] if r.get("loc")}
    order = manifest.get("sitemap_order") or list(by_loc)
    listed = [loc for loc in order if by_loc.get(loc, {}).get("sitemap", True)]

    missing = set(by_loc) - set(order)
    if missing:
        raise SystemExit(
            f"site.json: {sorted(missing)} have a 'loc' but are absent from "
            "'sitemap_order'; add them so the output order stays intentional"
        )

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    origin = manifest["origin"]
    for loc in listed:
        route = by_loc[loc]
        url = origin + ("/" if loc == "/" else loc)
        out.append("  <url>")
        out.append(f"    <loc>{url}</loc>")
        out.append(f"    <lastmod>{route['lastmod']}</lastmod>")
        out.append("  </url>")
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def parse_headers(text: str) -> dict[str, list[tuple[str, str]]]:
    """Parse into {url_pattern: [(header, value)]} so we can compare semantics."""
    rules: dict[str, list[tuple[str, str]]] = {}
    current = None
    for raw in text.splitlines():
        if not raw.strip():
            continue
        if not raw[0].isspace():
            current = raw.strip()
            rules.setdefault(current, [])
        elif current is not None:
            name, _, value = raw.strip().partition(":")
            rules[current].append((name.strip(), " ".join(value.split())))
    return rules


def semantic_diff(old: str, new: str) -> list[str]:
    """Compare `_headers` as rule sets. Reordering independent exact-path rules
    cannot change behaviour (Cloudflare applies every matching rule), so only
    added, removed or changed rules count as a real difference."""
    a, b = parse_headers(old), parse_headers(new)
    notes = []
    for pattern in sorted(set(a) - set(b)):
        notes.append(f"  REMOVED rule {pattern}")
    for pattern in sorted(set(b) - set(a)):
        notes.append(f"  ADDED   rule {pattern}")
    for pattern in sorted(set(a) & set(b)):
        if sorted(a[pattern]) != sorted(b[pattern]):
            notes.append(f"  CHANGED rule {pattern}")
            for item in sorted(set(a[pattern]) - set(b[pattern])):
                notes.append(f"      - {item[0]}: {item[1][:70]}")
            for item in sorted(set(b[pattern]) - set(a[pattern])):
                notes.append(f"      + {item[0]}: {item[1][:70]}")
    return notes


def text_diff(old: str, new: str, name: str) -> list[str]:
    return list(difflib.unified_diff(
        old.splitlines(), new.splitlines(),
        fromfile=f"{name} (on disk)", tofile=f"{name} (generated)", lineterm="", n=1,
    ))


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate _headers and sitemap.xml from site.json.")
    ap.add_argument("--check", action="store_true", help="exit 1 if generated output differs")
    ap.add_argument("--diff", action="store_true", help="print the diff, write nothing")
    args = ap.parse_args()

    manifest = load_manifest()
    targets = [
        ("_headers", render_headers(manifest)),
        ("sitemap.xml", render_sitemap(manifest)),
    ]

    stale = False
    for name, generated in targets:
        path = os.path.join(SITE_ROOT, name)
        on_disk = open(path, encoding="utf-8").read() if os.path.exists(path) else ""

        if on_disk == generated:
            print(f"{name}: up to date (byte-identical)")
            continue

        stale = True
        print(f"{name}: DIFFERS from generated output")
        if name == "_headers":
            notes = semantic_diff(on_disk, generated)
            if notes:
                print("  semantic differences (these change behaviour):")
                for note in notes:
                    print(note)
            else:
                print("  no semantic difference -- only rule ORDER changed, which is safe:")
                print("  Cloudflare applies every matching rule, so independent exact-path")
                print("  rules are order-insensitive.")
        if args.diff:
            for line in text_diff(on_disk, generated, name):
                print(f"  {line}")

    if args.check:
        if stale:
            print("\nFAIL: generated config is stale. Run tools/gen_config.py.")
            raise SystemExit(1)
        print("\nOK: _headers and sitemap.xml match site.json.")
        return

    if args.diff:
        print("\nNothing written (--diff).")
        return

    if not stale:
        print("\nNothing to write.")
        return

    for name, generated in targets:
        path = os.path.join(SITE_ROOT, name)
        if os.path.exists(path):
            print(f"backup -> .backup/{os.path.basename(backup_file(path))}")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(generated)
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
