import type { MaybePromise } from "@shared/type.util";

/**
 * Update<T> 表示可以直接传入新值，或者传入 (prev => next) 的 updater 函数
 */
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
