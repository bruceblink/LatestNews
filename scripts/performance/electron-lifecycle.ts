import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { rm, access, mkdtemp, readdir, readFile } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(import.meta.url);
const electronExecutable = await resolveElectronExecutable();
const appDirectory = resolve(projectRoot, "out");

if (typeof electronExecutable !== "string") throw new Error("Could not resolve the Electron executable.");
await Promise.all([
    access(resolve(appDirectory, "main/main.cjs")),
    access(resolve(appDirectory, "preload/preload.cjs")),
    access(resolve(appDirectory, "renderer/index.html")),
]);

const temporaryRoot = await mkdtemp(join(tmpdir(), "latestnews-electron-lifecycle-"));
const reportPath = join(temporaryRoot, "lifecycle.json");
const userDataPath = join(temporaryRoot, "user-data");

try {
    const exitCode = await runElectronApp(electronExecutable, appDirectory, reportPath);
    assert.equal(exitCode, 0, "Electron lifecycle probe should exit successfully.");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as LifecycleProbeReport;
    assert.equal(report.result, "passed", "Electron lifecycle probe should write a passing report.");
    const apiConfig = report.apiConfig ?? {};
    assert.ok(
        report.rendererSnapshot?.appHtml,
        `Electron renderer did not mount the app root. ${JSON.stringify({
            snapshot: report.rendererSnapshot,
            console: report.rendererConsoleMessages,
        })}`
    );
    assert.equal(
        apiConfig.changedUrl,
        "https://news.example.test",
        `Desktop API URL did not update. ${JSON.stringify(apiConfig)}`
    );
    assert.equal(apiConfig.changed?.url, "https://news.example.test", "Updated desktop API URL was not read back.");
    assert.equal(apiConfig.resetUrl, apiConfig.reset?.defaultUrl, "Desktop API URL did not reset.");

    const eventNames = new Set([
        ...report.beforeClose.lifecycle.events.map((event) => event.name),
        ...report.afterClose.lifecycle.events.map((event) => event.name),
    ]);
    for (const requiredEvent of [
        "app-ready",
        "window-created",
        "window-did-finish-load",
        "window-minimize",
        "window-restore",
        "window-closed",
    ]) {
        assert.ok(eventNames.has(requiredEvent), `Lifecycle probe did not observe ${requiredEvent}.`);
    }
    assert.ok(
        report.beforeClose.windows.some((window) => window.url.endsWith("/feed")),
        "Feed route was not loaded."
    );
    assert.equal(report.afterClose.windows.length, 0, "Electron windows remained after the close transition.");

    const usableMetric = report.beforeClose.processes.some(
        (metric) => metric.workingSetSize > 0 || (metric.privateBytes ?? 0) > 0 || (metric.cpuPercent ?? 0) > 0
    );
    assert.ok(usableMetric, "Electron did not report a usable nonzero process metric.");

    process.stdout.write(
        `${JSON.stringify({
            result: "passed",
            route: report.beforeClose.windows.find((window) => window.url.endsWith("/feed"))?.url,
            eventCount: report.beforeClose.lifecycle.events.length,
            processCount: report.beforeClose.processes.length,
            beforeCloseWindowCount: report.beforeClose.windows.length,
            afterCloseWindowCount: report.afterClose.windows.length,
            processes: report.beforeClose.processes,
        })}\n`
    );
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

interface LifecycleProbeReport {
    result: "passed" | "failed";
    apiConfig?: {
        changedUrl?: string;
        changed?: { url: string; defaultUrl: string };
        resetUrl?: string;
        reset?: { url: string; defaultUrl: string };
    };
    rendererSnapshot?: {
        title?: string;
        readyState?: string;
        bodyText?: string;
        appHtml?: string;
        scripts?: Array<{ src: string; type: string }>;
        resources?: string[];
    };
    rendererConsoleMessages?: string[];
    beforeClose: DiagnosticsSnapshot;
    afterClose: DiagnosticsSnapshot;
}

interface DiagnosticsSnapshot {
    lifecycle: {
        events: Array<{ name: string }>;
    };
    windows: Array<{ url: string }>;
    processes: Array<{
        cpuPercent?: number;
        workingSetSize: number;
        privateBytes?: number;
    }>;
}

function runElectronApp(executable: string, appPath: string, report: string) {
    return new Promise<number>((resolveExit, reject) => {
        const child = spawn(executable, [appPath, "--no-sandbox", "--disable-gpu"], {
            cwd: projectRoot,
            env: {
                ...process.env,
                LATESTNEWS_ELECTRON_LIFECYCLE_PROBE: "1",
                LATESTNEWS_ELECTRON_LIFECYCLE_REPORT: report,
                LATESTNEWS_ELECTRON_LIFECYCLE_USER_DATA: userDataPath,
            },
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
        });
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`Electron lifecycle probe exceeded 20 seconds. ${stderr}`));
        }, 20_000);

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once("exit", (code) => {
            clearTimeout(timer);
            if (code !== 0 && stderr) process.stderr.write(stderr);
            resolveExit(code ?? 1);
        });
    });
}

async function resolveElectronExecutable() {
    const configured = process.env.LATESTNEWS_ELECTRON_EXECUTABLE?.trim();
    if (configured) return configured;

    const pnpmRoot = resolve(projectRoot, "node_modules/.pnpm");
    try {
        const packageDirectories = (await readdir(pnpmRoot)).filter((name) => name.startsWith("electron@"));
        packageDirectories.sort().reverse();
        for (const packageDirectory of packageDirectories) {
            const packageRoot = resolve(pnpmRoot, packageDirectory, "node_modules/electron");
            const candidates =
                process.platform === "win32"
                    ? [resolve(packageRoot, "dist/electron.exe")]
                    : process.platform === "darwin"
                      ? [resolve(packageRoot, "dist/Electron.app/Contents/MacOS/Electron")]
                      : [resolve(packageRoot, "dist/electron")];
            for (const candidate of candidates) {
                try {
                    await access(candidate);
                    return candidate;
                } catch {
                    // Try the next installed Electron package.
                }
            }
        }
    } catch {
        // Fall back to the package resolver below.
    }

    try {
        const resolved = require("electron");
        if (typeof resolved === "string") return resolved;
    } catch (error) {
        throw new Error(
            `Electron executable is unavailable. Set LATESTNEWS_ELECTRON_EXECUTABLE to a local binary. ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
    throw new Error("Electron executable is unavailable. Set LATESTNEWS_ELECTRON_EXECUTABLE to a local binary.");
}
