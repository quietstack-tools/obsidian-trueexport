# TrueExport

Export Obsidian notes to Word, PDF and HTML that open correctly everywhere.

🚧 **In development. Not yet released.**

## Privacy

TrueExport processes your notes entirely on your device. Note content is
never transmitted anywhere.

The plugin makes network requests in exactly two situations, and no others
(no telemetry, analytics, update checks or CDN fetches):

1. **Licence activation** — a one-time licence key validation when you click
   Activate on a Pro licence. It sends only the key you typed, never note
   content, and is never sent again after activation.
2. **Remote images (off by default)** — if, and only if, you enable "Allow
   remote images" in settings, TrueExport fetches `http(s)` image URLs found
   in a note while exporting it, so they can be embedded. It is disabled by
   default; when disabled, remote images are shown as a placeholder instead.

## Licence

See LICENSE. (Pending legal review — do not distribute before this is in place.)
