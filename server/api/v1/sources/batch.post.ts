import type { SourceBatchResponse } from "@shared/source-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { readBody, createError, defineEventHandler } from "h3";

import { hasSourceBatchSelector, resolveSourceBatchPayload } from "../../../utils/resolve-source-batch";

const stringOrArraySchema = z.union([z.string(), z.array(z.string())]);
const sourceBatchSchema = z.object({
    column: stringOrArraySchema.optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    since: z.union([z.string(), z.number()]).optional(),
    source: stringOrArraySchema.optional(),
    sources: z.array(z.string()).max(100).optional(),
    type: stringOrArraySchema.optional(),
});

export default defineEventHandler(async (event): Promise<SourceBatchResponse> => {
    try {
        const parsedBody = sourceBatchSchema.safeParse(await readBody(event));
        if (!parsedBody.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid source batch payload",
            });
        }

        const payload = parsedBody.data;
        if (!hasSourceBatchSelector(payload)) {
            throw createError({
                statusCode: 400,
                message: "At least one source selector is required",
            });
        }

        return await resolveSourceBatchPayload(payload);
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
