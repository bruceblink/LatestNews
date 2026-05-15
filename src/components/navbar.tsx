import clsx from "clsx";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { metadata } from "@shared/metadata";
import { getTodayStart } from "~/utils/date";
import { currentColumnIDAtom } from "~/atoms";
import { fixedColumnIds } from "@shared/types";
import { useHistory } from "~/hooks/useHistory";
import { useSearchBar } from "~/hooks/useSearch.ts";
import { Link, useRouterState } from "@tanstack/react-router";

export function NavBar() {
    const currentId = useAtomValue(currentColumnIDAtom);
    const { toggle } = useSearchBar();
    const { history } = useHistory();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const isHistoryActive = pathname === "/history";

    const todayCount = useMemo(() => {
        const start = getTodayStart();
        return history.filter((item) => item.readAt >= start).length;
    }, [history]);

    return (
        <span
            className={clsx([
                "flex p-1 rounded-xl text-sm",
                "bg-zinc-50/92 dark:bg-zinc-900/68 border border-zinc-200/90 dark:border-zinc-700/30",
                "backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
            ])}
        >
            {fixedColumnIds.map((columnId) => (
                <Link
                    key={columnId}
                    to="/c/$column"
                    params={{ column: columnId }}
                    className={clsx(
                        "px-3 py-1 rounded-lg cursor-pointer transition-all text-sm",
                        currentId === columnId
                            ? "bg-white/95 dark:bg-zinc-800/85 text-zinc-900 dark:text-zinc-200 border border-zinc-300/85 dark:border-zinc-600/45"
                            : "text-zinc-700 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-200/75 dark:hover:bg-zinc-800/55"
                    )}
                >
                    {metadata[columnId].name}
                </Link>
            ))}
            <Link
                to="/history"
                className={clsx(
                    "relative px-3 py-1 rounded-lg cursor-pointer transition-all text-sm",
                    isHistoryActive
                        ? "bg-white/95 dark:bg-zinc-800/90 text-zinc-800 dark:text-zinc-200 border border-zinc-300/80 dark:border-zinc-600/50"
                        : "text-zinc-600 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/55"
                )}
            >
                历史
                {todayCount > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4.5 h-4.5 rounded-full bg-red-500/92 dark:bg-blue-400/88 text-zinc-900 text-[10px] font-semibold leading-none flex items-center justify-center px-1 ring-1 ring-white/80 dark:ring-zinc-900/70 shadow-sm">
                        {todayCount > 99 ? "99+" : todayCount}
                    </span>
                )}
            </Link>
            <button
                type="button"
                onClick={() => toggle(true)}
                className={clsx(
                    "px-3 py-1 rounded-lg text-sm cursor-pointer transition-all",
                    "text-zinc-600 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/55"
                )}
            >
                更多
            </button>
        </span>
    );
}
