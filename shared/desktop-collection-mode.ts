export const desktopCollectionModes = ["auto", "remote", "local"] as const;

export type DesktopCollectionMode = (typeof desktopCollectionModes)[number];

export function isDesktopCollectionMode(value: unknown): value is DesktopCollectionMode {
    return typeof value === "string" && desktopCollectionModes.some((mode) => mode === value);
}
