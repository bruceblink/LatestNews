import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, appendFile } from "node:fs/promises";

import { sourceQualityWatchlist, getSourceQualityWatchlistEntry } from "../../shared/source-quality-watchlist";
import {
    sampleSourceQuality,
    SOURCE_QUALITY_SAMPLE_TIMEOUT_MS,
    normalizeSourceQualitySampleOrigin,
} from "../../shared/source-quality-sampling";

import type { SourceQualitySamplingRun } from "../../shared/source-quality-sampling";

interface SampleCommandOptions {
    origin?: string;
    output: string;
    samples: number;
    intervalMs: number;
    timeoutMs: number;
    sourceIds?: string[];
}

const DEFAULT_OUTPUT = ".data/source-quality/samples.jsonl";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

const options = parseOptions(process.argv.slice(2));
if (options.help) {
    printUsage();
    process.exit(0);
}

const originInput = options.origin ?? process.env.LATESTNEWS_QUALITY_SAMPLE_ORIGIN;
if (!originInput) {
    throw new Error("Provide --origin or LATESTNEWS_QUALITY_SAMPLE_ORIGIN.");
}
const origin = normalizeSourceQualitySampleOrigin(originInput);
if (new URL(origin).protocol === "https:" && options.intervalMs < DEFAULT_INTERVAL_MS) {
    throw new Error("Public sampling requires an interval of at least 900000 ms.");
}
const selectedSources = options.sourceIds
    ? [...new Set(options.sourceIds)].map((sourceId) => {
          const source = getSourceQualityWatchlistEntry(sourceId);
          if (!source) throw new Error(`Source ${sourceId} is not in the quality watchlist.`);
          return source;
      })
    : [...sourceQualityWatchlist];
if (!selectedSources.length) throw new Error("Select at least one watchlist source.");
const outputPath = resolve(process.cwd(), options.output);
const run: SourceQualitySamplingRun = {
    id: randomUUID(),
    startedAt: Date.now(),
    ...readGitState(),
    nodeVersion: process.version,
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
};

await mkdir(dirname(outputPath), { recursive: true });
console.info(`[source-quality] run=${run.id} commit=${run.commit} dirty=${run.workingTreeDirty} origin=${origin}`);
for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
    for (const source of selectedSources) {
        const record = {
            ...(await sampleSourceQuality(source, { origin, timeoutMs: options.timeoutMs })),
            run,
            round: sampleIndex + 1,
        };
        await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
        console.info(
            `[source-quality] ${record.sourceId} ${record.status} ${record.itemCount} items ${record.durationMs} ms`
        );
    }
    if (sampleIndex + 1 < options.samples && options.intervalMs > 0) {
        await wait(options.intervalMs);
    }
}

console.info(`[source-quality] appended ${selectedSources.length * options.samples} samples to ${outputPath}`);

function parseOptions(args: string[]) {
    const parsed: SampleCommandOptions & { help?: boolean } = {
        output: DEFAULT_OUTPUT,
        samples: 1,
        intervalMs: DEFAULT_INTERVAL_MS,
        timeoutMs: SOURCE_QUALITY_SAMPLE_TIMEOUT_MS,
    };

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--help" || argument === "-h") {
            parsed.help = true;
            continue;
        }
        if (argument === "--") continue;
        const separator = argument.indexOf("=");
        const name = separator < 0 ? argument : argument.slice(0, separator);
        const inlineValue = separator < 0 ? undefined : argument.slice(separator + 1);
        const value = inlineValue ?? args[++index];
        if (!value) throw new Error(`Missing value for ${name}.`);
        if (name === "--origin") parsed.origin = value;
        else if (name === "--output") parsed.output = value;
        else if (name === "--samples") parsed.samples = parsePositiveInteger(name, value);
        else if (name === "--interval-ms") parsed.intervalMs = parseNonNegativeInteger(name, value);
        else if (name === "--timeout-ms") parsed.timeoutMs = parsePositiveInteger(name, value);
        else if (name === "--source")
            parsed.sourceIds = value
                .split(",")
                .map((sourceId) => sourceId.trim())
                .filter(Boolean);
        else throw new Error(`Unknown option ${name}.`);
    }

    return parsed;
}

function parsePositiveInteger(name: string, value: string) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
    return parsed;
}

function parseNonNegativeInteger(name: string, value: string) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
    return parsed;
}

function wait(durationMs: number) {
    return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, durationMs));
}

/** Record only commit metadata; Git failures remain explicit and never expose repository diagnostics. */
function readGitState() {
    try {
        const gitOptions: ExecFileSyncOptionsWithStringEncoding = {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: 5_000,
            stdio: ["ignore", "pipe", "ignore"],
        };
        const commit = execFileSync("git", ["rev-parse", "HEAD"], gitOptions).trim();
        const status = execFileSync("git", ["status", "--porcelain"], gitOptions);
        return { commit, workingTreeDirty: status.trim().length > 0 };
    } catch {
        return { commit: "unknown", workingTreeDirty: true };
    }
}

function printUsage() {
    console.info(`Usage: pnpm source-quality:sample -- --origin https://news.example.com [options]

Options:
  --source id1,id2       Sample only watchlist sources
  --samples number       Number of rounds (default: 1)
  --interval-ms number   Delay between rounds (default: 900000)
  --timeout-ms number    Per-source timeout (default: 20000)
  --output path          JSONL output path (default: ${DEFAULT_OUTPUT})

HTTPS sampling requires --interval-ms >= 900000. Run 673 rounds at the default
interval to observe at least 7 days. Git metadata describes this tool, not the deployment.
`);
}
