import { defineEventHandler } from "h3";
import { getSourceHealthSummary } from "#/utils/source-health";
import { initializeCrawlerPluginCatalog } from "#/utils/crawler-plugin-runtime";

export default defineEventHandler(() => {
    initializeCrawlerPluginCatalog();
    return getSourceHealthSummary();
});
