import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { _electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { rm, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createNewsInsights } from "../../shared/news-insights";

import type { SourceResponse } from "../../shared/types";

const { values } = parseArgs({
    options: {
        executable: { type: "string" },
        version: { type: "string" },
        certutil: { type: "string", default: "certutil" },
        "no-sandbox": { type: "boolean", default: false },
    },
});
assert(process.platform === "linux", "This smoke requires Linux.");
assert(values.executable && values.version, "Specify a verified extracted executable and expected version.");
const executable = resolve(values.executable);
const certutil = values.certutil.includes("/") ? resolve(values.certutil) : values.certutil;
const root = await mkdtemp(join(tmpdir(), "latestnews-published-https-"));
const home = join(root, "home");
const tls = join(root, "tls");
const profile = join(root, "profile");
const database = "sql:" + join(home, ".pki/nssdb");
let desktop: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let server: ReturnType<typeof createServer> | undefined;

try {
    for (const dir of [join(home, ".pki/nssdb"), tls, profile, join(root, "runtime")])
        await mkdir(dir, { recursive: true, mode: 0o700 });
    const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: tls, stdio: "ignore" });
    openssl(
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=LatestNews isolated release CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
        "-keyout",
        "ca.key",
        "-out",
        "ca.pem"
    );
    openssl(
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=localhost",
        "-keyout",
        "server.key",
        "-out",
        "server.csr"
    );
    await writeFile(
        join(tls, "server.ext"),
        "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n"
    );
    openssl(
        "x509",
        "-req",
        "-in",
        "server.csr",
        "-CA",
        "ca.pem",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        "server.pem",
        "-days",
        "1",
        "-sha256",
        "-extfile",
        "server.ext"
    );
    openssl("verify", "-CAfile", "ca.pem", "server.pem");
    // Trust the fixture only in a temporary home, never in the real user's or
    // system certificate store. Do not pass certificate-ignore flags.
    execFileSync(certutil, ["-N", "-d", database, "--empty-password"], { stdio: "ignore" });
    execFileSync(
        certutil,
        ["-A", "-d", database, "-n", "LatestNews isolated release CA", "-t", "C,,", "-i", join(tls, "ca.pem")],
        { stdio: "ignore" }
    );

    const title = "Released desktop HTTPS fixture headline";
    const generatedAt = Date.now();
    const items = [{ id: "fixture", title, url: "https://example.test/release-https", pubDate: generatedAt }];
    const rows: SourceResponse[] = [
        {
            id: "hackernews",
            name: "Hacker News",
            status: "success",
            updatedTime: generatedAt,
            items,
        },
    ];
    const catalog = {
        id: "hackernews",
        name: "Hacker News",
        interval: 600000,
        color: "slate",
        type: "normal",
        disabled: false,
    };
    const meta = { generatedAt, requestedSourceCount: 1, resolvedSourceCount: 1, partial: false, omittedSourceIds: [] };
    const responses: Record<string, unknown> = {
        "/api/v1/sources": {
            data: { sources: [catalog], columns: [] },
            meta: { generatedAt, sourceCount: 1, redirectCount: 0, disabledCount: 0, columnCount: 0 },
            errors: [],
        },
        "/api/v1/insights": { data: createNewsInsights(rows, { generatedAt }), meta, errors: [] },
        "/api/v1/auth/capability": { data: { enabled: false }, errors: [] },
        "/api/v1/health/sources": {
            data: [],
            meta: {
                generatedAt,
                totalSourceCount: 0,
                healthyCount: 0,
                failingCount: 0,
                idleCount: 0,
                cacheDegradedCount: 0,
            },
            errors: [],
        },
    };
    const requests: Record<string, number> = {};
    server = createServer(
        {
            key: await readFile(join(tls, "server.key")),
            cert: await readFile(join(tls, "server.pem")),
        },
        async (req, res) => {
            try {
                let bytes = 0;
                for await (const chunk of req) {
                    bytes += Buffer.byteLength(chunk);
                    if (bytes > 1024 * 1024) {
                        res.writeHead(413).end();
                        return;
                    }
                }
                const path = new URL(req.url ?? "/", "https://localhost").pathname;
                requests[path] = (requests[path] ?? 0) + 1;
                const body = responses[path];
                res.writeHead(body === undefined ? 404 : 200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store",
                });
                res.end(JSON.stringify(body ?? { message: "Unknown fixture route" }));
            } catch {
                if (!res.headersSent) res.writeHead(500);
                res.end();
            }
        }
    );
    await new Promise<void>((done, fail) => {
        server!.once("error", fail);
        server!.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    const origin = "https://127.0.0.1:" + address.port;
    await writeFile(join(profile, "news-api-config.json"), JSON.stringify({ url: origin, mode: "remote" }));

    // Do not forward developer credentials or application configuration to the
    // released process. Use the isolated HOME and the loopback-only fixture.
    const env = {
        ...Object.fromEntries(
            ["PATH", "DISPLAY", "XAUTHORITY", "LANG"].flatMap((key) =>
                process.env[key] === undefined ? [] : [[key, process.env[key]!]]
            )
        ),
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_RUNTIME_DIR: join(root, "runtime"),
        LATESTNEWS_CRAWLER_PLUGIN_DIR: join(profile, "plugins"),
    };
    desktop = await _electron.launch({
        executablePath: executable,
        args: [
            ...(values["no-sandbox"] ? ["--no-sandbox"] : []),
            "--disable-gpu",
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
            "--proxy-server=http://127.0.0.1:1",
            "--proxy-bypass-list=127.0.0.1;localhost",
            "--user-data-dir=" + profile,
        ],
        env,
        timeout: 45000,
    });
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("heading", { name: "阅读洞察", level: 1 }).waitFor({ timeout: 30000 });
    await page.getByRole("link", { name: title, exact: true }).first().waitFor({ timeout: 30000 });
    const version = await desktop.evaluate(({ app, BrowserWindow }) => ({
        version: app.getVersion(),
        packaged: app.isPackaged,
        windows: BrowserWindow.getAllWindows().length,
    }));
    assert.equal(version.version, values.version);
    assert.equal(version.packaged, true);
    const settings = await page.evaluate(async () => {
        const bridge = (
            globalThis as unknown as {
                latestNewsDesktop: {
                    getNewsApiUrl(): Promise<{ url: string }>;
                    setNewsApiUrl(value: string): Promise<unknown>;
                };
            }
        ).latestNewsDesktop;
        const before = await bridge.getNewsApiUrl();
        let rejected = false;
        try {
            await bridge.setNewsApiUrl("http://127.0.0.1:12345");
        } catch {
            rejected = true;
        }
        return { before, after: await bridge.getNewsApiUrl(), rejected };
    });
    assert.equal(settings.before.url, origin);
    assert.equal(settings.after.url, origin);
    assert.equal(settings.rejected, true);
    assert((requests["/api/v1/insights"] ?? 0) > 0);
    assert.equal(errors.length, 0, errors.join("; "));
    assert(
        Object.keys(requests).every((path) => Object.hasOwn(responses, path)),
        "Unexpected fixture route"
    );
    await desktop.close();
    desktop = undefined;
    console.log(
        "RESULT:" +
            JSON.stringify({
                result: "passed",
                version,
                headlineVisible: true,
                httpRejected: true,
                configUnchanged: true,
                certificate: "temporary trusted CA; no certificate override",
                sandboxDisabled: values["no-sandbox"],
                requests,
                pageErrors: errors.length,
                closed: true,
            })
    );
} finally {
    if (desktop) await desktop.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await rm(root, { recursive: true, force: true });
}
