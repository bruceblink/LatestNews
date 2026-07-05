export function getOrCreateInFlightRequest<T>(
    requests: Map<string, Promise<T>>,
    key: string,
    createRequest: () => Promise<T>
) {
    const existingRequest = requests.get(key);
    if (existingRequest) return existingRequest;

    const request = createRequest().finally(() => {
        if (requests.get(key) === request) {
            requests.delete(key);
        }
    });
    requests.set(key, request);
    return request;
}
