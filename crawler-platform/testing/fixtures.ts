import { z } from "zod";

const responseSchema = z
    .object({
        status: z.number().int().min(100).max(599),
        headers: z.record(z.string(), z.string()).default({}),
        body: z
            .string()
            .max(2 * 1024 * 1024)
            .optional(),
        bodyFile: z.string().min(1).max(200).optional(),
    })
    .strict()
    .refine((response) => (response.body !== undefined) !== (response.bodyFile !== undefined), {
        message: "Set exactly one of body or bodyFile.",
    });

export const crawlerTestFixturesSchema = z
    .object({
        now: z.string().datetime().optional(),
        responses: z.record(z.string(), responseSchema),
        cases: z
            .array(
                z
                    .object({
                        sourceId: z.string().min(1).max(64),
                        parameters: z.unknown().optional(),
                        expectedItems: z.array(z.record(z.string(), z.unknown())).max(30),
                    })
                    .strict()
            )
            .min(1)
            .max(64),
    })
    .strict()
    .superRefine(({ responses }, context) => {
        const entries = Object.keys(responses);
        if (entries.length > 64) {
            context.addIssue({ code: "custom", path: ["responses"], message: "Define no more than 64 responses." });
        }
        for (const url of entries) {
            try {
                new URL(url);
            } catch {
                context.addIssue({ code: "custom", path: ["responses", url], message: "Response key must be a URL." });
            }
        }
    });

export type CrawlerTestFixtures = z.infer<typeof crawlerTestFixturesSchema>;
