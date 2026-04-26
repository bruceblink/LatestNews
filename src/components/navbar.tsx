import clsx from "clsx";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { getTodayStart } from "~/utils/date";
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
        const start = getTodayStart();
        return history.filter((item) => item.readAt >= start).length;
    }, [history]);

    return (
        <span
            className={clsx([
                "flex p-1 rounded-xl text-sm",
                "bg-zinc-900/70 border border-zinc-700/35",
                "backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
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
                            ? "bg-zinc-800/90 text-zinc-200 border border-zinc-600/50"
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/55"
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
                        ? "bg-zinc-800/90 text-zinc-200 border border-zinc-600/50"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/55"
                )}
            >
                历史
                {todayCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-zinc-200 text-zinc-900 text-[9px] font-bold flex items-center justify-center px-0.5">
                        {todayCount > 99 ? "99+" : todayCount}
                    </span>
                )}
            </Link>
            <button
                type="button"
                onClick={() => toggle(true)}
                className={clsx(
                    "px-3 py-1 rounded-lg text-sm cursor-pointer transition-all",
                    "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/55"
                )}
            >
                更多
            </button>
        </span>
    );
}
