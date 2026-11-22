import process from "node:process";
import { definePlugin } from "nitro";

import { stopSourceCollection } from "../utils/source-fetch";

export default definePlugin(({ hooks }) => {
    if (import.meta.preset === "node-server" && !process.env.CI && !process.env.TEST) {
        // Nitro calls its close hook after srvx waits for active requests and background work.
        // Cancel collection before that wait starts, while allowing cache writes to finish.
        process.prependOnceListener("SIGINT", stopSourceCollection);
        process.prependOnceListener("SIGTERM", stopSourceCollection);
        hooks.hook("close", () => {
            process.off("SIGINT", stopSourceCollection);
            process.off("SIGTERM", stopSourceCollection);
        });
    }
    hooks.hook("close", stopSourceCollection);
});
