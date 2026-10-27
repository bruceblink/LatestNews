import { pathToFileURL } from "node:url";

const pendingRequests = new Map();
let activeController;
let nextRequestId = 0;
let runStarted = false;

const defaultLimits = {
    maxRequestsPerRun: 16,
    maxRequestBodyBytes: 16 * 1024,
    maxRequestHeadersBytes: 16 * 1024,
};

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
    if (!isRecord(message)) return;
    if (message.type === "http-response" || message.type === "http-error") {
        if (!Number.isSafeInteger(message.requestId)) return;
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
        rejectPending(createWorkerError("CANCELLED", "Plugin collection was cancelled."));
        return;
    }

    if (message.type === "start" && !runStarted) {
        runStarted = true;
        void run(message);
    }
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

        const limits = normalizeLimits(message.limits ?? plugin.manifest.limits);
        let requestCount = 0;
        if (activeController.signal.aborted) throw createWorkerError("CANCELLED", "Plugin collection was cancelled.");

        const context = {
            signal: activeController.signal,
            now: () => message.now,
            http: {
                request(request) {
                    if (activeController.signal.aborted) {
                        return Promise.reject(createWorkerError("CANCELLED", "Plugin collection was cancelled."));
                    }
                    validateRequest(request, limits);
                    if (requestCount >= limits.maxRequestsPerRun) {
                        return Promise.reject(
                            createWorkerError(
                                "RESOURCE_LIMIT",
                                `Plugin exceeded ${limits.maxRequestsPerRun} requests per run.`
                            )
                        );
                    }
                    requestCount += 1;
                    const requestId = ++nextRequestId;
                    return new Promise((resolve, reject) => {
                        pendingRequests.set(requestId, { resolve, reject });
                        void send({ type: "http-request", requestId, request }).catch((error) => {
                            pendingRequests.delete(requestId);
                            reject(error);
                        });
                    });
                },
            },
        };
        const result = await plugin.collect(context, {
            sourceId: message.sourceId,
            ...(message.parameters !== undefined ? { parameters: message.parameters } : {}),
        });
        if (activeController.signal.aborted) return;
        await send({ type: "result", items: result });
    } catch (error) {
        if (activeController?.signal.aborted) return;
        const failure = {
            type: "failure",
            code: typeof error?.code === "string" ? error.code : "INVALID_PLUGIN",
            message: error instanceof Error ? error.message : "Plugin execution failed.",
        };
        await send(failure);
    } finally {
        rejectPending(createWorkerError("CANCELLED", "Plugin worker is stopping."));
        process.disconnect?.();
        setImmediate(() => process.exit(0));
    }
}

function validateRequest(request, limits) {
    if (!isRecord(request) || typeof request.url !== "string" || request.url.length === 0) {
        throw createWorkerError("INVALID_PLUGIN", "HTTP request must contain a URL string.");
    }
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        throw createWorkerError("INVALID_PLUGIN", `HTTP method ${String(method)} is not supported.`);
    }
    if (request.body !== undefined && typeof request.body !== "string") {
        throw createWorkerError("INVALID_PLUGIN", "HTTP request body must be a string.");
    }
    if ((method === "GET" || method === "HEAD") && request.body !== undefined) {
        throw createWorkerError("INVALID_PLUGIN", `${method} requests cannot include a body.`);
    }
    if (request.body !== undefined && new TextEncoder().encode(request.body).byteLength > limits.maxRequestBodyBytes) {
        throw createWorkerError("RESOURCE_LIMIT", `Request body exceeds ${limits.maxRequestBodyBytes} bytes.`);
    }
    if (request.headers === undefined) return;
    if (!isRecord(request.headers)) {
        throw createWorkerError("INVALID_PLUGIN", "HTTP request headers must be a string map.");
    }
    let headerBytes = 0;
    for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value !== "string") {
            throw createWorkerError("INVALID_PLUGIN", "HTTP request headers must use string values.");
        }
        headerBytes += new TextEncoder().encode(name).byteLength + new TextEncoder().encode(value).byteLength + 4;
    }
    if (headerBytes > limits.maxRequestHeadersBytes) {
        throw createWorkerError("RESOURCE_LIMIT", `Request headers exceed ${limits.maxRequestHeadersBytes} bytes.`);
    }
}

function normalizeLimits(input) {
    return {
        maxRequestsPerRun: positiveInteger(input?.maxRequestsPerRun, defaultLimits.maxRequestsPerRun),
        maxRequestBodyBytes: nonNegativeInteger(input?.maxRequestBodyBytes, defaultLimits.maxRequestBodyBytes),
        maxRequestHeadersBytes: positiveInteger(input?.maxRequestHeadersBytes, defaultLimits.maxRequestHeadersBytes),
    };
}

function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function rejectPending(error) {
    for (const { reject } of pendingRequests.values()) reject(error);
    pendingRequests.clear();
}

function createWorkerError(code, message) {
    return Object.assign(new Error(message), { code });
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.parentPort) {
    process.parentPort.on("message", (event) => receive(event.data));
} else {
    process.on("message", receive);
}
