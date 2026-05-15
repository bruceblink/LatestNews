import { it, describe, expectTypeOf } from "vitest";

import type { SourceID, OriginSourceID } from "../shared/types";

describe("source id types", () => {
    it("uses generated sources as available source ids", () => {
        expectTypeOf<"weibo">().toExtend<SourceID>();
        expectTypeOf<"github-trending-today">().toExtend<SourceID>();
        expectTypeOf<"linuxdo-hot">().not.toExtend<SourceID>();
    });

    it("keeps origin source ids for server-side source declarations", () => {
        expectTypeOf<"linuxdo-hot">().toExtend<OriginSourceID>();
        expectTypeOf<"pcbeta-windows">().toExtend<OriginSourceID>();
        expectTypeOf<"not-a-source">().not.toExtend<OriginSourceID>();
    });
});
