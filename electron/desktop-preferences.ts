export interface DesktopPreferences {
    trayBackgroundEnabled: boolean;
}

export const defaultDesktopPreferences: DesktopPreferences = { trayBackgroundEnabled: false };

/** Keep tray persistence separate from API and credential settings. */
export function parseStoredDesktopPreferences(raw: string): DesktopPreferences {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid desktop preferences.");
    }

    const value = parsed as { version?: unknown; trayBackgroundEnabled?: unknown };
    if (
        value.version !== 1 ||
        typeof value.trayBackgroundEnabled !== "boolean" ||
        Object.keys(value).some((key) => key !== "version" && key !== "trayBackgroundEnabled")
    ) {
        throw new Error("Invalid desktop preferences.");
    }

    return { trayBackgroundEnabled: value.trayBackgroundEnabled };
}

export function serializeDesktopPreferences(preferences: DesktopPreferences) {
    if (!preferences || typeof preferences.trayBackgroundEnabled !== "boolean") {
        throw new Error("Invalid desktop preferences.");
    }

    return `${JSON.stringify({ version: 1, trayBackgroundEnabled: preferences.trayBackgroundEnabled })}\n`;
}
