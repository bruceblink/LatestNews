import clsx from "clsx";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { currentColumnIDAtom } from "~/atoms";
import { useHistory } from "~/hooks/useHistory";
import { useSearchBar } from "~/hooks/useSearch.ts";
import { metadata, fixedColumnIds } from "@shared/metadata";
import { Link, useRouterState } from "@tanstack/react-router";

export function NavBar() {
    const currentId = useAtomValue(currentColumnIDAtom);
    const { toggle } = useSearchBar();
    const { history } = useHistory();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const isHistoryActive = pathname === "/history";

    const todayCount = useMemo(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return history.filter((item) => item.readAt >= start.getTime()).length;
    }, [history]);

    return (
        <span
            className={clsx([
                "flex p-3 rounded-2xl bg-primary/1 text-sm",
                "shadow shadow-primary/20 hover:shadow-primary/50 transition-shadow-500",
            ])}
        >
            {fixedColumnIds.map((columnId) => (
                <Link
                    key={columnId}
                    to="/c/$column"
                    params={{ column: columnId }}
                    className={clsx(
                        "px-2 hover:(bg-primary/10 rounded-md) cursor-pointer transition-all",
                        currentId === columnId ? "color-primary font-bold" : "op-70 dark:op-90"
                    )}
                >
                    {metadata[columnId].name}
                </Link>
            ))}
            <Link
                to="/history"
                className={clsx(
                    "relative px-2 hover:(bg-primary/10 rounded-md) cursor-pointer transition-all",
                    isHistoryActive ? "color-primary font-bold" : "op-70 dark:op-90"
                )}
            >
                历史
                {todayCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center px-0.5">
                        {todayCount > 99 ? "99+" : todayCount}
                    </span>
                )}
            </Link>
            <button
                type="button"
                onClick={() => toggle(true)}
                className={clsx(
                    "px-2 hover:(bg-primary/10 rounded-md) op-70 dark:op-90",
                    "cursor-pointer transition-all"
                )}
            >
                更多
            </button>
        </span>
    );
}
