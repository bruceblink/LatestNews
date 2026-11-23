import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { it, expect, describe } from "vitest";

describe("Cloudflare Pages Wrangler configuration", () => {
    it("binds the configured production D1 database to Nitro's name", async () => {
        const config = JSON.parse(await readFile(resolve("wrangler.json"), "utf8"));

        expect(config.pages_build_output_dir).toBe("dist");
        expect(config.d1_databases).toEqual([
            {
                binding: "LATESTNEWS_DB",
                database_name: "latestnews",
                database_id: "67688767-d6c3-452d-b8ac-6974f6fbefaa",
            },
        ]);
    });
});
