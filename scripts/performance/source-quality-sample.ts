import { dirname, resolve } from "node:path";
import { mkdir, appendFile } from "node:fs/promises";

import { sourceQualityWatchlist, getSourceQualityWatchlistEntry } from "../../shared/source-quality-watchlist";
import {
    sampleSourceQuality,
    SOURCE_QUALITY_SAMPLE_TIMEOUT_MS,
    normalizeSourceQualitySampleOrigin,
} from "../../shared/source-quality-sampling";

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
const selectedSources = options.sourceIds?.map((sourceId) => {
    const source = getSourceQualityWatchlistEntry(sourceId);
    if (!source) throw new Error(`Source ${sourceId} is not in the quality watchlist.`);
    return source;
}) ?? [...sourceQualityWatchlist];
const outputPath = resolve(process.cwd(), options.output);

await mkdir(dirname(outputPath), { recursive: true });
for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
    for (const source of selectedSources) {
        const record = await sampleSourceQuality(source, { origin, timeoutMs: options.timeoutMs });
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
        const [name, inlineValue] = argument.split("=", 2);
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
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
    return parsed;
}

function parseNonNegativeInteger(name: string, value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
    return parsed;
}

function wait(durationMs: number) {
    return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, durationMs));
}

function printUsage() {
    console.info(`Usage: pnpm source-quality:sample -- --origin https://news.example.com [options]

Options:
  --source id1,id2       Sample only watchlist sources
  --samples number       Number of rounds (default: 1)
  --interval-ms number   Delay between rounds (default: 900000)
  --timeout-ms number    Per-source timeout (default: 20000)
  --output path          JSONL output path (default: ${DEFAULT_OUTPUT})
`);
}
