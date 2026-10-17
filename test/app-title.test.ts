import { it, expect, describe } from "vitest";

import { escapeHtmlText, resolveAppTitle, DEFAULT_APP_TITLE } from "../shared/app-title";

describe("application title", () => {
    it("uses the product name when the deployment title is missing or blank", () => {
        expect(resolveAppTitle(undefined)).toBe("LatestNews");
        expect(resolveAppTitle(null)).toBe("LatestNews");
        expect(resolveAppTitle("  ")).toBe("LatestNews");
        expect(DEFAULT_APP_TITLE).toBe("LatestNews");
    });

    it("trims a configured title", () => {
        expect(resolveAppTitle("  Latest News  ")).toBe("Latest News");
    });

    it("escapes configured text before inserting it into HTML", () => {
        expect(escapeHtmlText("A & <B> \"News\" 'Daily'")).toBe("A &amp; &lt;B&gt; &quot;News&quot; &#39;Daily&#39;");
    });
});
