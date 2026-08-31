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

  it("relabels the button from Cancel to Close once the export has finished, and closes on click with no side effects", async () => {
    const host: BatchModalHost = {
      runFolderExport: vi.fn(async () => result()),
    };
    const modal = new BatchModal(new App(), host, "proj", "proj");
    modal.onOpen();
    await flush();

    // No stray "Cancel" button left over once the batch is done.
    const buttons = Array.from(modal.contentEl.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toEqual(["Close"]);

    const close = modal.contentEl.querySelector("button")!;
    close.click();
    expect((modal as unknown as { isOpen: boolean }).isOpen).toBe(false);
  });

  it("still reads Cancel while the export is in progress", async () => {
    let resolveRun: (() => void) | undefined;
    const host: BatchModalHost = {
      runFolderExport: vi.fn(
        () =>
          new Promise<BatchResult>((resolve) => {
            resolveRun = () => resolve(result());
          }),
      ),
    };
    const modal = new BatchModal(new App(), host, "proj", "proj");
    modal.onOpen();
    await flush();

    const button = modal.contentEl.querySelector("button")!;
    expect(button.textContent).toBe("Cancel");

    resolveRun?.();
    await flush();
    expect(button.textContent).toBe("Close");
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
