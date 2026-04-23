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
                "flex p-1.5 rounded-xl text-sm",
                "bg-zinc-800/60 border border-zinc-700/40",
                "backdrop-blur-sm",
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
                            ? "bg-cyan-500/15 text-cyan-300 font-semibold shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
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
                        ? "bg-cyan-500/15 text-cyan-300 font-semibold shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                )}
            >
                历史
                {todayCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-cyan-500 text-zinc-900 text-[9px] font-bold flex items-center justify-center px-0.5">
                        {todayCount > 99 ? "99+" : todayCount}
                    </span>
                )}
            </Link>
            <button
                type="button"
                onClick={() => toggle(true)}
                className={clsx(
                    "px-3 py-1 rounded-lg text-sm cursor-pointer transition-all",
                    "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                )}
            >
                更多
            </button>
        </span>
    );
}
