import type { SourceResponse } from "@shared/types";
import type { NewsInsightOptions } from "@shared/news-insights";

import { createNewsInsights } from "@shared/news-insights";

export function createServerNewsInsights(responses: SourceResponse[], options?: NewsInsightOptions) {
    return createNewsInsights(responses, options);
}
