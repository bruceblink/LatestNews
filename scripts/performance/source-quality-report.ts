import { dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { sourceQualityWatchlist } from "../../shared/source-quality-watchlist";
import { createSourceQualityWindowReport } from "../../shared/source-quality-window";

import type { SourceQualitySampleRecord } from "../../shared/source-quality-sampling";

interface ReportCommandOptions {
    input: string;
    output: string;
    origin?: string;
}

const DEFAULT_INPUT = ".data/source-quality/samples.jsonl";
const DEFAULT_OUTPUT = ".data/source-quality/report.json";
const options = parseOptions(process.argv.slice(2));

if (options.help) {
    printUsage();
    process.exit(0);
}

const inputPath = resolve(process.cwd(), options.input);
const outputPath = resolve(process.cwd(), options.output);
const records = parseRecords(await readFile(inputPath, "utf8"), options.origin);
const report = createSourceQualityWindowReport(records, {
    expectedSources: sourceQualityWatchlist,
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.info(`[source-quality] summarized ${records.length} samples for ${report.sources.length} source windows`);
console.info(`[source-quality] report=${outputPath}`);

function parseRecords(content: string, origin?: string): SourceQualitySampleRecord[] {
    const sampleRecords: SourceQualitySampleRecord[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch {
            throw new Error(`Invalid JSON on line ${index + 1} of the sample file.`);
        }
        if (!isSampleRecord(value)) {
            throw new Error(`Invalid source quality sample on line ${index + 1}.`);
        }
        if (!origin || value.origin === origin) sampleRecords.push(value);
    }
    return sampleRecords;
}

function isSampleRecord(value: unknown): value is SourceQualitySampleRecord {
    if (!isRecord(value)) return false;
    return (
        typeof value.sampledAt === "number" &&
        Number.isFinite(value.sampledAt) &&
        typeof value.origin === "string" &&
        typeof value.sourceId === "string" &&
        typeof value.kind === "string" &&
        typeof value.purpose === "string" &&
        typeof value.durationMs === "number" &&
        Number.isFinite(value.durationMs) &&
        typeof value.status === "string" &&
        typeof value.itemCount === "number" &&
        Number.isInteger(value.itemCount) &&
        value.itemCount >= 0
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptions(args: string[]) {
    const parsed: ReportCommandOptions & { help?: boolean } = {
        input: DEFAULT_INPUT,
        output: DEFAULT_OUTPUT,
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
        if (name === "--input") parsed.input = value;
        else if (name === "--output") parsed.output = value;
        else if (name === "--origin") parsed.origin = value;
        else throw new Error(`Unknown option ${name}.`);
    }
    return parsed;
}

function printUsage() {
    console.info(`Usage: pnpm source-quality:report -- [options]

Options:
  --input path             JSONL sample file (default: ${DEFAULT_INPUT})
  --output path            JSON report file (default: ${DEFAULT_OUTPUT})
  --origin https://...     Include only one normalized sampling origin
`);
}
