function getNumericStatus(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function getObjectProperty(target: unknown, key: string): unknown {
    return typeof target === "object" && target !== null && key in target
        ? (target as Record<string, unknown>)[key]
        : undefined;
}

export function getHttpErrorStatusCode(error: unknown): number | undefined {
    const directStatus =
        getNumericStatus(getObjectProperty(error, "statusCode")) ??
        getNumericStatus(getObjectProperty(error, "status"));
    if (directStatus) return directStatus;

    const response = getObjectProperty(error, "response");
    const responseStatus = getNumericStatus(getObjectProperty(response, "status"));
    if (responseStatus) return responseStatus;

    const responseData = getObjectProperty(response, "_data");
    return getNumericStatus(getObjectProperty(responseData, "statusCode"));
}

export function isAuthenticationError(error: unknown) {
    const statusCode = getHttpErrorStatusCode(error);
    return statusCode === 401 || statusCode === 403;
}
