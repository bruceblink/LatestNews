import { stat, realpath } from "node:fs/promises";
import { sep, extname, resolve, relative, isAbsolute } from "node:path";

function isContainedPath(root: string, candidate: string) {
    const relativePath = relative(root, candidate);
    return (
        relativePath === "" ||
        (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
    );
}

export function isTrustedRendererUrl(candidate: string, trustedUrl: string) {
    try {
        const actual = new URL(candidate);
        const trusted = new URL(trustedUrl);
        return (
            actual.protocol === trusted.protocol &&
            actual.hostname === trusted.hostname &&
            actual.port === trusted.port &&
            actual.username === "" &&
            actual.password === ""
        );
    } catch {
        return false;
    }
}

/** Permit only web links and mail links from the shared renderer. */
export function getSafeExternalUrl(candidate: string) {
    try {
        const url = new URL(candidate);
        if (url.username || url.password) return null;
        if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "") return url.href;
        if (url.protocol === "mailto:" && /^[^\s@]+@[^\s@]+$/.test(url.pathname)) return url.href;
        return null;
    } catch {
        return null;
    }
}

/** Resolve a bundled renderer asset without following paths or symlinks outside the app resource directory. */
export async function resolveRendererFile(rendererRoot: string, requestPath: string) {
    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(requestPath);
    } catch {
        return null;
    }

    if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;

    const rootPath = resolve(rendererRoot);
    let realRoot: string;
    try {
        realRoot = await realpath(rootPath);
    } catch {
        return null;
    }

    const cleanPath = decodedPath.replace(/^\/+/, "");
    const candidatePath = resolve(rootPath, cleanPath);
    if (!isContainedPath(rootPath, candidatePath)) return null;

    const inspectFile = async (candidate: string) => {
        try {
            const canonicalPath = await realpath(candidate);
            if (!isContainedPath(realRoot, canonicalPath) || !(await stat(canonicalPath)).isFile()) return null;
            return canonicalPath;
        } catch {
            return null;
        }
    };

    const requestedFile = await inspectFile(candidatePath);
    if (requestedFile) return requestedFile;

    // Client-side routes have extensionless paths; real asset misses remain 404s.
    if (extname(cleanPath) !== "") return null;
    return inspectFile(resolve(rootPath, "index.html"));
}
