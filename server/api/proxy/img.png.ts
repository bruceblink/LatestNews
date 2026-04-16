import { decodeBase64URL } from "#/utils/base64";
import { getQuery, sendProxy, createError, defineEventHandler } from "h3";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isPrivateHost(hostname: string) {
    return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^169\.254\./.test(hostname) ||
        /^fd[0-9a-f]{2}:/i.test(hostname)
    );
}

export default defineEventHandler(async (event) => {
    const { url: img, type = "encodeURIComponent" } = getQuery(event);
    if (img) {
        const url = type === "encodeURIComponent" ? decodeURIComponent(img as string) : decodeBase64URL(img as string);

        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw createError({ statusCode: 400, message: "Invalid URL" });
        }

        if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || isPrivateHost(parsed.hostname)) {
            throw createError({ statusCode: 403, message: "URL not allowed" });
        }

        return sendProxy(event, url, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Credentials": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        });
    }
    return undefined;
});
