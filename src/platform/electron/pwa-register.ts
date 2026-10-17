/** The desktop app is updated by installing a new app version, not by a service worker. */
export function useRegisterSW() {
    return {
        updateServiceWorker: async () => undefined,
        offlineReady: [false] as const,
        needRefresh: [false] as const,
    };
}
