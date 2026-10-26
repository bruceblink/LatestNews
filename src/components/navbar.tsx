import clsx from "clsx";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { metadata } from "@shared/metadata";
import { getTodayStart } from "~/utils/date";
import { currentColumnIDAtom } from "~/atoms";
import { fixedColumnIds } from "@shared/types";
import { useHistory } from "~/hooks/useHistory";
import { Link, useRouterState } from "@tanstack/react-router";

const columnIcons = {
    focus: "i-ph:star-duotone",
    hottest: "i-ph:fire-duotone",
    realtime: "i-ph:lightning-duotone",
};

export function NavBar() {
    const currentId = useAtomValue(currentColumnIDAtom);
    const { history } = useHistory();
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const isColumnActive = pathname === "/" || pathname.startsWith("/c/");
    const todayCount = useMemo(() => {
        const start = getTodayStart();
        return history.filter((item) => item.readAt >= start).length;
    }, [history]);

    return (
        <nav className="primary-nav" aria-label="主导航">
            {fixedColumnIds.map((columnId) => {
                const active = isColumnActive && currentId === columnId;
                return (
                    <Link
                        key={columnId}
                        to="/c/$column"
                        params={{ column: columnId }}
                        className={clsx("nav-link", active && "is-active")}
                        aria-current={active ? "page" : undefined}
                    >
                        <span className={columnIcons[columnId]} aria-hidden="true" />
                        <span>{metadata[columnId].name}</span>
                    </Link>
                );
            })}
            <span className="nav-divider" aria-hidden="true" />
            <Link
                to="/feed"
                search={{ q: undefined, scope: undefined }}
                className={clsx("nav-link", pathname === "/feed" && "is-active")}
                aria-current={pathname === "/feed" ? "page" : undefined}
            >
                <span className="i-ph:newspaper-duotone" aria-hidden="true" />
                <span>Feed</span>
            </Link>
            <Link
                to="/insights"
                className={clsx("nav-link", pathname === "/insights" && "is-active")}
                aria-current={pathname === "/insights" ? "page" : undefined}
            >
                <span className="i-ph:chart-line-up-duotone" aria-hidden="true" />
                <span>洞察</span>
            </Link>
            <Link
                to="/history"
                className={clsx("nav-link", pathname === "/history" && "is-active")}
                aria-current={pathname === "/history" ? "page" : undefined}
            >
                <span className="i-ph:clock-counter-clockwise-duotone" aria-hidden="true" />
                <span>历史</span>
                {todayCount > 0 && <span className="nav-count">{todayCount > 99 ? "99+" : todayCount}</span>}
            </Link>
        </nav>
    );
}
