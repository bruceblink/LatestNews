import { resolve } from "node:path";
import updaterPackage from "electron-updater";
import { app, dialog, ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import { isTrustedRendererUrl } from "../security";
import { DesktopUpdateController } from "./update-controller";

/** Only the current main window can request an update; feeds and file paths never come from IPC. */
export async function registerUpdateIpc(options: {
    getMainWindow(): BrowserWindow | null;
    trustedRendererUrl(): string;
}) {
    const { autoUpdater } = updaterPackage;
    autoUpdater.channel = "latest";
    autoUpdater.previousBlockmapBaseUrlOverride = `https://github.com/bruceblink/latestnews/releases/download/v${app.getVersion()}/`;
    const controller = new DesktopUpdateController({
        updater: autoUpdater,
        currentVersion: app.getVersion(),
        preferencesPath: resolve(app.getPath("userData"), "app-update-preferences.json"),
        disabledReason: !app.isPackaged
            ? "development"
            : !["win32", "darwin", "linux"].includes(process.platform)
              ? "unsupported"
              : undefined,
    });
    let confirmingInstall = false;
    let notifiedVersion: string | undefined;
    let notification: Notification | undefined;
    const handlers = {
        "desktop:updates:state": () => controller.getState(),
        "desktop:updates:auto-check": (_event: IpcMainInvokeEvent, enabled: unknown) => {
            if (typeof enabled !== "boolean") throw new Error("Invalid automatic update setting.");
            return controller.setAutoCheck(enabled);
        },
        "desktop:updates:check": () => controller.check(),
        "desktop:updates:download": () => controller.download(),
        "desktop:updates:cancel": () => controller.cancel(),
        "desktop:updates:install": async () => {
            const state = controller.getState();
            const window = options.getMainWindow();
            if (confirmingInstall || !window || (state.status !== "downloaded" && state.error !== "install-failed")) {
                return state;
            }
            confirmingInstall = true;
            try {
                const { response } = await dialog.showMessageBox(window, {
                    type: "question",
                    title: "安装更新",
                    message: "保存当前工作并退出安装更新？",
                    detail: "LatestNews 将关闭并启动更新。安装后重新打开应用。",
                    buttons: ["取消", "退出并安装"],
                    defaultId: 0,
                    cancelId: 0,
                });
                return response === 1 ? controller.install() : controller.getState();
            } finally {
                confirmingInstall = false;
            }
        },
    };
    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, (event, ...args: unknown[]) => {
            if (
                event.sender !== options.getMainWindow()?.webContents ||
                event.senderFrame !== event.sender.mainFrame ||
                !isTrustedRendererUrl(event.senderFrame.url, options.trustedRendererUrl())
            ) {
                throw new Error("Untrusted application update request.");
            }
            return (handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)(event, ...args);
        });
    }
    const unsubscribe = controller.subscribe((state) => {
        const window = options.getMainWindow();
        if (window && !window.isDestroyed()) window.webContents.send("desktop:updates:changed", state);
        if (state.status === "available" && state.availableVersion !== notifiedVersion && Notification.isSupported()) {
            notifiedVersion = state.availableVersion;
            notification?.close();
            notification = new Notification({
                title: "LatestNews 更新",
                body: `${state.availableVersion} 已可下载。打开设置查看。`,
            });
            notification.on("click", () => {
                const current = options.getMainWindow();
                if (current && !current.isDestroyed()) {
                    current.show();
                    current.focus();
                    void current.loadURL(new URL("settings", options.trustedRendererUrl()).href);
                }
            });
            notification.show();
        }
    });
    await controller.initialize();
    return {
        getState: () => controller.getState(),
        shutdown() {
            unsubscribe();
            notification?.close();
            controller.dispose();
            for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
        },
    };
}
