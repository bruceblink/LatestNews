import type { DynamicSourceID } from "./types";

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const channelIdPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const dynamicSourceIdPattern = /^ext\.[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9][a-z0-9_-]{0,47}$/;

/** Build a stable runtime ID from a validated plugin identity and channel ID. */
export function createDynamicSourceId(pluginId: string, channelId: string): DynamicSourceID {
    if (pluginId.length > 64 || !pluginIdPattern.test(pluginId)) {
        throw new Error("Invalid crawler plugin ID for a dynamic source.");
    }
    if (!channelIdPattern.test(channelId)) {
        throw new Error("Invalid crawler plugin channel ID for a dynamic source.");
    }

    return `ext.${pluginId}.${channelId}` as DynamicSourceID;
}

/** Check the public ID shape before a dynamic source enters app state or API selection. */
export function isDynamicSourceId(value: string): value is DynamicSourceID {
    return value.length <= 120 && dynamicSourceIdPattern.test(value);
}
