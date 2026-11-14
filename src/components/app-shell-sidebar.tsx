import clsx from "clsx";
import { HeaderActions } from "~/components/header";
import { Link, useRouterState } from "@tanstack/react-router";

/** 统一应用侧栏，提供所有页面都可访问的主要功能入口。 */
export function AppShellSidebar() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const active = (section: "home" | "feed" | "history" | "health") => {
        if (section === "home") return pathname === "/";
        if (section === "feed") return pathname === "/feed" || pathname.startsWith("/c/");
        // 来源详情属于来源管理流程，保持侧栏在详情页也有明确的当前项。
        if (section === "health") return pathname === "/health" || pathname.startsWith("/source/");
        return pathname === `/${section}`;
    };

    return (
        <aside className="app-modern-sidebar" aria-label="主要导航">
            <Link to="/insights" className="app-modern-brand" aria-label="LatestNews 首页">
                <img src="/icon.svg" alt="" width="36" height="36" />
                <span>
                    <strong>LatestNews</strong>
                    <small>新闻简阅</small>
                </span>
            </Link>
            <nav className="app-modern-nav">
                <ModernNavLink to="/" icon="i-ph:house-duotone" label="首页" active={active("home")} />
                <ModernNavLink
                    to="/feed"
                    search={{ q: undefined, scope: "hottest" }}
                    icon="i-ph:fire-duotone"
                    label="热点追踪"
                    active={active("feed")}
                />
                <ModernNavLink to="/history" icon="i-ph:article-duotone" label="选题参考" active={active("history")} />
                <ModernNavLink to="/health" icon="i-ph:stack-duotone" label="来源管理" active={active("health")} />
            </nav>
            <div className="app-modern-sidebar-tools" aria-label="应用工具">
                <HeaderActions className="app-modern-sidebar-actions" />
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
    to: "/" | "/feed" | "/history" | "/health";
    search?: { q?: string; scope?: "focus" | "hottest" | "realtime" | "broad" };
    icon: string;
    label: string;
    active: boolean;
}) {
    return (
        <Link
            to={to}
            search={search}
            className={clsx("app-modern-nav-link", active && "is-active")}
            aria-current={active ? "page" : undefined}
        >
            <span className={icon} aria-hidden="true" />
            <span>{label}</span>
        </Link>
    );
}
