import { Buffer } from "buffer";

export function encodeBase64(str: string) {
    return Buffer.from(str).toString("base64");
}
