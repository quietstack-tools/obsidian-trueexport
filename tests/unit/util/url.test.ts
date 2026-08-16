import { describe, it, expect } from "vitest";
import { safeExternalUrl, safeRemoteImageUrl, isBlockedHost } from "../../../src/core/util/url";

describe("safeExternalUrl", () => {
  it("keeps allowed schemes and relative/anchor URLs", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com");
    expect(safeExternalUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeExternalUrl("tel:+15551234")).toBe("tel:+15551234");
    expect(safeExternalUrl("#heading")).toBe("#heading");
    expect(safeExternalUrl("../other/file.png")).toBe("../other/file.png");
  });

  it("rejects script-bearing and local schemes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("defeats control-char obfuscation of the scheme", () => {
    expect(safeExternalUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeExternalUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeExternalUrl("  javascript:alert(1)")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
  });
});

describe("safeRemoteImageUrl / isBlockedHost", () => {
  it("allows http/https to public hosts", () => {
    expect(safeRemoteImageUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(safeRemoteImageUrl("http://cdn.example.org/x.jpg")).toBe("http://cdn.example.org/x.jpg");
  });

  it("rejects non-http(s) schemes", () => {
    expect(safeRemoteImageUrl("ftp://example.com/a.png")).toBeNull();
    expect(safeRemoteImageUrl("file:///a.png")).toBeNull();
    expect(safeRemoteImageUrl("not a url")).toBeNull();
  });

  it("blocks loopback, private and link-local targets (SSRF)", () => {
    expect(safeRemoteImageUrl("http://localhost/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://127.0.0.1/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(safeRemoteImageUrl("http://10.0.0.5/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://172.16.0.1/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://192.168.1.1/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://[::1]/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://internal.host.internal/x.png")).toBeNull();
  });

  it("isBlockedHost distinguishes public from private hosts", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("100.64.0.1")).toBe(true);
    expect(isBlockedHost("fd00::1")).toBe(true);
    expect(isBlockedHost("fe80::1")).toBe(true);
  });

  // Finding #2: numeric IP encodings that bypass a naive dotted-decimal check.
  // isBlockedHost must reject these even when handed the RAW (un-normalised)
  // hostname — it must not rely on a URL parser having canonicalised first.
  it("isBlockedHost rejects non-canonical numeric IP encodings (SSRF bypass)", () => {
    // Bare 32-bit decimal integer (2130706433 = 127.0.0.1, 3232235521 = 192.168.0.1).
    expect(isBlockedHost("2130706433")).toBe(true);
    expect(isBlockedHost("3232235521")).toBe(true);
    // 0x-hex, whole and dotted.
    expect(isBlockedHost("0x7f000001")).toBe(true);
    expect(isBlockedHost("0x7f.0.0.1")).toBe(true);
    // Octal (leading zero on a segment).
    expect(isBlockedHost("0177.0.0.1")).toBe(true);
    expect(isBlockedHost("010.0.0.1")).toBe(true);
    // Shorthand / partial forms.
    expect(isBlockedHost("127.1")).toBe(true);
    expect(isBlockedHost("127.0.1")).toBe(true);
    // Malformed all-numeric shapes (too many parts / out of range).
    expect(isBlockedHost("1.2.3.4.5")).toBe(true);
    expect(isBlockedHost("999.1.1.1")).toBe(true);
  });

  it("isBlockedHost still treats canonical dotted-decimal exactly as before", () => {
    // Public → allowed.
    expect(isBlockedHost("93.184.216.34")).toBe(false);
    expect(isBlockedHost("1.1.1.1")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    // Private / loopback / link-local → blocked.
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.0.0.5")).toBe(true);
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    // "0" is a legal canonical part (0.0.0.0 is this-host → blocked), and a
    // leading-zero MULTI-digit part is octal → rejected, not read as decimal.
    expect(isBlockedHost("0.0.0.0")).toBe(true);
  });

  it("isBlockedHost leaves ordinary DNS names with numeric labels alone", () => {
    expect(isBlockedHost("cdn.example.org")).toBe(false);
    expect(isBlockedHost("v1.api.example.com")).toBe(false);
    expect(isBlockedHost("123.example.com")).toBe(false); // not ALL-numeric labels
    expect(isBlockedHost("img-3.hosting.net")).toBe(false);
  });

  it("safeRemoteImageUrl blocks encoded loopback forms end-to-end", () => {
    // The URL parser normalises these to 127.0.0.1, which isBlockedHost then
    // refuses — belt-and-suspenders with the hardening above.
    expect(safeRemoteImageUrl("http://2130706433/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://0x7f000001/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://0177.0.0.1/x.png")).toBeNull();
    expect(safeRemoteImageUrl("http://127.1/x.png")).toBeNull();
  });
});
