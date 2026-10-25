import { it, vi, expect, describe, afterEach } from "vitest";

import {
    saveDesktopNewsApiUrl,
    resetDesktopNewsApiUrl,
    readDesktopPreferences,
    saveDesktopNewsApiSettings,
    readDesktopNewsApiSettings,
    isDesktopNewsApiConfigurable,
    saveDesktopTrayBackgroundEnabled,
    isDesktopTrayBackgroundConfigurable,
} from "./desktop-settings.service";

describe("desktop settings service", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("delegates desktop API configuration to the trusted bridge", async () => {
        const bridge = {
            getNewsApiUrl: vi.fn(async () => ({
                url: "https://news.example.com",
                defaultUrl: "https://news.likanug.top",
                mode: "auto" as const,
            })),
            setNewsApiUrl: vi.fn(async (url: string) => url),
            setNewsApiSettings: vi.fn(
                async ({ url, mode }: { url: string; mode: "auto" | "remote" | "local" }) => `${mode}:${url}`
            ),
            resetNewsApiUrl: vi.fn(async () => "https://news.likanug.top"),
            getDesktopPreferences: vi.fn(async () => ({ trayBackgroundEnabled: false })),
            setTrayBackgroundEnabled: vi.fn(async (trayBackgroundEnabled: boolean) => ({ trayBackgroundEnabled })),
        };
        vi.stubEnv("LATESTNEWS_DESKTOP", "true");
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        expect(isDesktopNewsApiConfigurable()).toBe(true);
        expect(isDesktopTrayBackgroundConfigurable()).toBe(true);
        await expect(readDesktopPreferences()).resolves.toEqual({ trayBackgroundEnabled: false });
        await expect(saveDesktopTrayBackgroundEnabled(true)).resolves.toEqual({ trayBackgroundEnabled: true });
        await expect(readDesktopNewsApiSettings()).resolves.toEqual({
            url: "https://news.example.com",
            defaultUrl: "https://news.likanug.top",
            mode: "auto",
        });
        await expect(saveDesktopNewsApiUrl("https://news.example.test")).resolves.toBe("https://news.example.test");
        await expect(saveDesktopNewsApiUrl("")).resolves.toBe("");
        await expect(saveDesktopNewsApiSettings("https://news.example.test", "remote")).resolves.toBe(
            "remote:https://news.example.test"
        );
        await expect(resetDesktopNewsApiUrl()).resolves.toBe("https://news.likanug.top");
        expect(bridge.getNewsApiUrl).toHaveBeenCalledOnce();
        expect(bridge.setNewsApiUrl).toHaveBeenCalledWith("https://news.example.test");
        expect(bridge.setNewsApiUrl).toHaveBeenCalledWith("");
        expect(bridge.setNewsApiSettings).toHaveBeenCalledWith({ url: "https://news.example.test", mode: "remote" });
        expect(bridge.resetNewsApiUrl).toHaveBeenCalledOnce();
        expect(bridge.getDesktopPreferences).toHaveBeenCalledOnce();
        expect(bridge.setTrayBackgroundEnabled).toHaveBeenCalledWith(true);
    });

    it("reports an unavailable bridge instead of touching Web globals", async () => {
        vi.stubEnv("LATESTNEWS_DESKTOP", "false");
        vi.stubGlobal("window", {});

        expect(isDesktopNewsApiConfigurable()).toBe(false);
        expect(isDesktopTrayBackgroundConfigurable()).toBe(false);
        await expect(readDesktopNewsApiSettings()).rejects.toThrow("桌面 API 配置接口不可用");
        await expect(readDesktopPreferences()).rejects.toThrow("桌面偏好设置接口不可用");
        await expect(saveDesktopNewsApiUrl("https://news.example.test")).rejects.toThrow("桌面 API 配置接口不可用");
        await expect(resetDesktopNewsApiUrl()).rejects.toThrow("桌面 API 配置接口不可用");
    });

    it("reports an incomplete desktop bridge as unavailable", async () => {
        vi.stubEnv("LATESTNEWS_DESKTOP", "true");
        vi.stubGlobal("window", {
            latestNewsDesktop: {
                getNewsApiUrl: vi.fn(),
            },
        });

        expect(isDesktopNewsApiConfigurable()).toBe(false);
        await expect(saveDesktopNewsApiUrl("https://news.example.test")).rejects.toThrow("桌面 API 配置接口不可用");
        await expect(resetDesktopNewsApiUrl()).rejects.toThrow("桌面 API 配置接口不可用");
    });
});
