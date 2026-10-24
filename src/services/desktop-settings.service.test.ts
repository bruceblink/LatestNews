import { it, vi, expect, describe, afterEach } from "vitest";

import {
    saveDesktopNewsApiUrl,
    resetDesktopNewsApiUrl,
    readDesktopNewsApiSettings,
    isDesktopNewsApiConfigurable,
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
            })),
            setNewsApiUrl: vi.fn(async (url: string) => url),
            resetNewsApiUrl: vi.fn(async () => "https://news.likanug.top"),
        };
        vi.stubEnv("LATESTNEWS_DESKTOP", "true");
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        expect(isDesktopNewsApiConfigurable()).toBe(true);
        await expect(readDesktopNewsApiSettings()).resolves.toEqual({
            url: "https://news.example.com",
            defaultUrl: "https://news.likanug.top",
        });
        await expect(saveDesktopNewsApiUrl("https://news.example.test")).resolves.toBe("https://news.example.test");
        await expect(resetDesktopNewsApiUrl()).resolves.toBe("https://news.likanug.top");
        expect(bridge.getNewsApiUrl).toHaveBeenCalledOnce();
        expect(bridge.setNewsApiUrl).toHaveBeenCalledWith("https://news.example.test");
        expect(bridge.resetNewsApiUrl).toHaveBeenCalledOnce();
    });

    it("reports an unavailable bridge instead of touching Web globals", async () => {
        vi.stubEnv("LATESTNEWS_DESKTOP", "false");
        vi.stubGlobal("window", {});

        expect(isDesktopNewsApiConfigurable()).toBe(false);
        await expect(readDesktopNewsApiSettings()).rejects.toThrow("桌面 API 配置接口不可用");
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
