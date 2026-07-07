import type { ReadingStateEntry } from "~/hooks/useReadingState";

import clsx from "clsx";
import { useReadingState } from "~/hooks/useReadingState";

export function ReadingStateActions({ entry, className }: { entry: ReadingStateEntry; className?: string }) {
    const { toggleLater, toggleFavorite, toggleHidden, isLaterUrl, isFavoriteUrl } = useReadingState();
    const isLater = isLaterUrl(entry.url);
    const isFavorite = isFavoriteUrl(entry.url);

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <StateButton
                active={isLater}
                label={isLater ? "移出稍后读" : "稍后读"}
                icon={isLater ? "i-ph:clock-fill" : "i-ph:clock-duotone"}
                onClick={() => toggleLater(entry)}
            />
            <StateButton
                active={isFavorite}
                label={isFavorite ? "取消收藏" : "收藏"}
                icon={isFavorite ? "i-ph:bookmark-simple-fill" : "i-ph:bookmark-simple-duotone"}
                onClick={() => toggleFavorite(entry)}
            />
            <StateButton label="隐藏" icon="i-ph:eye-slash-duotone" tone="muted" onClick={() => toggleHidden(entry)} />
        </div>
    );
}

function StateButton({
    active,
    label,
    icon,
    tone = "accent",
    onClick,
}: {
    active?: boolean;
    label: string;
    icon: string;
    tone?: "accent" | "muted";
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-lg text-base transition-all",
                active
                    ? "bg-cyan-500/18 text-cyan-700 dark:text-cyan-300"
                    : tone === "muted"
                      ? "text-zinc-500 hover:bg-zinc-200/75 hover:text-zinc-700 dark:hover:bg-zinc-700/45 dark:hover:text-zinc-300"
                      : "text-zinc-500 hover:bg-cyan-500/12 hover:text-cyan-700 dark:hover:text-cyan-300"
            )}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            }}
        >
            <span className={icon} />
        </button>
    );
}
