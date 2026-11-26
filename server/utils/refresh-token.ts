import type { H3Event } from "h3";

import process from "node:process";
import { getHeader, setHeader, createError } from "h3";
import { createHash, timingSafeEqual } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

export function requireRefreshToken(event: H3Event) {
    setHeader(event, "Cache-Control", "no-store");
    const cloudflare = event.req.runtime?.cloudflare;
    const secret = cloudflare ? cloudflare.env.LATESTNEWS_REFRESH_TOKEN : process.env.LATESTNEWS_REFRESH_TOKEN;
    if (typeof secret !== "string" || !tokenPattern.test(secret))
        throw createError({ statusCode: 503, message: "Source refresh is not configured." });
    const token = /^Bearer\s+(\S+)$/i.exec(getHeader(event, "authorization") ?? "")?.[1];
    if (!token || !tokenPattern.test(token) || !timingSafeEqual(hashToken(token), hashToken(secret))) {
        setHeader(event, "WWW-Authenticate", "Bearer");
        throw createError({ statusCode: 401, message: "A valid source refresh token is required." });
    }
}

function hashToken(value: string) {
    return createHash("sha256").update(value).digest();
}
