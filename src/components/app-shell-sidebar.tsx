import clsx from "clsx";
import { Link, useRouterState } from "@tanstack/react-router";
import { SearchButton, HeaderActions } from "~/components/header";
import { appNavigation, feedNavigationSearch, isAppNavigationActive } from "~/components/app-navigation";

/** 统一应用侧栏，提供所有页面都可访问的主要功能入口。 */
export function AppShellSidebar() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });

    return (
        <aside className="app-modern-sidebar" aria-label="主要导航">
            <Link to={appNavigation.home.path} className="app-modern-brand" aria-label="LatestNews 首页">
                <img src="/icon.svg" alt="" width="36" height="36" />
                <span>
                    <strong>LatestNews</strong>
                    <small>新闻简阅</small>
                </span>
            </Link>
            <SearchButton className="app-modern-sidebar-search" />
            <nav className="app-modern-nav">
                <ModernNavLink
                    to={appNavigation.home.path}
                    icon={appNavigation.home.icon}
                    label={appNavigation.home.label}
                    active={isAppNavigationActive("home", pathname)}
                />
                <ModernNavLink
                    to={appNavigation.feed.path}
                    search={feedNavigationSearch}
                    icon={appNavigation.feed.icon}
                    label={appNavigation.feed.label}
                    active={isAppNavigationActive("feed", pathname)}
                />
                <ModernNavLink
                    to={appNavigation.history.path}
                    icon={appNavigation.history.icon}
                    label={appNavigation.history.label}
                    active={isAppNavigationActive("history", pathname)}
                />
                <ModernNavLink
                    to={appNavigation.health.path}
                    icon={appNavigation.health.icon}
                    label={appNavigation.health.label}
                    active={isAppNavigationActive("health", pathname)}
                />
            </nav>
            <div className="app-modern-sidebar-tools" aria-label="应用工具">
                <HeaderActions className="app-modern-sidebar-actions" includeSearch={false} />
                <Link
                    to={appNavigation.settings.path}
                    className={clsx(
                        "app-nav-item",
                        "app-modern-settings-link",
                        isAppNavigationActive("settings", pathname) && "is-active"
                    )}
                    aria-current={isAppNavigationActive("settings", pathname) ? "page" : undefined}
                >
                    <span className={appNavigation.settings.icon} aria-hidden="true" />
                    <span>{appNavigation.settings.label}</span>
                </Link>
            </div>
        </aside>
    );
}

function ModernNavLink({
    to,
    search,
    icon,
    label,
    active,
}: {
    to: "/insights" | "/feed" | "/history" | "/health" | "/settings";
    search?: { q?: string; scope?: "focus" | "hottest" | "realtime" | "broad" };
    icon: string;
    label: string;
    active: boolean;
}) {
    return (
        <Link
            to={to}
            search={search}
            className={clsx("app-nav-item", "app-modern-nav-link", active && "is-active")}
            aria-current={active ? "page" : undefined}
        >
            <span className={icon} aria-hidden="true" />
            <span>{label}</span>
        </Link>
    );
}
