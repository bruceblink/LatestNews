import { defineEventHandler } from "h3";
import { getSourceHealthSummary } from "#/utils/source-health";

export default defineEventHandler(() => {
    return getSourceHealthSummary();
});
