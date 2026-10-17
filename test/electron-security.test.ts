import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { it, expect, describe, afterEach, beforeEach } from "vitest";

import { getSafeExternalUrl, resolveRendererFile, isTrustedRendererUrl } from "../electron/security";

let rendererRoot: string;

beforeEach(async () => {
    rendererRoot = await mkdtemp(join(tmpdir(), "latestnews-electron-security-"));
    await mkdir(join(rendererRoot, "assets"));
    await writeFile(join(rendererRoot, "index.html"), "<main>LatestNews</main>");
    await writeFile(join(rendererRoot, "assets", "app.js"), "void 0;");
});

afterEach(async () => {
    await rm(rendererRoot, { recursive: true, force: true });
});

describe("Electron renderer boundaries", () => {
    it("falls back to the shared index for extensionless app routes", async () => {
        expect(await resolveRendererFile(rendererRoot, "/auth/callback")).toBe(join(rendererRoot, "index.html"));
    });

    it("serves assets by path and leaves missing asset paths as 404s", async () => {
        expect(await resolveRendererFile(rendererRoot, "/assets/app.js")).toBe(join(rendererRoot, "assets", "app.js"));
        expect(await resolveRendererFile(rendererRoot, "/assets/missing.js")).toBeNull();
    });

    it("rejects encoded traversal outside the renderer root", async () => {
        expect(await resolveRendererFile(rendererRoot, "/%2e%2e/outside.txt")).toBeNull();
    });

    it("trusts only the configured app origin", () => {
        expect(isTrustedRendererUrl("app://bundle/settings", "app://bundle/")).toBe(true);
        expect(isTrustedRendererUrl("app://attacker/settings", "app://bundle/")).toBe(false);
        expect(isTrustedRendererUrl("https://news.likanug.top/", "app://bundle/")).toBe(false);
    });

    it("opens only HTTP, HTTPS, and mail links", () => {
        expect(getSafeExternalUrl("https://news.likanug.top/item")).toBe("https://news.likanug.top/item");
        expect(getSafeExternalUrl("mailto:hello@example.com")).toBe("mailto:hello@example.com");
        expect(getSafeExternalUrl("file:///C:/Users/user/private.txt")).toBeNull();
        expect(getSafeExternalUrl("javascript:alert(1)")).toBeNull();
    });
});
