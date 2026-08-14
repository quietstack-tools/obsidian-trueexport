# TrueExport — Obsidian Plugin

## What this is
An Obsidian plugin that exports notes to DOCX, PDF and HTML with high fidelity
to Obsidian-specific Markdown syntax. Full requirements are in TECH_SPEC.md.

## Hard constraints — never violate

- NEVER make network calls except the single documented licence validation
  in src/licence/. No telemetry. No analytics. No update checks. No CDN fetches.
- NEVER read or write files outside the vault, except the user's chosen export
  destination.
- NEVER modify the user's source notes. Export is read-only against the vault.
- NEVER minify or obfuscate build output. Obsidian's automated review rejects it.
- NEVER use eval() or the Function constructor.
- NEVER add a dependency that is not MIT, ISC, BSD or Apache-2.0 licensed.
- NEVER set isDesktopOnly to true in manifest.json.
- NEVER commit main.js.

## Architecture

Pipeline: Markdown → Parser → Intermediate Document Model (IDM) → Renderer → output

- src/core/    Markdown parsing and the IDM. Pure functions, zero I/O, zero Obsidian imports.
- src/docx/    IDM → Word
- src/html/    IDM → HTML
- src/pdf/     IDM → PDF
- src/ui/      Modals and settings. The only place Obsidian UI APIs are used.
- src/licence/ Licence activation. The only place a network call may exist.

Rule: src/core must be testable without Obsidian. If a core file imports from
"obsidian", that is a bug.

## Testing

- Every core function needs a unit test with a passing and a failing case.
- Every supported Markdown construct needs a fixture in tests/fixtures/.
- Run `npm run check` before declaring any task complete.
- Coverage must not fall below the thresholds in vitest.config.ts.

## Code style

- TypeScript strict mode. No `any` without an inline comment justifying it.
- No default exports except the plugin class in main.ts.
- Named exports elsewhere.
- Errors surface to the user via Notice with an actionable message.
  Never fail silently.

## Definition of done

A task is complete when:
1. npm run check passes
2. New code has tests
3. The relevant fixture exports correctly
4. No new ESLint warnings
