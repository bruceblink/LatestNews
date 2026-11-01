import type { AppUpdater, CancellationToken } from "electron-updater";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { it, vi, expect, describe, afterEach } from "vitest";
import { rm, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { DesktopUpdateController } from "../electron/updates/update-controller";

const roots: string[] = [];
const controllers: DesktopUpdateController[] = [];
afterEach(async () => {
    for (const controller of controllers.splice(0)) {
        controller.dispose();
    }
    await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    vi.useRealTimers();
});

async function setup(disabledReason?: "development" | "unsupported") {
    const root = await mkdtemp(join(tmpdir(), "it-tools-update-test-"));
    roots.push(root);
    const events = new EventEmitter();
    const updater = Object.assign(events, {
        autoDownload: true,
        autoInstallOnAppQuit: true,
        allowPrerelease: true,
        allowDowngrade: true,
        disableWebInstaller: false,
        disableDifferentialDownload: true,
        checkForUpdates: vi.fn(async () => {
            events.emit("update-available", { version: "1.0.1" });
            return { isUpdateAvailable: true };
        }),
        downloadUpdate: vi.fn(async (_token: CancellationToken) => {
            events.emit("download-progress", { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 });
            events.emit("update-downloaded", { version: "1.0.1" });
            return ["downloaded.exe"];
        }),
        quitAndInstall: vi.fn(),
    });
    const preferencesPath = join(root, "preferences.json");
    const controller = new DesktopUpdateController({
        updater: updater as unknown as AppUpdater,
        currentVersion: "1.0.0",
        preferencesPath,
        disabledReason,
    });
    controllers.push(controller);
    return { controller, updater, preferencesPath };
}

describe("desktop update lifecycle", () => {
    it("checks once, downloads only on request, and installs only after download", async () => {
        const { controller, updater, preferencesPath } = await setup();
        await controller.initialize();
        controller.install();
        expect(updater.quitAndInstall).not.toHaveBeenCalled();
        const states: string[] = [];
        const unsubscribe = controller.subscribe((state) => states.push(state.status));
        const first = controller.check();
        expect(controller.check()).toBe(first);
        await first;
        expect(updater.autoDownload).toBe(false);
        expect(updater.autoInstallOnAppQuit).toBe(false);
        expect(updater.allowPrerelease).toBe(false);
        expect(updater.allowDowngrade).toBe(false);
        expect(updater.disableDifferentialDownload).toBe(false);
        expect(updater.downloadUpdate).not.toHaveBeenCalled();
        expect(JSON.parse(await readFile(preferencesPath, "utf8")).autoCheck).toBe(true);
        await controller.download();
        expect(states).toContain("downloading");
        expect(controller.getState()).toMatchObject({ status: "downloaded", availableVersion: "1.0.1" });
        controller.install();
        controller.install();
        expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
        unsubscribe();
    });

    it("cancels an active download and creates a fresh token for retry", async () => {
        const { controller, updater } = await setup();
        await controller.initialize();
        await controller.check();
        let firstToken: CancellationToken | undefined;
        updater.downloadUpdate.mockImplementationOnce((token) => {
            firstToken = token;
            return new Promise((_resolve, reject) => {
                token.once("cancel", () => reject(new Error("cancelled")));
            });
        });
        const pending = controller.download();
        controller.cancel();
        expect(await pending).toMatchObject({ status: "available" });
        expect(firstToken?.cancelled).toBe(true);
        await controller.download();
        expect(updater.downloadUpdate.mock.calls[1][0]).not.toBe(firstToken);
        expect(controller.getState().status).toBe("downloaded");
    });

    it("keeps errors visible and allows checking again after a failed request", async () => {
        const { controller, updater } = await setup();
        await controller.initialize();
        updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
        expect(await controller.check()).toMatchObject({ status: "error", error: "check-failed" });
        expect(await controller.check()).toMatchObject({ status: "available", error: undefined });
        updater.downloadUpdate.mockRejectedValueOnce(new Error("bad digest"));
        expect(await controller.download()).toMatchObject({ status: "error", error: "download-failed" });
        expect(await controller.download()).toMatchObject({ status: "downloaded", error: undefined });
    });

    it("persists opt-out and keeps development builds offline", async () => {
        const { controller, updater, preferencesPath } = await setup("development");
        await controller.initialize();
        await controller.setAutoCheck(false);
        expect(JSON.parse(await readFile(preferencesPath, "utf8")).autoCheck).toBe(false);
        expect(await controller.check()).toMatchObject({ status: "disabled", disabledReason: "development" });
        expect(updater.checkForUpdates).not.toHaveBeenCalled();
    });

    it("reads stored opt-out, and does not silently use a malformed setting", async () => {
        const { controller, updater, preferencesPath } = await setup();
        await writeFile(preferencesPath, '{"version":1,"autoCheck":false}\n');
        await controller.initialize();
        expect(controller.getState().autoCheck).toBe(false);
        vi.useFakeTimers();
        await vi.advanceTimersByTimeAsync(5000);
        expect(updater.checkForUpdates).not.toHaveBeenCalled();
        const second = await setup();
        await writeFile(second.preferencesPath, '{"version":1,"autoCheck":"yes"}');
        await second.controller.initialize();
        expect(second.controller.getState()).toMatchObject({ autoCheck: false, error: "settings-failed" });
    });

    it("cleans updater listeners and cancels downloads on shutdown", async () => {
        const { controller, updater } = await setup();
        await controller.initialize();
        expect(updater.listenerCount("error")).toBe(1);
        controller.dispose();
        expect(updater.listenerCount("error")).toBe(0);
        expect(updater.listenerCount("download-progress")).toBe(0);
    });
});
