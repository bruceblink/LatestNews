import type { VitePWAOptions } from "vite-plugin-pwa";

import process from "node:process";
import { createHash } from "node:crypto";
import { VitePWA } from "vite-plugin-pwa";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";

export default function pwa(appTitle: string) {
    let shell: Buffer | undefined;
    const pwaOption: Partial<VitePWAOptions> = {
        includeAssets: ["icon.svg", "apple-touch-icon.png"],
        filename: "swx.js",
        manifest: {
            name: appTitle,
            short_name: appTitle,
            description: "Elegant reading of real-time and hottest news",
            theme_color: "#F14D42",
            icons: [
                {
                    src: "pwa-192x192.png",
                    sizes: "192x192",
                    type: "image/png",
                },
                {
                    src: "pwa-512x512.png",
                    sizes: "512x512",
                    type: "image/png",
                },
                {
                    src: "pwa-512x512.png",
                    sizes: "512x512",
                    type: "image/png",
                    purpose: "any",
                },
                {
                    src: "pwa-512x512.png",
                    sizes: "512x512",
                    type: "image/png",
                    purpose: "maskable",
                },
            ],
        },
        workbox: {
            navigateFallbackDenylist: [/^\/api/],
            // Cloudflare Pages emits its server bundle beside the browser assets.
            // It must never enter the PWA precache manifest.
            globIgnores: ["_worker.js/**", "output/**"],
        },
        integration: {
            async beforeBuildServiceWorker(options) {
                const root = resolve(
                    process.env.VERCEL ? ".vercel/output/static" : process.env.CF_PAGES ? "dist" : "dist/output/public"
                );
                // Nitro consumes the generated HTML before its server build finishes.
                shell ??= await readFile(join(root, "index.html"));
                const revision = createHash("sha256").update(shell).digest("hex");
                options.workbox.globDirectory = root;
                options.workbox.swDest = join(root, "swx.js");
                options.workbox.additionalManifestEntries = [
                    ...(options.workbox.additionalManifestEntries ?? []),
                    { url: "index.html", revision },
                ];
                options.workbox.globIgnores = [...(options.workbox.globIgnores ?? []), "index.html"];
            },
        },
        devOptions: {
            enabled: process.env.SW_DEV === "true",
            type: "module",
            navigateFallback: "index.html",
        },
    };

    return VitePWA(pwaOption);
}
