// site/pages.mjs — the single list of published documents, shared by the build
// script (site/build.mjs) and the drift check (site/check-live.mjs) so the two
// can never disagree about which pages exist, where they come from, or where
// they are served.
//
// - `source`  : markdown file at the repository root (the canonical source).
// - `out`     : output path relative to site/public/ (a FLAT file, so Cloudflare
//               Pages serves the clean URL as a bare 200, not a 308 to a dir).
// - `url`     : the live URL the page must resolve at, exactly as other
//               documents reference it.
// - `title`   : the HTML <title>.

export const PAGES = [
  {
    source: "COMMITMENTS.md",
    out: "trueexport/commitments.html",
    url: "https://quietstack.tools/trueexport/commitments",
    title: "TrueExport Free Feature Commitment",
  },
  {
    source: "PRO_TERMS.md",
    out: "trueexport/terms.html",
    url: "https://quietstack.tools/trueexport/terms",
    title: "TrueExport Pro — Terms of Purchase and Use",
  },
  {
    source: "PRIVACY.md",
    out: "privacy.html",
    url: "https://quietstack.tools/privacy",
    title: "TrueExport — Privacy Policy",
  },
];
