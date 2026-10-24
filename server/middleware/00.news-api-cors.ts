import process from "node:process";
import { sendNoContent, getRequestHeader, setResponseHeader, defineEventHandler } from "h3";

const allowedMethods = "GET, HEAD, POST, OPTIONS";
const allowedHeaders = "Authorization, Content-Type";
const allowedOrigins = parseAllowedOrigins(process.env.LATESTNEWS_WEB_ORIGINS);

/** Allow only configured web origins to call the Node API without enabling credentialed CORS. */
export default defineEventHandler((event) => {
    const origin = getRequestHeader(event, "origin");
    if (!origin || !allowedOrigins.has(origin)) return undefined;

    setResponseHeader(event, "Access-Control-Allow-Origin", origin);
    setResponseHeader(event, "Access-Control-Allow-Methods", allowedMethods);
    setResponseHeader(event, "Access-Control-Allow-Headers", allowedHeaders);
    setResponseHeader(event, "Access-Control-Max-Age", "600");
    setResponseHeader(event, "Vary", "Origin");

    if (event.method === "OPTIONS" && getRequestHeader(event, "access-control-request-method")) {
        return sendNoContent(event, 204);
    }

    return undefined;
});

function parseAllowedOrigins(value?: string) {
    return new Set(
        (value ?? "")
            .split(",")
            .map((origin) => origin.trim())
            .filter(isHttpOrigin)
    );
}

function isHttpOrigin(value: string) {
    try {
        const url = new URL(value);
        return (
            url.origin === value &&
            (url.protocol === "https:" ||
                (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
        );
    } catch {
        return false;
    }
}
