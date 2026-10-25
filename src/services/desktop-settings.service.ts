import type { DesktopCollectionMode } from "@shared/desktop-collection-mode";

export interface DesktopNewsApiSettings {
    url: string;
    defaultUrl: string;
    mode: DesktopCollectionMode;
}

export interface DesktopPreferences {
    trayBackgroundEnabled: boolean;
}

function getDesktopBridge() {
    const desktopBuild =
        import.meta.env.LATESTNEWS_DESKTOP === true || String(import.meta.env.LATESTNEWS_DESKTOP) === "true";
    if (!desktopBuild || typeof window === "undefined") return undefined;
    return window.latestNewsDesktop;
}

export function isDesktopNewsApiConfigurable() {
    return Boolean(getDesktopBridge()?.getNewsApiUrl && getDesktopBridge()?.setNewsApiSettings);
}

export function isDesktopTrayBackgroundConfigurable() {
    const bridge = getDesktopBridge();
    return Boolean(bridge?.getDesktopPreferences && bridge?.setTrayBackgroundEnabled);
}

export async function readDesktopPreferences(): Promise<DesktopPreferences> {
    const bridge = getDesktopBridge();
    if (!bridge?.getDesktopPreferences) throw new Error("桌面偏好设置接口不可用。");
    return bridge.getDesktopPreferences();
}

export async function saveDesktopTrayBackgroundEnabled(enabled: boolean) {
    const bridge = getDesktopBridge();
    if (!bridge?.setTrayBackgroundEnabled) throw new Error("桌面偏好设置接口不可用。");
    return bridge.setTrayBackgroundEnabled(enabled);
}

export async function readDesktopNewsApiSettings(): Promise<DesktopNewsApiSettings> {
    const bridge = getDesktopBridge();
    if (!bridge?.getNewsApiUrl) throw new Error("桌面 API 配置接口不可用。");
    const settings = await bridge.getNewsApiUrl();
    return { ...settings, mode: settings.mode ?? "auto" };
}

export async function saveDesktopNewsApiUrl(url: string) {
    const bridge = getDesktopBridge();
    if (!bridge?.setNewsApiUrl) throw new Error("桌面 API 配置接口不可用。");
    return bridge.setNewsApiUrl(url);
}

export async function saveDesktopNewsApiSettings(url: string, mode: DesktopCollectionMode) {
    const bridge = getDesktopBridge();
    if (!bridge?.setNewsApiSettings) throw new Error("桌面 API 配置接口不可用。");
    return bridge.setNewsApiSettings({ url, mode });
}

export async function resetDesktopNewsApiUrl() {
    const bridge = getDesktopBridge();
    if (!bridge?.resetNewsApiUrl) throw new Error("桌面 API 配置接口不可用。");
    return bridge.resetNewsApiUrl();
}
