export const publicApiPathPrefixes = ["/api/s", "/api/v1/sources", "/api/proxy", "/api/latest", "/api/mcp"] as const;

export function isPublicApiPath(pathname: string) {
    return publicApiPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
