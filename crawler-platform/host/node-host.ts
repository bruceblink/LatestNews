import { dirname, resolve } from "node:path";
import { fork, type ChildProcess } from "node:child_process";

import { requestCrawlerHttp } from "./http";
import { ProcessCrawlerHost } from "./process-host";
import { CrawlerPlatformError } from "../core/errors";
import { createRestrictedWorkerEnvironment } from "./environment";

import type { ProcessCrawlerHostOptions } from "./process-host";
import type { CrawlerWorkerCommand, CrawlerWorkerResponse, CrawlerProcessConnection } from "./process-host";

const defaultWorkerPath = resolve(process.cwd(), "crawler-platform/runtime/worker-entry.mjs");

export interface NodeCrawlerHostOptions extends Partial<
    Pick<ProcessCrawlerHostOptions, "timeoutMs" | "maxResponseBytes">
> {
    workerPath?: string;
    requestHandler?: ProcessCrawlerHostOptions["requestHandler"];
}

/** Build the Node process adapter. The worker receives a filtered environment without application secrets. */
export function createNodeCrawlerHost(options: NodeCrawlerHostOptions = {}) {
    const workerPath = resolve(options.workerPath ?? defaultWorkerPath);

    return new ProcessCrawlerHost({
        ...options,
        workerPath,
        target: "node",
        spawn: () => createNodeWorker(workerPath),
        requestHandler: options.requestHandler ?? requestCrawlerHttp,
    });
}

function createNodeWorker(workerPath: string): CrawlerProcessConnection {
    const child = fork(workerPath, [], {
        cwd: dirname(workerPath),
        env: createRestrictedWorkerEnvironment(),
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
    });

    return {
        send(message: CrawlerWorkerCommand) {
            if (!child.connected) throw new CrawlerPlatformError("WORKER_EXIT", "Plugin worker is not connected.");
            child.send(message);
        },
        onMessage(handler) {
            const listener = (message: unknown) => handler(message as CrawlerWorkerResponse);
            child.on("message", listener);
            return () => child.off("message", listener);
        },
        onExit(handler) {
            const listener = (code: number | null, signal: NodeJS.Signals | null) => handler(code, signal);
            child.once("exit", listener);
            return () => child.off("exit", listener);
        },
        kill() {
            terminateChild(child);
        },
    };
}

function terminateChild(child: ChildProcess) {
    if (child.connected) child.disconnect();
    child.kill();
}
