export const publicApiPathPrefixes = [
    "/api/s",
    "/api/v1/node",
    "/api/v1/openapi.json",
    "/api/v1/sources",
    "/api/v1/sources/batch",
    "/api/v1/health",
    "/api/v1/feeds",
    "/api/proxy",
    "/api/latest",
    "/api/mcp",
] as const;

export function isPublicApiPath(pathname: string) {
    return publicApiPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
