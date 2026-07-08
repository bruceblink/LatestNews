import type { SourceHealthDiagnosticsResponse } from "@shared/source-health-diagnostics";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getSourceHealthSummary } from "#/utils/source-health";
import { getQuery, setHeader, createError, defineEventHandler } from "h3";
import {
    formatSourceHealthDiagnostics,
    createSourceHealthDiagnosticFilename,
    createSourceHealthDiagnosticsResponse,
} from "@shared/source-health-diagnostics";

const diagnosticsQuerySchema = z.object({
    format: z
        .union([z.literal("json"), z.literal("text"), z.array(z.enum(["json", "text"]))])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
});

export default defineEventHandler((event): SourceHealthDiagnosticsResponse | string => {
    try {
        const parsedQuery = diagnosticsQuerySchema.safeParse(getQuery(event));
        if (!parsedQuery.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid source health diagnostics query",
            });
        }

        const summary = getSourceHealthSummary();
        if (parsedQuery.data.format === "text") {
            setHeader(event, "content-type", "text/plain;charset=utf-8");
            setHeader(
                event,
                "content-disposition",
                `attachment; filename="${createSourceHealthDiagnosticFilename(summary)}"`
            );
            return formatSourceHealthDiagnostics(summary);
        }

        return createSourceHealthDiagnosticsResponse(summary);
    } catch (error) {
        logger.error(error);
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
