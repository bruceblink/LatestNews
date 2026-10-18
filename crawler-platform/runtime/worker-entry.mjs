import { pathToFileURL } from "node:url";

const pendingRequests = new Map();
let activeController;
let nextRequestId = 0;

function send(message) {
    if (typeof process.send === "function") {
        return new Promise((resolve, reject) => {
            process.send(message, (error) => (error ? reject(error) : resolve()));
        });
    }
    process.parentPort.postMessage(message);
    return Promise.resolve();
}

function receive(message) {
    if (message.type === "http-response" || message.type === "http-error") {
        const pending = pendingRequests.get(message.requestId);
        if (!pending) return;
        pendingRequests.delete(message.requestId);
        if (message.type === "http-error") {
            const error = new Error(message.message);
            error.code = message.code;
            pending.reject(error);
        } else {
            pending.resolve(message.response);
        }
        return;
    }

    if (message.type === "cancel") {
        activeController?.abort();
        return;
    }

    if (message.type === "start") void run(message);
}

async function run(message) {
    activeController = new AbortController();
    try {
        const moduleUrl = pathToFileURL(message.entryPath).href;
        const loaded = await import(moduleUrl);
        const plugin = loaded.default ?? loaded.plugin;
        if (!plugin || typeof plugin.collect !== "function" || !plugin.manifest) {
            throw Object.assign(new Error("Plugin entry must export a default plugin with manifest and collect."), {
                code: "INVALID_PLUGIN",
            });
        }
        if (plugin.manifest.id !== message.pluginId || plugin.manifest.version !== message.pluginVersion) {
            throw Object.assign(new Error("Loaded plugin metadata does not match the host manifest."), {
                code: "INVALID_PLUGIN",
            });
        }

        const context = {
            signal: activeController.signal,
            now: () => message.now,
            http: {
                request(request) {
                    const requestId = ++nextRequestId;
                    return new Promise((resolve, reject) => {
                        pendingRequests.set(requestId, { resolve, reject });
                        void send({ type: "http-request", requestId, request });
                    });
                },
            },
        };
        const result = await plugin.collect(context, {
            sourceId: message.sourceId,
            ...(message.parameters !== undefined ? { parameters: message.parameters } : {}),
        });
        await send({ type: "result", items: result });
    } catch (error) {
        const failure = {
            type: "failure",
            code: typeof error?.code === "string" ? error.code : "INVALID_PLUGIN",
            message: error instanceof Error ? error.message : "Plugin execution failed.",
        };
        await send(failure);
    } finally {
        pendingRequests.clear();
        process.disconnect?.();
        setImmediate(() => process.exit(0));
    }
}

if (process.parentPort) {
    process.parentPort.on("message", (event) => receive(event.data));
} else {
    process.on("message", receive);
}
