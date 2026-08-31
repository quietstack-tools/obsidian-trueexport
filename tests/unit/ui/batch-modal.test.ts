import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { noticeLog } from "../../mocks/obsidian";
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

  it("D22: does NOT abort the export when the modal's DOM goes away for a reason other than clicking Cancel", async () => {
    // Obsidian's default click-outside-to-dismiss (or any other cause) calls
    // the exact same close() path as an explicit user action — from the
    // modal's own perspective there is no way to distinguish "user clicked
    // Cancel" from "user clicked away/navigated elsewhere". Simulating it via
    // close() directly is therefore a faithful reproduction of the reported
    // bug (switching notes in the sidebar while a batch export runs), not a
    // synthetic case only the Cancel button can trigger.
    let capturedSignal: AbortSignal | undefined;
    let resolveRun: (() => void) | undefined;
    const host: BatchModalHost = {
      runFolderExport: vi.fn(
        (_folder, _onProgress, signal) =>
          new Promise<BatchResult>((resolve) => {
            capturedSignal = signal;
            resolveRun = () => resolve(result());
          }),
      ),
    };
    const modal = new BatchModal(new App(), host, "proj", "proj");
    modal.onOpen();
    await flush();

    modal.close(); // ordinary dismissal, NOT the Cancel button
    expect(capturedSignal?.aborted).toBe(false);

    // The export keeps running to completion in the background.
    resolveRun?.();
    await flush();
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("D22: surfaces the completed result via a Notice when the modal was already dismissed", async () => {
    let resolveRun: (() => void) | undefined;
    const host: BatchModalHost = {
      runFolderExport: vi.fn(
        () =>
          new Promise<BatchResult>((resolve) => {
            resolveRun = () => resolve(result({ outputs: ["a.html"], total: 2 }));
          }),
      ),
    };
    const modal = new BatchModal(new App(), host, "proj", "proj");
    modal.onOpen();
    await flush();

    const noticesBefore = noticeLog.length;
    modal.close();
    resolveRun?.();
    await flush();

    expect(noticeLog.length).toBeGreaterThan(noticesBefore);
    expect(noticeLog[noticeLog.length - 1]).toContain("1 of 2 exported");
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
