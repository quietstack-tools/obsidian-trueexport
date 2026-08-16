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
});
