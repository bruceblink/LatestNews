import { HOME_PAGE } from "@shared/consts.ts";

import sources from "../shared/sources.json";

Promise.all(Object.keys(sources).map((id) => fetch(`${HOME_PAGE}/api/s?id=${id}`))).catch(console.error);
