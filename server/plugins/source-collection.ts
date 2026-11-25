import process from "node:process";
import { definePlugin } from "nitro";

import { setFetchTrace } from "../utils/fetch";
import { getBenchmarkTrace } from "../utils/collection-trace";
import { stopSourceCollection, setSourceCollectionTrace } from "../utils/source-fetch";

export default definePlugin(({ hooks }) => {
    const trace = getBenchmarkTrace();
    if (trace) {
        setSourceCollectionTrace(trace);
        setFetchTrace(trace);
    }
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
