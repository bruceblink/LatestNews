import type { ToastItem } from "~/atoms/types";

import { useCallback } from "react";
import { atom, useSetAtom } from "jotai";

export const toastAtom = atom<ToastItem[]>([]);
export function useToast() {
    const setToastItems = useSetAtom(toastAtom);
    return useCallback(
        (msg: string, props?: Omit<ToastItem, "id" | "msg">) => {
            setToastItems((prev) => [
                {
                    msg,
                    id: Date.now(),
                    ...props,
                },
                ...prev,
            ]);
        },
        [setToastItems]
    );
}
