import process from "node:process";
import { readFile } from "node:fs/promises";

import { evaluateNewsEventCorpus } from "./news-event-evaluation";

import type { NewsEventCorpus } from "./news-event-evaluation";

const file = process.argv[2] ?? new URL("../../test/fixtures/news-event-real-corpus.json", import.meta.url);
const corpus = JSON.parse(await readFile(file, "utf8")) as NewsEventCorpus;
console.log(JSON.stringify(evaluateNewsEventCorpus(corpus), null, 2));
