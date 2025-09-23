import type { MaybePromise } from "@shared/type.util";

export type Update<T> = T | ((prev: T) => T);

export interface ToastItem {
    id: number;
    type?: "success" | "error" | "warning" | "info";
    msg: string;
    duration?: number;
    action?: {
        label: string;
        onClick: () => MaybePromise<void>;
    };
    onDismiss?: () => MaybePromise<void>;
}
