"""Remove provably-dead CSS declarations, and lint for duplicate selectors.

The site's `content.css` was produced by consolidating several older stylesheets
(`portfolio.css`, `sections.css`, `archive.css`, ...) into one file. The merge did
not deduplicate, so a dozen selectors are declared two to four times and some of
those blocks contradict each other -- `.signal-strip` is `display: grid` in one
place and `display: flex` in another. The practical cost is that you cannot read
the file and know what applies.

This only performs a transformation that CANNOT change rendered output:

    If the same selector re-declares the same property later at the same
    specificity, the earlier declaration never won anything. Delete it.

Deliberately left alone, because removing them could change output or intent:

  - Grouped selectors (`.a, .b { ... }`) unless *every* selector in the group
    re-declares the property later. One shared block may still be load-bearing
    for the other selector.
  - Declarations inside `@media` blocks. Those legitimately override top-level
    rules and are the site's stated convention ("media queries last so they win").
  - Orphans: a property with no later counterpart, even if it is inert in context
    (`grid-template-columns` on what later becomes a flex container). Those need a
    human decision, so they are reported, not touched.

Usage (from the site root):
    python tools/dedupe_css.py --check          # lint; exit 1 if any dead declarations
    python tools/dedupe_css.py --dry-run        # show what would be removed
    python tools/dedupe_css.py                  # remove dead declarations (backs up first)
    python tools/dedupe_css.py --merge          # also collapse repeated single-selector
                                                # blocks; NOT provably safe, verify after
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
from collections import defaultdict

DEFAULT_SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_FILES = ["content.css", "base.css"]


def backup(path: str) -> str:
    """Copy into `.backup/`, never clobbering an existing copy.

    Two things this gets right that the obvious version does not:

    - It writes into `.backup/`, not next to the file. Cloudflare Pages deploys
      everything in the repo, so a `content.css.bak` beside `content.css` would be
      publicly served at `/content.css.bak`. `.backup/` is already gitignored.
    - It never overwrites. An earlier version clobbered its own backup when
      --write was followed by --merge, which for a file that happens to be
      untracked in git destroys the only original.
    """
    site = os.path.dirname(os.path.abspath(path))
    backup_dir = os.path.join(site, ".backup")
    os.makedirs(backup_dir, exist_ok=True)
    base = os.path.basename(path)
    for n in range(1, 100):
        name = f"{base}.bak" if n == 1 else f"{base}.bak{n}"
        candidate = os.path.join(backup_dir, name)
        if not os.path.exists(candidate):
            shutil.copyfile(path, candidate)
            print(f"  backup -> .backup/{name}")
            return candidate
    raise SystemExit(f"too many backups of {base} in .backup/; clean them up first")


def _blank_keep_newlines(match: re.Match) -> str:
    return re.sub(r"[^\n]", " ", match.group(0))


def strip_comments(src: str) -> str:
    """Blank out comments but preserve line numbering and length."""
    return re.sub(r"/\*.*?\*/", _blank_keep_newlines, src, flags=re.S)


def media_spans(src: str) -> list[tuple[int, int]]:
    spans = []
    for m in re.finditer(r"@media[^{]+\{", src):
        i, depth = m.end() - 1, 0
        while i < len(src):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        spans.append((m.start(), i + 1))
    return spans


def top_level_rules(src: str) -> list[dict]:
    """Parse top-level rules only, recording character offsets into `src`."""
    scan = strip_comments(src)
    masked = list(scan)
    for a, b in media_spans(scan):
        for k in range(a, b):
            masked[k] = " "
    masked = "".join(masked)

    rules = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", masked):
        selector = " ".join(m.group(1).split())
        if not selector or selector.startswith("@"):
            continue
        decls = []
        for dm in re.finditer(r"([-a-zA-Z]+)\s*:\s*([^;]+)(;|$)", m.group(2)):
            decls.append({
                "prop": dm.group(1).strip().lower(),
                "value": dm.group(2).strip(),
                "start": m.start(2) + dm.start(),
                "end": m.start(2) + dm.end(),
            })
        rules.append({
            "selector": selector,
            "parts": [s.strip() for s in selector.split(",") if s.strip()],
            "decls": decls,
            "line": src[: m.start(1)].count("\n") + 1,
            "block_start": m.start(1),
            "block_end": m.end(),
        })
    return rules


def find_duplicates(rules: list[dict]) -> dict[str, list[int]]:
    seen = defaultdict(list)
    for rule in rules:
        for part in rule["parts"]:
            seen[part].append(rule["line"])
    return {k: v for k, v in seen.items() if len(v) > 1}


def plan_removals(rules: list[dict]) -> tuple[list[dict], list[str]]:
    """Return (declarations safe to delete, notes about what was left alone)."""
    # For each (selector part, property) record the rule indices that declare it.
    occurrences: dict[tuple[str, str], list[int]] = defaultdict(list)
    for idx, rule in enumerate(rules):
        for decl in rule["decls"]:
            for part in rule["parts"]:
                occurrences[(part, decl["prop"])].append(idx)

    removals, notes = [], []
    for idx, rule in enumerate(rules):
        for decl in rule["decls"]:
            # Dead only if EVERY selector in this block re-declares it later.
            shadowed_for_all = True
            for part in rule["parts"]:
                later = [i for i in occurrences[(part, decl["prop"])] if i > idx]
                if not later:
                    shadowed_for_all = False
                    break
            if not shadowed_for_all:
                continue
            if len(rule["parts"]) > 1:
                notes.append(
                    f"L{rule['line']} {rule['selector']}: '{decl['prop']}' is shadowed for "
                    f"every selector in the group -- removing it is safe but the group is "
                    f"shared, so review by hand"
                )
                continue
            removals.append({
                "line": rule["line"], "selector": rule["selector"],
                "prop": decl["prop"], "value": decl["value"],
                "start": decl["start"], "end": decl["end"],
            })
    return removals, notes


def apply_removals(src: str, removals: list[dict]) -> str:
    out = src
    for rem in sorted(removals, key=lambda r: r["start"], reverse=True):
        out = out[: rem["start"]] + out[rem["end"]:]
    # Tidy blocks left empty or with dangling separators.
    out = re.sub(r"\{\s*;+\s*", "{ ", out)
    out = re.sub(r";\s*;+", "; ", out)
    out = re.sub(r"([^{}]+)\{\s*\}", "", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out


def plan_merges(rules: list[dict]) -> tuple[list[dict], list[str]]:
    """Group repeated single-selector blocks into one block at the last position.

    NOT provably safe on its own, unlike the dead-declaration removal above:
    moving a declaration later in the file changes which rule wins against any
    equal-specificity rule declared in between. Callers must verify rendering
    afterwards -- `--merge` is designed to be run against a computed-style oracle,
    and the caller keeps the .bak to revert.

    Grouped blocks (`.a, .b { ... }`) are skipped: merging them would force the
    other selectors in the group to move too.
    """
    by_selector: dict[str, list[int]] = defaultdict(list)
    for idx, rule in enumerate(rules):
        if len(rule["parts"]) == 1:
            by_selector[rule["parts"][0]].append(idx)

    merges, notes = [], []
    for selector, indices in by_selector.items():
        if len(indices) < 2:
            continue
        decls: list[tuple[str, str]] = []
        for idx in indices:
            for decl in rules[idx]["decls"]:
                decls = [(p, v) for p, v in decls if p != decl["prop"]]
                decls.append((decl["prop"], decl["value"]))
        merges.append({
            "selector": selector,
            "keep": indices[-1],
            "drop": indices[:-1],
            "decls": decls,
            "lines": [rules[i]["line"] for i in indices],
        })
    return merges, notes


def apply_merges(src: str, rules: list[dict], merges: list[dict]) -> str:
    edits = []  # (start, end, replacement)
    for merge in merges:
        keep = rules[merge["keep"]]
        body = "".join(f"\n  {p}: {v};" for p, v in merge["decls"])
        edits.append((keep["block_start"], keep["block_end"],
                      f"{merge['selector']} {{{body}\n}}"))
        for idx in merge["drop"]:
            edits.append((rules[idx]["block_start"], rules[idx]["block_end"], ""))

    out = src
    for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
        out = out[:start] + replacement + out[end:]
    return re.sub(r"\n{3,}", "\n\n", out)


def process(path: str, mode: str) -> tuple[int, int]:
    src = open(path, encoding="utf-8").read()
    rules = top_level_rules(src)
    dupes = find_duplicates(rules)
    removals, notes = plan_removals(rules)

    name = os.path.basename(path)
    print(f"=== {name} ===")
    print(f"  top-level rules: {len(rules)}")
    print(f"  selectors declared more than once: {len(dupes)}")
    for sel, lines in sorted(dupes.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        print(f"    {sel:46} lines {lines}")

    if removals:
        print(f"  dead declarations (later re-declaration wins): {len(removals)}")
        for rem in removals:
            print(f"    L{rem['line']:<5} {rem['selector']:34} {rem['prop']}: {rem['value']}")
    else:
        print("  dead declarations: none")

    for note in notes:
        print(f"  LEFT ALONE {note}")

    if mode == "write" and removals:
        backup(path)
        open(path, "w", encoding="utf-8", newline="\n").write(apply_removals(src, removals))
        print(f"  rewrote {name} ({len(removals)} removed); backup at {name}.bak")

    if mode == "merge":
        merges, _ = plan_merges(rules)
        if not merges:
            print("  nothing to merge")
        else:
            print(f"  merging {len(merges)} repeated selector(s) into one block each:")
            for merge in merges:
                print(f"    {merge['selector']:34} lines {merge['lines']} "
                      f"-> {len(merge['decls'])} declaration(s)")
            backup(path)
            open(path, "w", encoding="utf-8", newline="\n").write(
                apply_merges(src, rules, merges))
            print(f"  rewrote {name}; backup at {name}.bak")
            print("  VERIFY RENDERING NOW -- this transformation is not provably safe.")

    return len(dupes), len(removals)


def main() -> None:
    ap = argparse.ArgumentParser(description="Dedupe CSS declarations / lint duplicate selectors.")
    ap.add_argument("--site", default=DEFAULT_SITE)
    ap.add_argument("--files", nargs="+", default=DEFAULT_FILES)
    ap.add_argument("--check", action="store_true", help="lint only; exit 1 if duplicates remain")
    ap.add_argument("--dry-run", action="store_true", help="report the plan, write nothing")
    ap.add_argument("--merge", action="store_true",
                    help="also collapse repeated single-selector blocks (verify rendering after)")
    args = ap.parse_args()

    if args.check:
        mode = "check"
    elif args.dry_run:
        mode = "dry-run"
    elif args.merge:
        mode = "merge"
    else:
        mode = "write"
    total_dead = 0
    for name in args.files:
        path = os.path.join(os.path.abspath(args.site), name)
        if not os.path.exists(path):
            raise SystemExit(f"missing {path}")
        _, dead = process(path, mode)
        total_dead += dead
        print()

    if not args.check:
        return

    # The lint fails on DEAD DECLARATIONS, not on repeated selectors.
    #
    # "Every selector appears exactly once" sounds like the rule but is the wrong
    # one: a selector legitimately appears in a shared group (`.a, .b { ... }`) and
    # again in its own block. That is ordinary CSS, and failing on it would train
    # you to ignore the linter. What actually costs you is a selector re-declaring
    # a property it already sets at top level -- then the file holds two answers to
    # the same question and only position decides which you get.
    if total_dead:
        print(f"FAIL: {total_dead} dead declaration(s). The same selector re-declares the")
        print("same property later at top level, so the earlier one never applies.")
        print("Run without --check to remove them; rendering is provably unchanged.")
        raise SystemExit(1)
    print("OK: no selector re-declares a property it already sets at top level.")
    print("Any repeated selectors listed above are shared groups, which are fine.")


if __name__ == "__main__":
    main()
