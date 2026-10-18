import { dirname, resolve } from "node:path";
import { app, utilityProcess } from "electron";

import { requestCrawlerHttp } from "../crawler-platform/host/http";
import { CrawlerPlatformError } from "../crawler-platform/core/errors";
import { ProcessCrawlerHost } from "../crawler-platform/host/process-host";
import { createRestrictedWorkerEnvironment } from "../crawler-platform/host/environment";

import type { ProcessCrawlerHostOptions } from "../crawler-platform/host/process-host";
import type {
    CrawlerWorkerCommand,
    CrawlerWorkerResponse,
    CrawlerProcessConnection,
} from "../crawler-platform/host/process-host";

export interface ElectronCrawlerHostOptions extends Partial<
    Pick<ProcessCrawlerHostOptions, "timeoutMs" | "maxResponseBytes">
> {
    workerPath: string;
    requestHandler?: ProcessCrawlerHostOptions["requestHandler"];
}

/** Run the shared crawler protocol in Electron's utility process, after app readiness. */
export function createElectronCrawlerHost(options: ElectronCrawlerHostOptions) {
    const workerPath = resolve(options.workerPath);

    return new ProcessCrawlerHost({
        ...options,
        workerPath,
        target: "electron",
        spawn: () => createUtilityWorker(workerPath),
        requestHandler: options.requestHandler ?? requestCrawlerHttp,
    });
}

function createUtilityWorker(workerPath: string): CrawlerProcessConnection {
    if (!app.isReady()) {
        throw new CrawlerPlatformError("HOST_NOT_READY", "Electron must be ready before starting a crawler process.");
    }

    const child = utilityProcess.fork(workerPath, [], {
        cwd: dirname(workerPath),
        env: createRestrictedWorkerEnvironment(),
        serviceName: "LatestNews Crawler",
        stdio: "ignore",
    });

    return {
        send(message: CrawlerWorkerCommand) {
            child.postMessage(message);
        },
        onMessage(handler) {
            const listener = (message: unknown) => handler(message as CrawlerWorkerResponse);
            child.on("message", listener);
            return () => child.off("message", listener);
        },
        onExit(handler) {
            const listener = (code: number) => handler(code, null);
            child.once("exit", listener);
            return () => child.off("exit", listener);
        },
        kill() {
            child.kill();
        },
    };
}
