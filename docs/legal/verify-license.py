#!/usr/bin/env python3
"""
verify-license.py — confirm LICENSE contains PolyForm Shield 1.0.0 unmodified.

TrueExport's licensing model depends on the PolyForm text being byte-identical
to the canonical version. If it drifts — an autoformatter, a stray edit, a
find-and-replace that overreached — it stops being a standard licence and
becomes a bespoke one, silently.

Run before every release. Exit code 0 = clean, 1 = drift, 2 = couldn't check.

    python3 verify-license.py
    python3 verify-license.py --license path/to/LICENSE

Requires network access to polyformproject.org.
"""

import argparse
import difflib
import hashlib
import re
import sys
import urllib.request

CANONICAL_URL = "https://polyformproject.org/licenses/shield/1.0.0"

# SHA-256 of the normalised canonical licence body. This is the primary check:
# it is deterministic and needs no network, so it is safe to gate CI on.
# Regenerate only via --update-pin, and only after --online passes.
PINNED_SHA256 = "849815d0665b78fda67a53ba5c32d57433aff448f290a05d1ed2e42a9f8957dc"
PINNED_LENGTH = 5357
MARKER = "# PolyForm Shield License 1.0.0"

# Text that legitimately precedes the licence in our LICENSE file.
# Everything above MARKER is ours; everything below must be canonical.


def fail(msg, code=1):
    print(f"\n  FAIL  {msg}\n")
    sys.exit(code)


def normalise(text):
    """Reduce to comparable form: strip markdown/HTML artefacts and whitespace.

    We compare *words*, not bytes, because the canonical source is HTML and our
    copy is markdown. Emphasis markers, link syntax and line wrapping differ
    legitimately; the words must not.
    """
    text = re.sub(r"<[^>]+>", " ", text)          # html tags
    text = text.replace("&amp;", "&").replace("&quot;", '"')
    text = text.replace("&#39;", "'").replace("&nbsp;", " ")
    text = text.replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # md links -> text
    text = re.sub(r"[*_`#>]", " ", text)          # emphasis, headings, quotes
    text = re.sub(r"\s+", " ", text)
    # Stripping inline tags leaves a space before the punctuation that followed
    # them ("licenses ." from "<a>licenses</a>."). Close those up, or every
    # inline link in the upstream HTML reads as a difference.
    text = re.sub(r"\s+([.,;:!?)\]])", r"\1", text)
    text = re.sub(r"([(\[])\s+", r"\1", text)
    return text.strip().lower()


def extract_licence_body(raw):
    lines = raw.split("\n")
    idx = [i for i, ln in enumerate(lines) if ln.strip() == MARKER]
    if not idx:
        near = [ln.strip() for ln in lines
                if "polyform" in ln.lower() and ln.strip().startswith("#")]
        extra = f"\n        Found instead: {near[0]!r}" if near else ""
        fail(f"Exact heading line not found in LICENSE: {MARKER!r}{extra}\n"
             "        The heading must appear on its own line, unaltered. "
             "Appending\n        anything to it (e.g. '(modified)') "
             "misrepresents the licence.")
    return "\n".join(lines[idx[0] + 1:])


def fetch_canonical():
    try:
        last = None
        for url in (CANONICAL_URL, CANONICAL_URL + "/"):
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "trueexport-license-check"}
                )
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.read().decode("utf-8", errors="replace")
            except Exception as exc:
                last = exc
        raise last
    except Exception as e:
        fail(f"Could not fetch canonical text: {e}\n"
             "        Check network access, then re-run. Do NOT release "
             "without a clean check.", code=2)


START = "in order to get any license"
END = "use means anything you do with the software"


def clip(text, anchored=False):
    """Trim to the licence body, discarding surrounding page furniture."""
    s = text.find(START)
    if s == -1:
        if anchored:
            fail("Could not locate the licence start in the canonical source.\n"
                 "        Upstream layout may have changed. Verify by hand.",
                 code=2)
        fail("LICENSE does not contain the Acceptance clause.")
    text = text[s:]
    e = text.find(END)
    return text[:e + len(END)] if e != -1 else text


def show_diff(expected, actual):
    print("  Differences (canonical -> ours):\n")
    shown = 0
    for line in difflib.unified_diff(expected.split(". "), actual.split(". "),
                                     fromfile="canonical", tofile="ours",
                                     lineterm="", n=1):
        if line.startswith(("---", "+++", "@@")):
            continue
        if line.startswith(("-", "+")):
            print(f"    {line[:200]}")
            shown += 1
            if shown >= 30:
                print("    ... (truncated)")
                break
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--license", default="LICENSE")
    ap.add_argument("--online", action="store_true",
                    help="Also re-verify the pin against polyformproject.org")
    ap.add_argument("--offline-canonical",
                    help="Path to a saved canonical copy")
    ap.add_argument("--update-pin", action="store_true",
                    help="Print a new pin (use only after --online passes)")
    args = ap.parse_args()

    try:
        raw = open(args.license, encoding="utf-8").read()
    except FileNotFoundError:
        fail(f"No such file: {args.license}", code=2)

    print(f"  Checking : {args.license}")

    # --- required notice lines -------------------------------------------
    notices = re.findall(r"^Required Notice:.*$", raw, re.M)
    if not notices:
        fail("No 'Required Notice:' lines found.\n"
             "        These carry your copyright line and the commitments URL "
             "to\n        downstream recipients. Without them the free-tier "
             "promise does\n        not travel with the code.")
    print(f"  Notices  : {len(notices)} found")
    for n in notices:
        print(f"             {n}")
    if not [n for n in notices if "commitments" in n.lower()]:
        print("\n  WARN   No Required Notice line references the commitments "
              "URL.\n         COMMITMENTS.md will not travel with "
              "redistributed copies.")

    ours = clip(normalise(extract_licence_body(raw)))
    digest = hashlib.sha256(ours.encode()).hexdigest()

    if args.update_pin:
        print(f"\n  PINNED_SHA256 = \"{digest}\"\n  PINNED_LENGTH = {len(ours)}\n")
        return 0

    # --- primary check: offline pin (deterministic, CI-safe) -------------
    print(f"  Length   : {len(ours)} (pinned {PINNED_LENGTH})")
    print(f"  SHA-256  : {digest[:16]} (pinned {PINNED_SHA256[:16]})")

    if digest != PINNED_SHA256:
        print("\n  FAIL  LICENCE TEXT HAS DRIFTED FROM THE PINNED CANONICAL "
              "TEXT.\n")
        if args.offline_canonical:
            show_diff(clip(normalise(open(args.offline_canonical,
                                          encoding="utf-8").read())), ours)
        else:
            print("  Re-run with --online to diff against upstream.\n")
        print("  Restore the canonical text before releasing. Additions belong "
              "in\n  COMMITMENTS.md, never in LICENSE.\n")
        return 1

    print("\n  PASS  LICENSE matches pinned PolyForm Shield 1.0.0.")

    if not args.online:
        print("        (offline pin check; use --online to re-verify upstream)\n")
        return 0

    # --- secondary check: is the pin itself still right? -----------------
    print("\n  Re-verifying the pin against upstream...")
    canonical_raw = fetch_canonical()
    theirs = clip(normalise(canonical_raw), anchored=True)
    if theirs == ours:
        print(f"  PASS  Pin confirmed against {CANONICAL_URL}\n")
        return 0
    print(f"\n  FAIL  Upstream text differs from the pin.\n"
          "        Either upstream changed, or this tool's parsing broke.\n"
          "        Do NOT update the pin without checking by hand.\n")
    show_diff(theirs, ours)
    return 1


if __name__ == "__main__":
    sys.exit(main())
