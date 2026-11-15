import clsx from "clsx";
import { useRef, useEffect } from "react";
import { Menu } from "~/components/header/menu";
import { SearchButton } from "~/components/header";
import { Link, useRouterState } from "@tanstack/react-router";
import {
    columnNavigation,
    workspaceNavigation,
    feedNavigationSearch,
    isAppNavigationActive,
} from "@shared/app-navigation";

/** Persistent desktop navigation and compact mobile account/search tools. */
export function AppShellSidebar() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const navRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const nav = navRef.current;
        const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [pathname]);

    return (
        <aside className="app-modern-sidebar" aria-label="主要导航">
            <Link to="/" className="app-shell-brand" aria-label="LatestNews 首页">
                <img src="/icon.svg" alt="" width="25" height="25" />
                <span>LatestNews</span>
            </Link>
            <div className="app-shell-search">
                <SearchButton />
            </div>
            <nav ref={navRef} className="app-shell-nav" aria-label="主要页面">
                <div className="app-shell-nav-group">
                    <span className="app-shell-nav-label">工作区</span>
                    {workspaceNavigation.map((item) => (
                        <WorkspaceLink key={item.key} item={item} pathname={pathname} />
                    ))}
                </div>
                <div className="app-shell-nav-group">
                    <span className="app-shell-nav-label">栏目</span>
                    {columnNavigation.map((item) => (
                        <Link
                            key={item.id}
                            to="/c/$column"
                            params={{ column: item.id }}
                            className={clsx(
                                "app-nav-item",
                                "app-shell-nav-link",
                                pathname === `/c/${item.id}` && "is-active"
                            )}
                            aria-current={pathname === `/c/${item.id}` ? "page" : undefined}
                        >
                            <span className={item.icon} aria-hidden="true" />
                            <span>{item.label}</span>
                        </Link>
                    ))}
                </div>
            </nav>
            <div className="app-shell-sidebar-footer">
                <div className="app-shell-tools">
                    <Menu
                        variant="account"
                        includeRepositoryActions={false}
                        showSettings={false}
                        desktopExtraItems={["settings", "installation", "theme"]}
                        mobileExtraItems={["search", "columns", "settings", "installation", "theme"]}
                    />
                </div>
            </div>
        </aside>
    );
}

export function AppMobileNavigation() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });

    return (
        <nav className="app-mobile-navigation" aria-label="移动端主要导航">
            <Link
                to="/insights"
                className="app-mobile-navigation-link"
                aria-current={isAppNavigationActive("home", pathname) ? "page" : undefined}
            >
                <span className={workspaceNavigation[0].icon} aria-hidden="true" />
                <span>首页</span>
            </Link>
            <Link
                to="/feed"
                search={feedNavigationSearch}
                className="app-mobile-navigation-link"
                aria-current={isAppNavigationActive("feed", pathname) ? "page" : undefined}
            >
                <span className={workspaceNavigation[1].icon} aria-hidden="true" />
                <span>统一 Feed</span>
            </Link>
            <Link
                to="/history"
                className="app-mobile-navigation-link"
                aria-current={isAppNavigationActive("history", pathname) ? "page" : undefined}
            >
                <span className={workspaceNavigation[2].icon} aria-hidden="true" />
                <span>阅读历史</span>
            </Link>
            <Link
                to="/health"
                className="app-mobile-navigation-link"
                aria-current={isAppNavigationActive("health", pathname) ? "page" : undefined}
            >
                <span className={workspaceNavigation[3].icon} aria-hidden="true" />
                <span>数据源健康</span>
            </Link>
        </nav>
    );
}

function WorkspaceLink({ item, pathname }: { item: (typeof workspaceNavigation)[number]; pathname: string }) {
    const active = isAppNavigationActive(item.key, pathname);
    if (item.key === "feed") {
        return (
            <Link
                to="/feed"
                search={feedNavigationSearch}
                className={clsx("app-nav-item", "app-shell-nav-link", active && "is-active")}
                aria-current={active ? "page" : undefined}
            >
                <span className={item.icon} aria-hidden="true" />
                <span>{item.label}</span>
            </Link>
        );
    }
    return (
        <Link
            to={item.path}
            className={clsx("app-nav-item", "app-shell-nav-link", active && "is-active")}
            aria-current={active ? "page" : undefined}
        >
            <span className={item.icon} aria-hidden="true" />
            <span>{item.label}</span>
        </Link>
    );
}
