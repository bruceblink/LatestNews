import { defineEventHandler } from "h3";

export default defineEventHandler((event) => {
    const cloudflare = event.req.runtime?.cloudflare;
    if (!cloudflare) return;

    // Nitro's Pages entry carries bindings on the request. The db0 D1 connector
    // reads this global, which holds the same deployment binding across requests.
    const runtime = globalThis as typeof globalThis & { __env__?: Record<string, unknown> };
    (runtime.__env__ ??= {}).LATESTNEWS_DB = cloudflare.env.LATESTNEWS_DB;
});
