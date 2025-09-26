import clsx from "clsx";
import { useAtomValue } from "jotai";
import { Link } from "@tanstack/react-router";
import { currentColumnIDAtom } from "~/atoms";
import { useSearchBar } from "~/hooks/useSearch.ts";
import { metadata, fixedColumnIds } from "@shared/metadata";

export function NavBar() {
    const currentId = useAtomValue(currentColumnIDAtom);
    const { toggle } = useSearchBar();
    return (
        <span
            className={clsx([
                "flex p-3 rounded-2xl bg-primary/1 text-sm",
                "shadow shadow-primary/20 hover:shadow-primary/50 transition-shadow-500",
            ])}
        >
            {fixedColumnIds.map((columnId) => (
                <Link
                    key={columnId}
                    to="/c/$column"
                    params={{ column: columnId }}
                    className={clsx(
                        "px-2 hover:(bg-primary/10 rounded-md) cursor-pointer transition-all",
                        currentId === columnId ? "color-primary font-bold" : "op-70 dark:op-90"
                    )}
                >
                    {metadata[columnId].name}
                </Link>
            ))}
            <button
                type="button"
                onClick={() => toggle(true)}
                className={clsx(
                    "px-2 hover:(bg-primary/10 rounded-md) op-70 dark:op-90",
                    "cursor-pointer transition-all"
                )}
            >
                更多
            </button>
        </span>
    );
}
