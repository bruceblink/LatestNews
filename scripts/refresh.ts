import { HomePage } from "@shared/consts.ts";

import sources from "../shared/sources.json";

Promise.all(Object.keys(sources).map((id) => fetch(`${HomePage}/api/s?id=${id}`))).catch(console.error);
