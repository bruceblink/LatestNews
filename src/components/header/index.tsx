import type { SourceID } from "@shared/types";

import clsx from "clsx";
import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { useDark } from "~/hooks/useDark";
import { Link } from "@tanstack/react-router";
import { useSearchBar } from "~/hooks/useSearch";
import { useRefetch } from "~/hooks/useRefetch.ts";
import { useLoginState } from "~/hooks/useLogin.ts";
import { Version, PROJECT_URL } from "@shared/consts";
import { useIsFetching } from "@tanstack/react-query";
import { goToTopAtom, currentSourcesAtom } from "~/atoms";

import { Menu } from "./menu";
import { NavBar } from "../navbar";
import { SettingsButton } from "../settings/settings-button";

function GoTop() {
    const { ok, fn: goToTop } = useAtomValue(goToTopAtom);
    if (!ok) return null;
    return (
        <button
            type="button"
            title="回到顶部"
            aria-label="回到顶部"
            className="icon-button back-to-top"
            onClick={goToTop}
        >
            <span className="i-ph:arrow-up-duotone" aria-hidden="true" />
        </button>
    );
}

function Refresh() {
    const currentSources = useAtomValue(currentSourcesAtom);
    const { refresh } = useRefetch();
    const refreshAll = useCallback(() => refresh(...currentSources), [refresh, currentSources]);
    const isFetching = useIsFetching({
        predicate: (query) => {
            const [type, id] = query.queryKey as ["source" | "entire", SourceID];
            return (type === "source" && currentSources.includes(id)) || type === "entire";
        },
    });
    return (
        <button
            type="button"
            title="刷新来源"
            aria-label="刷新来源"
            className="icon-button header-refresh"
            onClick={refreshAll}
        >
            <span className={clsx("i-ph:arrow-clockwise-duotone", isFetching && "animate-spin")} aria-hidden="true" />
        </button>
    );
}

function ThemeToggle() {
    const { isDark, toggleDark } = useDark();
    const label = isDark ? "切换到亮色主题" : "切换到暗色主题";
    return (
        <button type="button" title={label} aria-label={label} className="icon-button" onClick={toggleDark}>
            <span className={isDark ? "i-ph:sun-duotone" : "i-ph:moon-stars-duotone"} aria-hidden="true" />
        </button>
    );
}

export function Header() {
    const { enableLogin } = useLoginState();
    const { toggle } = useSearchBar();
    return (
        <>
            <div className="header-brand">
                <Link to="/" className="brand-link" aria-label="LatestNews 首页">
                    <img className="brand-icon" src="/icon.svg" alt="" width="36" height="36" />
                    <span className="brand-wordmark">
                        Latest<span>News</span>
                    </span>
                </Link>
                <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`${PROJECT_URL}/releases/tag/v${Version}`}
                    className="version-badge"
                >
                    {`v${Version}`}
                </a>
            </div>
            <NavBar />
            <div className="header-actions">
                <GoTop />
                <button type="button" aria-label="打开搜索" className="header-search" onClick={() => toggle(true)}>
                    <span className="i-ph:magnifying-glass-duotone" aria-hidden="true" />
                    <span className="search-label">搜索来源</span>
                    <kbd aria-hidden="true">⌘ / Ctrl K</kbd>
                </button>
                <span className="action-divider" aria-hidden="true" />
                {enableLogin.enable && <Refresh />}
                <ThemeToggle />
                <SettingsButton />
                <a
                    className="icon-button header-github"
                    href={PROJECT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="GitHub 仓库"
                    aria-label="GitHub 仓库"
                >
                    <span className="i-ph:github-logo-duotone" aria-hidden="true" />
                </a>
                <Menu />
            </div>
        </>
    );
}
