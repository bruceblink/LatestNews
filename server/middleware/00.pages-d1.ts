import { defineEventHandler } from "h3";

export default defineEventHandler((event) => {
    const cloudflare = event.req.runtime?.cloudflare;
    if (!cloudflare) return;

    // Nitro's Pages entry carries bindings on the request. The db0 D1 connector
    // reads these globals. Refresh the request binding every time so a later
    // request never reuses a binding object from an ended request context.
    const runtime = globalThis as typeof globalThis & {
        __env__?: Record<string, unknown>;
        __cf_env__?: Record<string, unknown>;
    };
    const binding = cloudflare.env.LATESTNEWS_DB;
    if (!binding) return;
    runtime.__env__ = { ...runtime.__env__, LATESTNEWS_DB: binding };
    runtime.__cf_env__ = { ...runtime.__cf_env__, LATESTNEWS_DB: binding };
});
