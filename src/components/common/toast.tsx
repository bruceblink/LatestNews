import type { ToastItem } from "~/atoms/types";

import clsx from "clsx";
import { Timer } from "~/utils";
import { toastAtom } from "~/hooks/useToast";
import { useSetAtom, useAtomValue } from "jotai";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useRef, useState, useEffect, useCallback } from "react";

export function Toast() {
    const toastItems = useAtomValue(toastAtom);
    const [parent] = useAutoAnimate({ duration: 200 });
    return (
        <ol
            ref={parent}
            className="toast-stack"
            aria-label="通知"
            aria-live="polite"
            aria-atomic="false"
            aria-relevant="additions text"
        >
            {toastItems.map((k) => (
                <Item key={k.id} info={k} />
            ))}
        </ol>
    );
}

const icons = {
    success: "i-ph:check-circle-duotone",
    error: "i-ph:x-circle-duotone",
    warning: "i-ph:warning-circle-duotone",
    info: "i-ph:info-duotone",
};

function Item({ info }: { info: ToastItem }) {
    const type = info.type ?? "info";
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
    const timer = useRef<Timer | undefined>(undefined);

    useEffect(() => {
        const current = new Timer(() => {
            hidden();
        }, info.duration ?? 5000);
        timer.current = current;
        return () => {
            current.clear();
            if (timer.current === current) timer.current = undefined;
        };
    }, [hidden, info.duration]);

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
            className={clsx("toast-item", `toast-item--${type}`)}
            role={type === "error" ? "alert" : "status"}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false);
            }}
        >
            <div className="toast-item-content">
                <span className={clsx("toast-icon", icons[type])} aria-hidden="true" />
                <div className="toast-message-group">
                    <span className="toast-message">{info.msg}</span>
                    {info.action && (
                        <button type="button" className="toast-action" onClick={info.action.onClick}>
                            {info.action.label}
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    title="关闭通知"
                    aria-label="关闭通知"
                    className="toast-dismiss i-ph:x"
                    onClick={() => hidden(false)}
                />
            </div>
        </li>
    );
}
