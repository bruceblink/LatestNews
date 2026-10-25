import { it, expect, describe } from "vitest";

import {
    defaultDesktopPreferences,
    serializeDesktopPreferences,
    parseStoredDesktopPreferences,
} from "../electron/desktop-preferences";

describe("desktop preferences", () => {
    it("keeps tray background mode disabled by default", () => {
        expect(defaultDesktopPreferences).toEqual({ trayBackgroundEnabled: false });
    });

    it("reads and writes the versioned tray preference", () => {
        const serialized = serializeDesktopPreferences({ trayBackgroundEnabled: true });

        expect(serialized).toBe('{"version":1,"trayBackgroundEnabled":true}\n');
        expect(parseStoredDesktopPreferences(serialized)).toEqual({ trayBackgroundEnabled: true });
    });

    it("rejects malformed or unknown preference fields", () => {
        expect(() => parseStoredDesktopPreferences("[]")).toThrow();
        expect(() => parseStoredDesktopPreferences('{"version":2,"trayBackgroundEnabled":true}')).toThrow();
        expect(() => parseStoredDesktopPreferences('{"version":1,"trayBackgroundEnabled":"yes"}')).toThrow();
        expect(() => parseStoredDesktopPreferences('{"version":1,"trayBackgroundEnabled":false,"extra":1}')).toThrow();
    });
});
