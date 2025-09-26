import type { Source, SourceID } from "@shared/types.ts";

import _sources from "./sources.json";

export const dataSources = _sources as Record<SourceID, Source>;
export default dataSources;
