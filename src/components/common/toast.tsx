import type { ToastItem } from "~/atoms/types";

import clsx from "clsx";
import { Timer } from "~/utils";
import { useMount } from "react-use";
import { toastAtom } from "~/hooks/useToast";
import { useSetAtom, useAtomValue } from "jotai";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useRef, useState, useEffect, useCallback } from "react";

export function Toast() {
    const toastItems = useAtomValue(toastAtom);
    const [parent] = useAutoAnimate({ duration: 200 });
    return (
        <ol ref={parent} className="toast-stack" aria-label="通知" aria-live="polite" aria-relevant="additions text">
            {toastItems.map((k) => (
                <Item key={k.id} info={k} />
            ))}
        </ol>
    );
}

const colors = {
    success: "green",
    error: "red",
    warning: "orange",
    info: "blue",
};

function Item({ info }: { info: ToastItem }) {
    const color = colors[info.type ?? "info"];
    const setToastItems = useSetAtom(toastAtom);
    const hidden = useCallback(
        (dismiss = true) => {
            setToastItems((prev) => prev.filter((k) => k.id !== info.id));
            if (dismiss) {
                info.onDismiss?.();
            }
        },
        [info, setToastItems]
    );
    // @ts-ignore
    const timer = useRef<Timer>();

    useMount(() => {
        timer.current = new Timer(() => {
            hidden();
        }, info.duration ?? 5000);
        return () => timer.current?.clear();
    });

    const [hovered, setHovered] = useState(false);
    useEffect(() => {
        if (hovered) {
            timer.current?.pause();
        } else {
            timer.current?.resume();
        }
    }, [hovered]);

    return (
        <li
            className={clsx("toast-item bg-base rounded-lg shadow-xl relative")}
            role={info.type === "error" ? "alert" : "status"}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false);
            }}
        >
            <div
                className={clsx(
                    `bg-${color}-500 dark:bg-${color} bg-op-40! p2 backdrop-blur-5 rounded-lg w-full`,
                    "toast-item-content flex items-center gap-2"
                )}
            >
                <span className={`i-ph:info color-${color}-500`} aria-hidden="true" />
                <div className="flex justify-between w-full">
                    <span className="op-90 dark:op-100">{info.msg}</span>
                    {info.action && (
                        <button
                            type="button"
                            className={`text-sm color-${color}-500 bg-base op-80 bg-op-50! px-1 rounded min-w-10 hover:bg-op-70!`}
                            onClick={info.action.onClick}
                        >
                            {info.action.label}
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    title="关闭通知"
                    aria-label="关闭通知"
                    className={`toast-dismiss i-ph:x-circle-duotone color-${color}-500`}
                    onClick={() => hidden(false)}
                />
            </div>
        </li>
    );
}
