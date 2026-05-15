import fs from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

import { originSources } from "../shared/pre-sources";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const iconsDir = join(projectDir, "public", "icons");

interface IconDownloadFailure {
    id: string;
    reason: string;
    url: string;
}

const downloadTimeoutMs = 5000;

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "unknown error";
}

async function downloadImage(url: string, outputPath: string, id: string): Promise<IconDownloadFailure | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), downloadTimeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            return {
                id,
                reason: `HTTP ${response.status}`,
                url,
            };
        }

        const image = await response.arrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(image));
        return null;
    } catch (error) {
        return {
            id,
            reason: controller.signal.aborted ? `timeout after ${downloadTimeoutMs}ms` : getErrorMessage(error),
            url,
        };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    const results = await Promise.all(
        Object.entries(originSources).map(async ([id, source]) => {
            try {
                const icon = join(iconsDir, `${id}.png`);
                if (fs.existsSync(icon)) {
                    // consola.info(`${id}: icon exists. skip.`)
                    return null;
                }
                if (!source.home) return null;
                const url = `https://icons.duckduckgo.com/ip3/${source.home.replace(/^https?:\/\//, "").replace(/\/$/, "")}.ico`;
                return await downloadImage(url, icon, id);
            } catch (e) {
                return {
                    id,
                    reason: getErrorMessage(e),
                    url: source.home ?? "",
                };
            }
        })
    );
    const failures = results.filter((failure): failure is IconDownloadFailure => !!failure);

    if (failures.length) {
        consola.warn(
            `Skipped ${failures.length} icon download${failures.length > 1 ? "s" : ""}. Existing/default icons will be used.`
        );
        failures.forEach((failure) => {
            consola.warn(`${failure.id}: ${failure.reason} (${failure.url})`);
        });
    }
}

void main();
