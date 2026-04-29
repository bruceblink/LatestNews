import "~/styles/globals.css";
import "virtual:uno.css";

import type { QueryClient } from "@tanstack/react-query";

import clsx from "clsx";
import { usePWA } from "~/hooks/usePWA.ts";
import { useSync } from "~/hooks/useSync.ts";
import { Header } from "~/components/header";
import { Footer } from "~/components/footer";
import { isMobile } from "react-device-detect";
import { Toast } from "~/components/common/toast";
import { useOnReload } from "~/hooks/useOnReload.ts";
import { SearchBar } from "~/components/common/search-bar";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { GlobalOverlayScrollbar } from "~/components/common/overlay-scrollbar";
import { Outlet, Navigate, createRootRouteWithContext } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{
    queryClient: QueryClient;
}>()({
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
    return <Navigate to="/" />;
}

function RootComponent() {
    useOnReload();
    useSync();
    const pwa = usePWA();
    return (
        <>
            <GlobalOverlayScrollbar
                className={clsx([!isMobile && "px-4", "h-full overflow-x-auto", "md:(px-10)", "lg:(px-24)"])}
            >
                <header
                    className={clsx([
                        "grid items-center py-3 px-5",
                        "lg:(py-4)",
                        "sticky top-0 z-10",
                        "backdrop-blur-xl bg-zinc-50/92 dark:bg-[#0a0e1a]/82",
                        "border-b border-zinc-200/80 dark:border-zinc-700/30",
                    ])}
                    style={{
                        gridTemplateColumns: "50px auto 50px",
                    }}
                >
                    <Header />
                </header>
                <PwaStatusBanner
                    isOffline={pwa.isOffline}
                    needRefresh={pwa.needRefresh}
                    offlineReady={pwa.offlineReady}
                    justRecovered={pwa.justRecovered}
                    onUpdate={pwa.applyUpdate}
                />
                <main
                    className={clsx([
                        "mt-2",
                        "min-h-[calc(100vh-180px)]",
                        "md:(min-h-[calc(100vh-175px)])",
                        "lg:(min-h-[calc(100vh-194px)])",
                    ])}
                >
                    <Outlet />
                </main>
                <footer className="py-6 flex flex-col items-center justify-center text-sm text-rose-900/45 dark:text-cyan-500/40 font-mono border-t border-rose-900/10 dark:border-cyan-500/8">
                    <Footer />
                </footer>
            </GlobalOverlayScrollbar>
            <Toast />
            <SearchBar />
            {import.meta.env.DEV && (
                <>
                    <ReactQueryDevtools buttonPosition="bottom-left" />
                    <TanStackRouterDevtools position="bottom-right" />
                </>
            )}
        </>
    );
}

function PwaStatusBanner({
    isOffline,
    needRefresh,
    offlineReady,
    justRecovered,
    onUpdate,
}: {
    isOffline: boolean;
    needRefresh: boolean;
    offlineReady: boolean;
    justRecovered: boolean;
    onUpdate: () => Promise<void>;
}) {
    const showBanner = isOffline || needRefresh || justRecovered;
    if (!showBanner) return null;

    const iconClass = needRefresh
        ? "i-ph:rocket-launch-duotone text-cyan-400"
        : isOffline
          ? "i-ph:wifi-x-duotone text-amber-400"
          : "i-ph:wifi-high-duotone text-green-500 dark:text-emerald-300";

    const title = needRefresh ? "发现新版本" : isOffline ? "当前处于离线模式" : "网络已恢复";

    const description = needRefresh
        ? "刷新后可获取最新修复和内容体验。"
        : isOffline
          ? offlineReady
              ? "你仍可以浏览已缓存页面与最近访问过的内容。"
              : "当前网络不可用，正在等待连接恢复后刷新在线内容。"
          : "已切回在线内容拉取策略，稍后会自动补齐最新资讯。";

    return (
        <section className="mb-3 flex flex-col gap-2 rounded-xl bg-blue-500/6 dark:bg-cyan-500/5 px-4 py-3 shadow shadow-blue-500/10 dark:shadow-cyan-500/10 border border-blue-500/20 dark:border-cyan-500/15 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
                <span className={clsx("mt-0.5 text-lg", iconClass)} />
                <div>
                    <div className="font-semibold">{title}</div>
                    <div className="mt-1 text-sm op-75">{description}</div>
                </div>
            </div>
            {needRefresh && (
                <button
                    type="button"
                    className="rounded-full bg-cyan-500 px-4 py-2 text-sm text-zinc-900 font-semibold transition-all hover:bg-cyan-400"
                    onClick={() => void onUpdate()}
                >
                    立即更新
                </button>
            )}
        </section>
    );
}
