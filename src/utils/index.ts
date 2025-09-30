import type { MaybePromise } from "@shared/type.util";

import { $fetch } from "ofetch";

export function safeParseString(str: any) {
    try {
        return JSON.parse(str);
    } catch {
        return "";
    }
}

export class Timer {
    private timerId?: any;
    private start!: number;
    private remaining: number;
    private callback: () => MaybePromise<void>;

    constructor(callback: () => MaybePromise<void>, delay: number) {
        this.callback = callback;
        this.remaining = delay;
        this.resume();
    }

    pause() {
        clearTimeout(this.timerId);
        this.remaining -= Date.now() - this.start;
    }

    resume() {
        this.start = Date.now();
        clearTimeout(this.timerId);
        this.timerId = setTimeout(this.callback, this.remaining);
    }

    clear() {
        clearTimeout(this.timerId);
    }
}

export const myFetch = $fetch.create({
    timeout: 15000,
    retry: 0,
    baseURL: "/api",
});

export const apiFetch = $fetch.create({
    timeout: 15000,
    retry: 0,
    baseURL: `${import.meta.env.VITE_API_URL}`,
});

export function isiOS() {
    return (
        ["iPad Simulator", "iPhone Simulator", "iPod Simulator", "iPad", "iPhone", "iPod"].includes(
            navigator.platform
        ) ||
        (navigator.userAgent.includes("Mac") && "ontouchend" in document)
    );
}
