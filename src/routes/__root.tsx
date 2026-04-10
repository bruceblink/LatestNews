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
                    className={clsx(["grid items-center py-4 px-5", "lg:(py-6)", "sticky top-0 z-10 backdrop-blur-md"])}
                    style={{
                        gridTemplateColumns: "50px auto 50px",
                    }}
                >
                    <Header />
                </header>
                <PwaStatusBanner isOffline={pwa.isOffline} needRefresh={pwa.needRefresh} onUpdate={pwa.applyUpdate} />
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
                <footer className="py-6 flex flex-col items-center justify-center text-sm text-neutral-500 font-mono">
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
    onUpdate,
}: {
    isOffline: boolean;
    needRefresh: boolean;
    onUpdate: () => Promise<void>;
}) {
    if (!isOffline && !needRefresh) return null;

    return (
        <section className="mb-3 flex flex-col gap-2 rounded-2xl bg-primary/6 px-4 py-3 shadow shadow-primary/8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
                <span
                    className={clsx(
                        "mt-0.5 text-lg",
                        needRefresh
                            ? "i-ph:rocket-launch-duotone text-primary-600 dark:text-primary-300"
                            : "i-ph:wifi-x-duotone text-amber-600 dark:text-amber-300"
                    )}
                />
                <div>
                    <div className="font-semibold">{needRefresh ? "发现新版本" : "当前处于离线模式"}</div>
                    <div className="mt-1 text-sm op-75">
                        {needRefresh
                            ? "刷新后可获取最新修复和内容体验。"
                            : "你仍可以浏览已缓存页面与最近访问过的内容。"}
                    </div>
                </div>
            </div>
            {needRefresh && (
                <button
                    type="button"
                    className="rounded-full bg-primary px-4 py-2 text-sm text-white transition-all hover:opacity-90"
                    onClick={() => void onUpdate()}
                >
                    立即更新
                </button>
            )}
        </section>
    );
}
