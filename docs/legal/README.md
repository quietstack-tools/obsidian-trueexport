# Licence verification

This directory holds the tool used to verify TrueExport's licence file.

## `verify-license.py`

`LICENSE` at the repository root is the **PolyForm Shield License 1.0.0**.
TrueExport's licensing depends on that text being the canonical, unmodified
licence: if it silently drifts — an autoformatter, a stray edit, an
over-eager find-and-replace — it stops being a recognised standard licence and
quietly becomes a bespoke one.

`verify-license.py` confirms `LICENSE` still matches PolyForm Shield 1.0.0. Its
primary check is **offline**: a SHA-256 pin of the normalised licence body, so
it needs no network access and is safe to run in CI.

```sh
# Offline check (default): compare LICENSE against the pinned canonical text.
python3 docs/legal/verify-license.py --license LICENSE

# Also re-verify the pin against polyformproject.org.
python3 docs/legal/verify-license.py --license LICENSE --online
```

Exit codes: `0` = clean, `1` = drift, `2` = could not check.
