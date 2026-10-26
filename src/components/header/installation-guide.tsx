import type { RefObject } from "react";

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Version, HOME_PAGE, PROJECT_URL } from "@shared/consts";

type DesktopSystem = "windows" | "macos" | "linux";
type BrowserSystem = "chromium" | "android" | "ios" | "safari" | "other";

const desktopSteps: Record<DesktopSystem, { files: string; steps: string[] }> = {
    windows: {
        files: "Windows-x64.exe / Windows-arm64.exe",
        steps: [
            "在系统设置的“系统信息”中查看系统类型：Intel / AMD 通常选 x64，ARM 设备选 arm64。",
            "打开已发布版本，下载对应的 Windows .exe 安装包。",
            "运行安装程序，选择安装目录。完成后从桌面或开始菜单打开 LatestNews。",
        ],
    },
    macos: {
        files: "macOS-arm64.dmg / macOS-x64.dmg",
        steps: [
            "在“关于本机”查看芯片：Apple 芯片选 arm64，Intel 处理器选 x64。",
            "打开已发布版本，下载对应的 macOS .dmg 文件。",
            "打开 DMG，将 LatestNews 拖入“应用程序”，再从“应用程序”启动。",
        ],
    },
    linux: {
        files: "Linux-x86_64.AppImage / Linux-arm64.AppImage / .deb",
        steps: [
            "按系统架构选择 x86_64 / amd64 或 arm64。",
            "下载 AppImage，或在 Debian / Ubuntu 上选择对应的 .deb 包。",
            "在文件属性中允许 AppImage 作为程序执行后打开；.deb 包可用系统软件安装器安装。",
        ],
    },
};

const browserSteps: Record<BrowserSystem, string[]> = {
    chromium: [
        "使用 Chrome 或 Edge 打开当前网站。",
        "Chrome：打开浏览器菜单，选择“投放、保存和分享”中的“将网页安装为应用”；也可使用地址栏的安装图标。",
        "Edge：打开浏览器菜单中的“应用”，选择“将此站点作为应用安装”。安装后从桌面或应用列表启动。",
    ],
    android: [
        "在 Android 的 Chrome 中打开当前网站。",
        "打开浏览器菜单，选择“添加到主屏幕”或“安装应用”，按提示确认。",
        "安装后，从主屏幕或应用列表打开 LatestNews。",
    ],
    ios: [
        "在 iPhone 或 iPad 的 Safari 中打开当前网站。",
        "打开“分享”菜单，选择“添加到主屏幕”。如果没有显示此选项，可在分享菜单中编辑操作。",
        "如果显示“作为 Web App 打开”，将其打开，再点“添加”。",
    ],
    safari: [
        "在 Mac 的 Safari 中打开当前网站。",
        "如果“文件”菜单提供“添加到程序坞”，选择该项并确认。",
        "如果浏览器没有安装入口，可直接使用网页，或下载桌面客户端。",
    ],
    other: [
        "可以直接使用当前网页，无需安装。",
        "如需浏览器应用，请在 Chrome、Edge 或 Safari 中打开当前网站，并使用浏览器的安装或添加到主屏幕入口。",
        "手机内置浏览器没有安装入口时，使用菜单中的“在浏览器中打开”。",
    ],
};

function initialDesktopSystem(): DesktopSystem {
    if (/Mac/i.test(navigator.platform)) return "macos";
    if (/Linux/i.test(navigator.platform) && !/Android/i.test(navigator.userAgent)) return "linux";
    return "windows";
}

function initialBrowserSystem(): BrowserSystem {
    const userAgent = navigator.userAgent;
    if (/iPad|iPhone|iPod/i.test(userAgent) || (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1)) {
        return "ios";
    }
    if (/Android/i.test(userAgent)) return "android";
    if (/Edg\/|Chrome\//i.test(userAgent)) return "chromium";
    if (/Safari\//i.test(userAgent)) return "safari";
    return "other";
}

interface InstallationGuideProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    triggerRef: RefObject<HTMLButtonElement>;
}

/** Keep the browser's one-use install event until a direct user action consumes it. */
export function InstallationGuide({ open, onOpenChange, triggerRef }: InstallationGuideProps) {
    const desktop = import.meta.env.LATESTNEWS_DESKTOP === true;
    const [section, setSection] = useState<"desktop" | "browser">(() =>
        !desktop && ["android", "ios"].includes(initialBrowserSystem()) ? "browser" : "desktop"
    );
    const [system, setSystem] = useState(initialDesktopSystem);
    const [browser, setBrowser] = useState(initialBrowserSystem);
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [installMessage, setInstallMessage] = useState("");

    useEffect(() => {
        if (desktop) return undefined;
        const standalone = window.matchMedia("(display-mode: standalone)");
        const iosNavigator = navigator as Navigator & { standalone?: boolean };
        const updateInstalled = () => setInstalled(standalone.matches || iosNavigator.standalone === true);
        const capturePrompt = (event: Event) => {
            event.preventDefault();
            setInstallPrompt(event as BeforeInstallPromptEvent);
            setInstallMessage("");
        };
        const onInstalled = () => {
            setInstalled(true);
            setInstallPrompt(null);
            setInstallMessage("浏览器应用已安装，可从桌面或主屏幕打开。");
        };
        updateInstalled();
        standalone.addEventListener("change", updateInstalled);
        window.addEventListener("beforeinstallprompt", capturePrompt);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            standalone.removeEventListener("change", updateInstalled);
            window.removeEventListener("beforeinstallprompt", capturePrompt);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, [desktop]);

    async function installBrowserApp() {
        if (!installPrompt || installing) return;
        const prompt = installPrompt;
        setInstallPrompt(null);
        setInstalling(true);
        setInstallMessage("");
        try {
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            setInstallMessage(
                outcome === "accepted"
                    ? "已确认安装请求，请按浏览器提示完成安装。"
                    : "已取消安装，仍可直接使用网页。稍后可从浏览器菜单安装。"
            );
        } catch {
            setInstallMessage("未能打开安装窗口，请使用下方浏览器安装步骤。");
        } finally {
            setInstalling(false);
        }
    }

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-100 bg-zinc-950/45 backdrop-blur-sm" />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-101 max-h-[88dvh] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-base p-5 color-base shadow-2xl outline-none sm:p-6"
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Dialog.Title className="text-xl font-semibold">安装与下载</Dialog.Title>
                            <Dialog.Description className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                                {desktop ? `当前为桌面版 v${Version}。` : "选择桌面客户端，或将网页添加为浏览器应用。"}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                title="关闭安装与下载"
                                aria-label="关闭安装与下载"
                                className="btn i-ph:x-duotone h-6 w-6 shrink-0 text-zinc-600 dark:text-zinc-300"
                            />
                        </Dialog.Close>
                    </div>

                    <div
                        role="tablist"
                        aria-label="安装方式"
                        className="mt-5 flex border-b border-zinc-500/25"
                        onKeyDown={(event) => {
                            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                            event.preventDefault();
                            const next =
                                event.key === "Home"
                                    ? "desktop"
                                    : event.key === "End"
                                      ? "browser"
                                      : section === "desktop"
                                        ? "browser"
                                        : "desktop";
                            setSection(next);
                            event.currentTarget.querySelector<HTMLButtonElement>(`#install-tab-${next}`)?.focus();
                        }}
                    >
                        <button
                            type="button"
                            role="tab"
                            id="install-tab-desktop"
                            aria-controls="install-panel-desktop"
                            aria-selected={section === "desktop"}
                            tabIndex={section === "desktop" ? 0 : -1}
                            onClick={() => setSection("desktop")}
                            className="min-w-0 flex-1 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-zinc-500 hover:bg-cyan-500/5 aria-selected:border-cyan-600 aria-selected:text-cyan-700 focus-visible:outline-cyan-600 dark:aria-selected:text-cyan-400"
                        >
                            桌面客户端
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="install-tab-browser"
                            aria-controls="install-panel-browser"
                            aria-selected={section === "browser"}
                            tabIndex={section === "browser" ? 0 : -1}
                            onClick={() => setSection("browser")}
                            className="min-w-0 flex-1 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-zinc-500 hover:bg-cyan-500/5 aria-selected:border-cyan-600 aria-selected:text-cyan-700 focus-visible:outline-cyan-600 dark:aria-selected:text-cyan-400"
                        >
                            浏览器应用
                        </button>
                    </div>

                    <section
                        role="tabpanel"
                        id="install-panel-desktop"
                        aria-labelledby="install-tab-desktop"
                        hidden={section !== "desktop"}
                        className="mt-5"
                    >
                        <h2 id="desktop-install-title" className="flex items-center gap-2 text-base font-semibold">
                            <span
                                aria-hidden="true"
                                className="i-ph:desktop-duotone h-5 w-5 text-cyan-600 dark:text-cyan-400"
                            />
                            {desktop ? "更新桌面客户端" : "桌面客户端"}
                        </h2>
                        <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                            <span>操作系统</span>
                            <select
                                value={system}
                                onChange={(event) => setSystem(event.target.value as DesktopSystem)}
                                className="min-w-0 flex-1 rounded-md border border-zinc-500/25 bg-base px-3 py-2 outline-cyan-600"
                            >
                                <option value="windows">Windows</option>
                                <option value="macos">macOS</option>
                                <option value="linux">Linux</option>
                            </select>
                        </label>
                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                            {desktopSteps[system].steps.map((step) => (
                                <li key={step}>{step}</li>
                            ))}
                        </ol>
                        <p className="mt-3 break-words text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                            文件名后缀：{desktopSteps[system].files}
                        </p>
                        <a
                            href={`${PROJECT_URL}/releases/latest`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600"
                        >
                            <span aria-hidden="true" className="i-ph:download-simple-duotone h-4 w-4" />
                            查看已发布版本
                            <span aria-hidden="true" className="i-ph:arrow-up-right h-4 w-4" />
                        </a>
                        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                            桌面端需下载安装包更新。更新前请完全退出应用；已启用托盘时，从托盘菜单退出，再安装同一架构的新版本。
                        </p>
                    </section>

                    <section
                        role="tabpanel"
                        id="install-panel-browser"
                        aria-labelledby="install-tab-browser"
                        hidden={section !== "browser"}
                        className="mt-5"
                    >
                        <h2 id="browser-install-title" className="flex items-center gap-2 text-base font-semibold">
                            <span
                                aria-hidden="true"
                                className="i-ph:browser-duotone h-5 w-5 text-emerald-600 dark:text-emerald-400"
                            />
                            浏览器应用（PWA）
                        </h2>
                        {desktop ? (
                            <p className="mt-3 text-sm leading-6">
                                在手机或其他电脑的浏览器中打开{" "}
                                <a
                                    href={HOME_PAGE}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="break-all text-cyan-700 underline dark:text-cyan-400"
                                >
                                    {HOME_PAGE}
                                </a>
                                ，再从“安装与下载”查看浏览器安装步骤。
                            </p>
                        ) : (
                            <>
                                {installed ? (
                                    <p
                                        role="status"
                                        className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"
                                    >
                                        <span
                                            aria-hidden="true"
                                            className="i-ph:check-circle-duotone h-5 w-5 shrink-0"
                                        />
                                        当前已在浏览器应用中运行，或已完成安装。
                                    </p>
                                ) : (
                                    <>
                                        {installPrompt || installing ? (
                                            <button
                                                type="button"
                                                disabled={installing}
                                                onClick={() => void installBrowserApp()}
                                                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-cyan-600/40 px-4 py-2 text-sm text-cyan-700 hover:bg-cyan-500/10 disabled:op-50 dark:text-cyan-400"
                                            >
                                                <span aria-hidden="true" className="i-ph:plus-circle-duotone h-4 w-4" />
                                                {installing ? "等待浏览器确认…" : "安装浏览器应用"}
                                            </button>
                                        ) : null}
                                        <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                                            <span>浏览器环境</span>
                                            <select
                                                value={browser}
                                                onChange={(event) => setBrowser(event.target.value as BrowserSystem)}
                                                className="min-w-0 flex-1 rounded-md border border-zinc-500/25 bg-base px-3 py-2 outline-cyan-600"
                                            >
                                                <option value="chromium">电脑 Chrome / Edge</option>
                                                <option value="android">Android Chrome</option>
                                                <option value="ios">iPhone / iPad Safari</option>
                                                <option value="safari">Mac Safari</option>
                                                <option value="other">其他浏览器</option>
                                            </select>
                                        </label>
                                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                                            {browserSteps[browser].map((step) => (
                                                <li key={step}>{step}</li>
                                            ))}
                                        </ol>
                                    </>
                                )}
                                <p
                                    role="status"
                                    aria-live="polite"
                                    className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400"
                                >
                                    {installMessage}
                                </p>
                            </>
                        )}
                        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                            Web
                            随网站部署更新。若提示有新版本，刷新即可使用。离线时仅能读取已缓存内容，获取新新闻仍需联网。
                        </p>
                    </section>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
