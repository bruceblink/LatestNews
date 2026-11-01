import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";

import { dirname } from "node:path";
import { mkdir, rename, readFile, writeFile } from "node:fs/promises";
import { type AppUpdater, CancellationToken } from "electron-updater";

import type { DesktopUpdateState } from "../../shared/desktop-updates";

type Updater = Pick<
    AppUpdater,
    | "on"
    | "removeListener"
    | "checkForUpdates"
    | "downloadUpdate"
    | "quitAndInstall"
    | "autoDownload"
    | "autoInstallOnAppQuit"
    | "allowPrerelease"
    | "allowDowngrade"
    | "disableDifferentialDownload"
    | "disableWebInstaller"
>;

interface Options {
    updater: Updater;
    currentVersion: string;
    preferencesPath: string;
    disabledReason?: DesktopUpdateState["disabledReason"];
}

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/** Owns one update operation. Downloaded files stay in the updater cache until explicit installation. */
export class DesktopUpdateController {
    private state: DesktopUpdateState;
    private operation: Promise<DesktopUpdateState> | undefined;
    private cancellation: CancellationToken | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private preferenceWrite: Promise<void> = Promise.resolve();
    private listeners = new Set<(state: DesktopUpdateState) => void>();
    private removeUpdaterListeners: (() => void)[] = [];

    constructor(private readonly options: Options) {
        this.state = {
            currentVersion: options.currentVersion,
            autoCheck: true,
            status: options.disabledReason ? "disabled" : "idle",
            disabledReason: options.disabledReason,
        };
        const updater = options.updater;
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.allowPrerelease = false;
        updater.allowDowngrade = false;
        updater.disableWebInstaller = true;
        updater.disableDifferentialDownload = false;
        this.listen("update-available", (info) => {
            this.publish({ status: "available", availableVersion: info.version, error: undefined });
        });
        this.listen("update-not-available", () => {
            this.publish({ status: "not-available", availableVersion: undefined, error: undefined });
        });
        this.listen("download-progress", ({ percent, transferred, total, bytesPerSecond }) => {
            this.publish({ status: "downloading", progress: { percent, transferred, total, bytesPerSecond } });
        });
        this.listen("update-downloaded", (info) => {
            this.publish({
                status: "downloaded",
                availableVersion: info.version,
                progress: undefined,
                error: undefined,
            });
        });
        this.listen("update-cancelled", () => {
            this.publish({ status: "available", progress: undefined, error: undefined });
        });
        this.listen("error", () => {
            if (this.cancellation?.cancelled) {
                return;
            }
            const error =
                this.state.status === "installing"
                    ? "install-failed"
                    : this.cancellation
                      ? "download-failed"
                      : "check-failed";
            this.publish({ status: "error", progress: undefined, error });
        });
    }

    async initialize(): Promise<void> {
        try {
            const stored: unknown = JSON.parse(await readFile(this.options.preferencesPath, "utf8"));
            if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
                throw new Error("Invalid update preferences.");
            }
            const value = stored as { version?: unknown; autoCheck?: unknown };
            if (value.version !== 1 || typeof value.autoCheck !== "boolean") {
                throw new Error("Invalid update preferences.");
            }
            this.publish({ autoCheck: value.autoCheck });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                // A broken setting never starts background network access without a readable preference.
                this.publish({ autoCheck: false, error: "settings-failed" });
            }
        }
        this.schedule(3000);
    }

    getState(): DesktopUpdateState {
        return structuredClone(this.state);
    }

    subscribe(listener: (state: DesktopUpdateState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async setAutoCheck(enabled: boolean): Promise<DesktopUpdateState> {
        const previous = this.state.autoCheck;
        this.publish({ autoCheck: enabled });
        try {
            await this.persist();
            this.publish({ error: undefined });
            this.schedule(3000);
        } catch {
            this.publish({ autoCheck: previous, error: "settings-failed" });
        }
        return this.getState();
    }

    check(): Promise<DesktopUpdateState> {
        if (this.operation) {
            return this.operation;
        }
        if (
            this.state.status === "disabled" ||
            this.state.status === "downloaded" ||
            this.state.status === "installing"
        ) {
            return Promise.resolve(this.getState());
        }
        this.publish({ status: "checking", availableVersion: undefined, progress: undefined, error: undefined });
        this.cancellation = undefined;
        this.operation = this.runCheck().finally(() => {
            this.operation = undefined;
        });
        return this.operation;
    }

    download(): Promise<DesktopUpdateState> {
        if (this.operation) {
            return this.operation;
        }
        if (!this.state.availableVersion || !["available", "error"].includes(this.state.status)) {
            return Promise.resolve(this.getState());
        }
        this.cancellation = new CancellationToken();
        this.publish({ status: "downloading", progress: undefined, error: undefined });
        this.operation = this.runDownload().finally(() => {
            this.operation = undefined;
        });
        return this.operation;
    }

    cancel(): DesktopUpdateState {
        if (this.state.status === "downloading") {
            this.cancellation?.cancel();
        }
        return this.getState();
    }

    install(): DesktopUpdateState {
        if (this.state.status !== "downloaded" && this.state.error !== "install-failed") {
            return this.getState();
        }
        this.publish({ status: "installing", error: undefined });
        try {
            this.options.updater.quitAndInstall(true, true);
        } catch {
            this.publish({ status: "error", error: "install-failed" });
        }
        return this.getState();
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
        this.cancellation?.cancel();
        const removeListeners = () => {
            for (const remove of this.removeUpdaterListeners.splice(0)) {
                remove();
            }
        };
        // Keep the error listener until a cancelled operation has finished emitting its final events.
        if (this.operation) {
            void this.operation.finally(removeListeners);
        } else {
            removeListeners();
        }
        this.listeners.clear();
    }

    private async runCheck(): Promise<DesktopUpdateState> {
        try {
            const result = await this.options.updater.checkForUpdates();
            if (!result) {
                this.publish({ status: "disabled", disabledReason: "unsupported" });
            } else {
                this.publish({ lastCheckedAt: Date.now() });
                try {
                    await this.persist();
                } catch {
                    this.publish({ error: "settings-failed" });
                }
            }
        } catch {
            this.publish({ status: "error", error: "check-failed" });
        }
        return this.getState();
    }

    private async runDownload(): Promise<DesktopUpdateState> {
        const token = this.cancellation!;
        try {
            await this.options.updater.downloadUpdate(token);
        } catch {
            this.publish(
                token.cancelled
                    ? { status: "available", progress: undefined, error: undefined }
                    : { status: "error", progress: undefined, error: "download-failed" }
            );
        }
        if (token.cancelled) {
            this.cancellation = undefined;
        } else if (this.state.status !== "downloading") {
            this.cancellation = undefined;
        }
        return this.getState();
    }

    private persist(): Promise<void> {
        const path = this.options.preferencesPath;
        const content = `${JSON.stringify({ version: 1, autoCheck: this.state.autoCheck })}\n`;
        this.preferenceWrite = this.preferenceWrite
            .catch(() => {})
            .then(async () => {
                await mkdir(dirname(path), { recursive: true });
                await writeFile(`${path}.tmp`, content, { encoding: "utf8", mode: 0o600 });
                await rename(`${path}.tmp`, path);
            });
        return this.preferenceWrite;
    }

    private schedule(delay: number): void {
        clearTimeout(this.timer);
        if (this.disposed || !this.state.autoCheck || this.state.status === "disabled") {
            return;
        }
        this.timer = setTimeout(() => {
            const elapsed = Date.now() - (this.state.lastCheckedAt ?? 0);
            if (elapsed < 0 || elapsed >= CHECK_INTERVAL) {
                void this.check().finally(() => this.schedule(60 * 60 * 1000));
            } else {
                this.schedule(60 * 60 * 1000);
            }
        }, delay);
        this.timer.unref();
    }

    private publish(change: Partial<DesktopUpdateState>): void {
        if (this.disposed) {
            return;
        }
        this.state = { ...this.state, ...change };
        for (const listener of this.listeners) {
            listener(this.getState());
        }
    }

    private listen<E extends keyof AppUpdaterEvents>(event: E, listener: AppUpdaterEvents[E]): void {
        this.options.updater.on(event, listener);
        this.removeUpdaterListeners.push(() => this.options.updater.removeListener(event, listener));
    }
}
