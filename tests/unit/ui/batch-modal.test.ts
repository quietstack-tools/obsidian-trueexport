import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { BatchModal, type BatchModalHost } from "../../../src/ui/batch-modal";
import type { BatchResult } from "../../../src/export";

const flush = () => new Promise((r) => setTimeout(r, 0));

function result(over: Partial<BatchResult> = {}): BatchResult {
  return { outputs: ["a.html", "b.html"], warnings: [], failures: [], total: 2, cancelled: false, ...over };
}

describe("BatchModal", () => {
  it("runs the folder export and shows a summary", async () => {
    const host: BatchModalHost = {
      runFolderExport: vi.fn(async (_folder, onProgress) => {
        onProgress(1, 2);
        onProgress(2, 2);
        return result();
      }),
    };
    const modal = new BatchModal(new App(), host, "proj", "proj");
    modal.onOpen();
    await flush();

    expect(host.runFolderExport).toHaveBeenCalled();
    expect(modal.contentEl.textContent).toContain("2 of 2 exported");
  });

  it("offers a Cancel button that aborts the run", async () => {
    let capturedSignal: AbortSignal | undefined;
    const host: BatchModalHost = {
      runFolderExport: vi.fn(async (_folder, _onProgress, signal) => {
        capturedSignal = signal;
        return result({ cancelled: true, outputs: [] });
      }),
    };
    const modal = new BatchModal(new App(), host, "proj", "proj");
    modal.onOpen();
    const cancel = Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    expect(cancel).toBeDefined();
    cancel.click();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
