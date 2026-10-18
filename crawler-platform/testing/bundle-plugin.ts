import { build } from "vite";

/** Bundle a TypeScript plugin into the same standalone ESM artifact used by both hosts. */
export async function bundleCrawlerPlugin(entryPath: string, outputDirectory: string) {
    await build({
        configFile: false,
        logLevel: "silent",
        publicDir: false,
        build: {
            emptyOutDir: true,
            lib: {
                entry: entryPath,
                formats: ["es"],
                fileName: "plugin.mjs",
            },
            outDir: outputDirectory,
            rollupOptions: {
                output: {
                    entryFileNames: "plugin.mjs",
                },
            },
            target: "node22",
        },
    });
}
