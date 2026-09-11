import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { ObsidianVaultAdapter, isMermaidDiagramSvg, waitForRenderedSvg } from "../../src/obsidian-adapter";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgFragment(inner: string, attrs: Record<string, string> = {}): SVGElement {
  const wrapper = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries(attrs)) wrapper.setAttribute(k, v);
  wrapper.innerHTML = inner;
  return wrapper;
}

// The mock App carries extra test-only fields (vault.notes, metadataCache
// .resolver) that the real Obsidian types don't declare, so it's typed loosely.
function makeApp(): any {
  const app: any = new App();
  app.vault.notes.set("folder/Note.md", "note body");
  app.vault.notes.set("folder/Other.md", "other body");
  app.vault.binaries.set("img/pic.png", new TextEncoder().encode("PNG").buffer);
  // Simulate Obsidian's shortest-unique-path resolution by basename.
  app.metadataCache.resolver = (linkpath: string): string | null => {
    const match = Array.from(app.vault.notes.keys() as string[]).find(
      (p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "") === linkpath,
    );
    return match ?? null;
  };
  return app;
}

describe("ObsidianVaultAdapter", () => {
  it("reads a note's content, or null when absent", async () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(await adapter.readNote("folder/Note.md")).toBe("note body");
    expect(await adapter.readNote("missing.md")).toBeNull();
  });

  it("reads binary content, or null when absent", async () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    const bytes = await adapter.readBinary("img/pic.png");
    expect(bytes).not.toBeNull();
    expect(await adapter.readBinary("img/nope.png")).toBeNull();
  });

  it("resolves a wikilink via Obsidian's own resolver", () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(adapter.resolveLink("Note", "folder/Other.md")).toBe("folder/Note.md");
  });

  it("strips subpath and alias before resolving", () => {
    const app = makeApp();
    let received = "";
    app.metadataCache.resolver = (linkpath: string): string | null => {
      received = linkpath;
      return "folder/Note.md";
    };
    const adapter = new ObsidianVaultAdapter(app);
    adapter.resolveLink("Note#Heading|Alias", "folder/Other.md");
    expect(received).toBe("Note");
  });

  it("returns null for an unresolvable or empty link", () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(adapter.resolveLink("Ghost", "folder/Other.md")).toBeNull();
    expect(adapter.resolveLink("   ", "folder/Other.md")).toBeNull();
  });

  it("maps MIME types by extension", () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(adapter.getMimeType("a/b.PNG")).toBe("image/png");
    expect(adapter.getMimeType("c.svg")).toBe("image/svg+xml");
    expect(adapter.getMimeType("x.unknown")).toBe("application/octet-stream");
  });

  it("lists markdown files under a folder, sorted", async () => {
    const app = makeApp();
    app.vault.notes.set("elsewhere/Z.md", "z");
    const adapter = new ObsidianVaultAdapter(app);
    expect(await adapter.listNotesInFolder("folder")).toEqual(["folder/Note.md", "folder/Other.md"]);
  });
});

// isMermaidDiagramSvg() can't drive Obsidian's real mermaid rendering in
// tests, but the classification logic is plain DOM inspection and fully
// testable with jsdom — see the doc comment on createMermaidRenderer() in
// src/obsidian-adapter.ts for why this exists: an early polling fix
// accepted any <svg> with child elements, which also matched a generic
// broken-image/placeholder icon (real path children, no mermaid markers,
// no text) captured while mermaid was still initialising.
describe("isMermaidDiagramSvg", () => {
  it("accepts a real mermaid flowchart svg (id marker + node/edge classes + text labels)", () => {
    const svg = svgFragment(
      '<g class="root"><g class="node" id="A"><rect/><text>Start</text></g>' +
        '<g class="edgePath"><path/></g><g class="node" id="B"><rect/><text>Decision</text></g></g>',
      { id: "mermaid-svg-1" },
    );
    expect(isMermaidDiagramSvg(svg)).toBe(true);
  });

  it("accepts mermaid output identified by the svg's own class alone (no id), given text content", () => {
    const svg = svgFragment('<g><rect/><text>Only node</text></g>', { class: "mermaid-diagram" });
    expect(isMermaidDiagramSvg(svg)).toBe(true);
  });

  it("also accepts identification via node/edge descendant classes alone (no id/class marker on the svg itself)", () => {
    const svg = svgFragment('<g class="node"><rect/><text>Only node</text></g>');
    expect(isMermaidDiagramSvg(svg)).toBe(true);
  });

  it("rejects a generic icon svg — has real path children, but no mermaid marker and no text", () => {
    // Mirrors the actual observed failure: a broken-image/placeholder icon
    // is a real <svg> with real <path> children (satisfying a naive "has
    // children" check) but is not mermaid output at all.
    const svg = svgFragment('<path d="M2 2h20v20H2z"/><path d="M2 22 22 2"/>', { class: "lucide lucide-image-off" });
    expect(isMermaidDiagramSvg(svg)).toBe(false);
  });

  it("rejects an svg with mermaid markers but no text (e.g. a still-rendering skeleton)", () => {
    const svg = svgFragment('<g class="node"><rect/></g>', { id: "mermaid-svg-2" });
    expect(isMermaidDiagramSvg(svg)).toBe(false);
  });

  it("rejects an svg with text but no mermaid markers (e.g. an unrelated icon with a label)", () => {
    const svg = svgFragment("<text>Loading…</text>");
    expect(isMermaidDiagramSvg(svg)).toBe(false);
  });

  it("accepts a real captured mermaid flowchart svg — id/class carry no literal 'mermaid' substring, labels are HTML <p> inside <foreignObject>, not SVG <text>", () => {
    // Reconstructed from ground truth captured via Obsidian's dev tools:
    // id="m<hash>" class="flowchart", node/edge/cluster/label descendant
    // classes present, no <text>/<tspan> anywhere — labels are
    // foreignObject-embedded HTML. The original querySelector("text,
    // tspan") check rejected this real, valid diagram.
    const svg = svgFragment(
      '<g class="root">' +
        '<g class="clusters"></g>' +
        '<g class="edgePaths"><path class="edge-thickness-normal"/></g>' +
        '<g class="edgeLabels"><g class="edgeLabel"><foreignObject><div><span class="edgeLabel">Yes</span></div></foreignObject></g></g>' +
        '<g class="nodes">' +
        '<g class="node default"><rect/><foreignObject><div class="nodeLabel"><p>Start</p></div></foreignObject></g>' +
        '<g class="node default"><rect/><foreignObject><div class="nodeLabel"><p>Decision</p></div></foreignObject></g>' +
        "</g>" +
        "</g>",
      { id: "m0cd67588838a1682", class: "flowchart" },
    );
    expect(svg.id.toLowerCase()).not.toContain("mermaid");
    expect((svg.getAttribute("class") ?? "").toLowerCase()).not.toContain("mermaid");
    expect(svg.querySelector("text, tspan")).toBeNull(); // the old, wrong check would have failed here
    expect(isMermaidDiagramSvg(svg)).toBe(true);
  });
});

describe("waitForRenderedSvg", () => {
  it("finds the real mermaid diagram even when it isn't the first <svg> in the container", async () => {
    const container = document.createElement("div");
    // A decoy icon svg (e.g. a toolbar/zoom control) appears first in
    // document order — the old el.querySelector("svg") (first match) would
    // have grabbed this instead of the real diagram.
    const icon = svgFragment('<path d="M2 2h20v20H2z"/>', { class: "lucide lucide-maximize" });
    const diagram = svgFragment('<g class="node"><rect/><text>Start</text></g>', {
      id: "m0cd67588838a1682",
      class: "flowchart",
    });
    container.appendChild(icon);
    container.appendChild(diagram);

    const found = await waitForRenderedSvg(container);
    expect(found).toBe(diagram);
  });

  it("gives up and returns null if no svg in the container is ever a real diagram", async () => {
    const container = document.createElement("div");
    container.appendChild(svgFragment('<path d="M2 2h20v20H2z"/>', { class: "lucide lucide-image-off" }));
    const found = await waitForRenderedSvg(container);
    expect(found).toBeNull();
  }, 3000);
});
