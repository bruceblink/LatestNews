import { dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { sourceQualityWatchlist } from "../../shared/source-quality-watchlist";
import { createSourceQualityWindowReport } from "../../shared/source-quality-window";
import { parseSourceQualitySampleRecords } from "../../shared/source-quality-records";

interface ReportCommandOptions {
    input: string;
    output: string;
    origin?: string;
    from?: number;
    to?: number;
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
const records = parseSourceQualitySampleRecords(await readFile(inputPath, "utf8"));
const report = createSourceQualityWindowReport(records, {
    expectedSources: sourceQualityWatchlist,
    origin: options.origin,
    from: options.from,
    to: options.to,
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.info(`[source-quality] summarized ${report.sampleCount} samples for ${report.sources.length} source windows`);
console.info(`[source-quality] report=${outputPath}`);

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
        if (argument === "--") continue;
        const separator = argument.indexOf("=");
        const name = separator < 0 ? argument : argument.slice(0, separator);
        const inlineValue = separator < 0 ? undefined : argument.slice(separator + 1);
        const value = inlineValue ?? args[++index];
        if (!value) throw new Error(`Missing value for ${name}.`);
        if (name === "--input") parsed.input = value;
        else if (name === "--output") parsed.output = value;
        else if (name === "--origin") parsed.origin = value;
        else if (name === "--from") parsed.from = parseTimestamp(name, value);
        else if (name === "--to") parsed.to = parseTimestamp(name, value);
        else throw new Error(`Unknown option ${name}.`);
    }
    return parsed;
}

function parseTimestamp(name: string, value: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        throw new Error(`${name} must be an ISO timestamp with an explicit timezone.`);
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error(`Invalid timestamp for ${name}.`);
    return timestamp;
}

function printUsage() {
    console.info(`Usage: pnpm source-quality:report -- [options]

Options:
  --input path             JSONL sample file (default: ${DEFAULT_INPUT})
  --output path            JSON report file (default: ${DEFAULT_OUTPUT})
  --origin https://...     Include only one normalized sampling origin
  --from ISO-timestamp     Include samples at or after this time (timezone required)
  --to ISO-timestamp       Include samples at or before this time (default: now)
`);
}
