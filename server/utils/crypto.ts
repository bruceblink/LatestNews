import _md5 from "md5";
import { subtle as _ } from "uncrypto";

type T = typeof crypto.subtle;
const subtle: T = _;

export async function md5(s: string) {
    try {
        // https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
        // cloudflare worker support md5
        return await myCrypto(s, "MD5");
    } catch {
        return _md5(s);
    }
}

type Algorithm = "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
export async function myCrypto(s: string, algorithm: Algorithm) {
    const sUint8 = new TextEncoder().encode(s);
    const hashBuffer = await subtle.digest(algorithm, sUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
}

/**
 * 生成新闻 ID
 * @param rawId 原始 ID，如果有直接使用
 * @param url URL，如果没有 rawId，则使用 URL 做哈希
 * @returns string
 */
export function generateNewsId(rawId: string | null | undefined, url: string | null | undefined): string {
    const id = (rawId ?? "").trim();
    if (id !== "") return id;

    const link = (url ?? "").trim();
    if (link !== "") {
        // 简单同步哈希 (不需要 await)
        let hash = 0;
        for (let i = 0; i < link.length; i++) {
            // eslint-disable-next-line no-bitwise
            hash = (hash << 5) - hash + link.charCodeAt(i);
            // eslint-disable-next-line no-bitwise
            hash |= 0;
        }
        return hash.toString(16);
    }

    return crypto.randomUUID();
}
