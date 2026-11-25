import { it, expect, describe } from "vitest";
import {
    appNavigation,
    columnNavigation,
    isAppNavigationActive,
    getAppNavigationContext,
} from "@shared/app-navigation";

describe("application navigation", () => {
    it("keeps the home context on the insights route", () => {
        expect(getAppNavigationContext("/")).toEqual(appNavigation.home);
        expect(getAppNavigationContext("/insights")).toEqual(appNavigation.home);
        expect(isAppNavigationActive("home", "/insights")).toBe(true);
    });

    it("maps column routes to the Feed workspace and the selected column", () => {
        for (const column of columnNavigation) {
            expect(isAppNavigationActive("feed", `/c/${column.id}`)).toBe(true);
            expect(getAppNavigationContext(`/c/${column.id}`).label).toBe(column.label);
        }
    });

    it("maps a source detail page to health context", () => {
        expect(isAppNavigationActive("health", "/source/hackernews")).toBe(true);
        expect(getAppNavigationContext("/source/hackernews").label).toBe("来源详情");
    });

    it("resolves all first-level workspace routes", () => {
        expect(getAppNavigationContext("/feed")).toEqual(appNavigation.feed);
        expect(getAppNavigationContext("/history")).toEqual(appNavigation.history);
        expect(getAppNavigationContext("/archive")).toEqual(appNavigation.archive);
        expect(isAppNavigationActive("archive", "/archive")).toBe(true);
        expect(getAppNavigationContext("/health")).toEqual(appNavigation.health);
        expect(getAppNavigationContext("/settings")).toEqual(appNavigation.settings);
    });
});
