export interface DesktopNewsApiSettings {
    url: string;
    defaultUrl: string;
}

function getDesktopBridge() {
    const desktopBuild =
        import.meta.env.LATESTNEWS_DESKTOP === true || String(import.meta.env.LATESTNEWS_DESKTOP) === "true";
    if (!desktopBuild || typeof window === "undefined") return undefined;
    return window.latestNewsDesktop;
}

export function isDesktopNewsApiConfigurable() {
    return Boolean(getDesktopBridge()?.getNewsApiUrl && getDesktopBridge()?.setNewsApiUrl);
}

export async function readDesktopNewsApiSettings(): Promise<DesktopNewsApiSettings> {
    const bridge = getDesktopBridge();
    if (!bridge?.getNewsApiUrl) throw new Error("桌面 API 配置接口不可用。");
    return bridge.getNewsApiUrl();
}

export async function saveDesktopNewsApiUrl(url: string) {
    const bridge = getDesktopBridge();
    if (!bridge?.setNewsApiUrl) throw new Error("桌面 API 配置接口不可用。");
    return bridge.setNewsApiUrl(url);
}

export async function resetDesktopNewsApiUrl() {
    const bridge = getDesktopBridge();
    if (!bridge?.resetNewsApiUrl) throw new Error("桌面 API 配置接口不可用。");
    return bridge.resetNewsApiUrl();
}
