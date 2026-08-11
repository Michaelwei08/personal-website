# tools

Maintenance scripts for this site. Python standard library only -- no npm, no
build dependencies, nothing to keep up to date. Run them from the site root.

The site stays hand-written HTML on purpose. These do not template the pages;
they remove the two duplications that were actually costing something, and they
make local checking match production.

## `gen_config.py` -- generate `_headers` and `sitemap.xml`

`site.json` is the source of truth for routes. Adding a route used to mean
editing three places by hand, including a copy-pasted 330-character CSP that was
duplicated ten times and differed in one token.

```bash
python tools/gen_config.py --check    # exit 1 if the files are stale
python tools/gen_config.py --diff     # show what would change
python tools/gen_config.py            # write both files
```

The stylesheet cache list is read from the filesystem, so a new stylesheet cannot
ship without its cache header.

**Every route keeps its own explicit, complete CSP.** Do not "simplify" this to a
global policy plus narrow overrides: Cloudflare applies every matching rule, and
the intersection of two policies is what blocked the game's module script in
production on 2026-07-30. See D013 / D016.

## `dedupe_css.py` -- CSS lint

Enforces D020: no top-level rule may re-declare a property the same selector
already sets at top level. When that happens the file holds two answers to the
same question and only position decides which you get.

```bash
python tools/dedupe_css.py --check    # lint
python tools/dedupe_css.py            # remove dead declarations (provably safe)
python tools/dedupe_css.py --merge    # collapse repeated blocks -- verify after
```

`--check` and the default mode are safe: a declaration is only removed when the
same selector re-declares the same property later, so it never applied. `--merge`
moves declarations and is **not** provably safe -- it changes which rule wins
against equal-specificity rules declared in between. Verify rendering afterwards
and keep the backup.

Note the rule is deliberately *not* "every selector appears once". A selector
legitimately appears in a shared group (`.a, .b { ... }`) and again in its own
block; failing on that would train you to ignore the linter.

## `serve_site.py` -- local preview that behaves like production

```bash
python tools/serve_site.py
```

`python -m http.server` gets two things wrong here:

- **Clean routes.** Production serves `/projects`; the file is `projects.html`. A
  plain static server 404s on every internal link.
- **No `_headers`.** Cloudflare applies the CSP; the stdlib server does not, so a
  policy mistake stays invisible until deploy.

This serves clean routes, applies every matching `_headers` rule in file order
(which is what reproduces the two-policies bug class), and returns the real 404
page with a 404 status.

Cloudflare remains the source of truth. It does not emulate the `.html` -> clean
route 308 redirects.

## Before deploying

```bash
python tools/gen_config.py --check
python tools/dedupe_css.py --check
```
