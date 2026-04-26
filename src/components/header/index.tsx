import type { SourceID } from "@shared/types";

import clsx from "clsx";
import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { useDark } from "~/hooks/useDark";
import { Link } from "@tanstack/react-router";
import { useRefetch } from "~/hooks/useRefetch.ts";
import { useLoginState } from "~/hooks/useLogin.ts";
import { Version, PROJECT_URL } from "@shared/consts";
import { useIsFetching } from "@tanstack/react-query";
import { goToTopAtom, currentSourcesAtom } from "~/atoms";

import { Menu } from "./menu";
import { NavBar } from "../navbar";

function GoTop() {
    const { ok, fn: goToTop } = useAtomValue(goToTopAtom);
    return (
        <button
            type="button"
            title="Go To Top"
            className={clsx("i-ph:arrow-fat-up-duotone", ok ? "op-65 text-zinc-700 dark:text-zinc-300 btn" : "op-0")}
            onClick={goToTop}
        />
    );
}

function Github() {
    return (
        <button
            type="button"
            title="Github"
            className="i-ph:github-logo-duotone btn text-zinc-600 dark:text-zinc-500/80 hover:text-zinc-900 dark:hover:text-zinc-300"
            onClick={() => window.open(PROJECT_URL)}
        />
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
            title="Refresh"
            className={clsx(
                "btn text-zinc-600 dark:text-zinc-500/80 hover:text-zinc-900 dark:hover:text-zinc-300",
                isFetching
                    ? "animate-spin i-ph:circle-dashed-duotone text-zinc-300"
                    : "i-ph:arrow-counter-clockwise-duotone"
            )}
            onClick={refreshAll}
        />
    );
}

function ThemeToggle() {
    const { isDark, toggleDark } = useDark();
    return (
        <button
            type="button"
            title={isDark ? "切换到亮色主题" : "切换到暗色主题"}
            className={clsx(
                "btn",
                isDark
                    ? "i-ph:sun-dim-duotone text-zinc-500/80 hover:text-zinc-300"
                    : "i-ph:moon-stars-duotone text-zinc-700 hover:text-zinc-900"
            )}
            onClick={toggleDark}
        />
    );
}

export function Header() {
    const { enableLogin } = useLoginState();
    return (
        <>
            <span className="flex justify-self-start">
                <Link to="/" className="flex gap-2 items-center group">
                    <div
                        className="h-9 w-9 bg-cover bg-center"
                        title="logo"
                        style={{ backgroundImage: "url(/icon.svg)" }}
                    />
                    <span className="text-xl font-brand line-height-none! tracking-tight">
                        <p className="text-zinc-700 dark:text-neutral-200">Latest</p>
                        <p className="mt--1">
                            <span className="text-cyan-500 dark:text-cyan-400">N</span>
                            <span className="text-zinc-700 dark:text-neutral-200">ews</span>
                        </p>
                    </span>
                </Link>
                <a
                    target="_blank"
                    href={`${PROJECT_URL}/releases/tag/v${Version}`}
                    className="btn text-xs ml-2 font-mono text-zinc-700 dark:text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-400 self-end mb-0.5"
                >
                    {`v${Version}`}
                </a>
            </span>
            <span className="justify-self-center">
                <span className="hidden md:(inline-block)">
                    <NavBar />
                </span>
            </span>
            <span className="justify-self-end flex gap-3 items-center text-xl text-zinc-600 dark:text-zinc-500/80">
                <GoTop />
                {enableLogin.enable && <Refresh />}
                <ThemeToggle />
                <Github />
                <Menu />
            </span>
        </>
    );
}
