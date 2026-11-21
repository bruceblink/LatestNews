import { jwtVerify } from "jose";
import process from "node:process";
import { logger } from "#/utils/logger";
import { getHeader, getRequestURL, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
    const { pathname } = getRequestURL(event);
    // Only single-source reads can request a user-authorized refresh.
    if (!/^\/api\/v1\/sources\/[^/]+\/items\/?$/.test(pathname)) return;
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        event.context.disabledLogin = true;
        return;
    }

    const token = /^Bearer\s+(\S+)$/i.exec(getHeader(event, "authorization") ?? "")?.[1];
    if (!token) return;
    try {
        const { payload } = await jwtVerify<{ id?: string; type: string }>(token, new TextEncoder().encode(secret));
        if (payload.id) {
            event.context.user = { id: payload.id, type: payload.type };
        }
    } catch {
        logger.warn("JWT verification failed");
    }
});
