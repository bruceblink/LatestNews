import { Link, useRouterState } from "@tanstack/react-router";
import { getAppNavigationContext } from "@shared/app-navigation";

/** Compact route context for the shared application shell. */
export function AppShellHeader() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const context = getAppNavigationContext(pathname);

    return (
        <header className="app-shell-header">
            <div className="app-shell-breadcrumb">
                <Link to="/" className="app-shell-breadcrumb-root">
                    LatestNews
                </Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page" className="app-shell-breadcrumb-current">
                    {context.path === "/insights" ? "阅读洞察" : context.label}
                </span>
            </div>
        </header>
    );
}
