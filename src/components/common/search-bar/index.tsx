import "./cmdk.css";

import type { CSSProperties } from "react";
import type { SourceID } from "@shared/types";

import clsx from "clsx";
import { Command } from "cmdk";
import { useMount } from "react-use";
import pinyin from "@shared/pinyin.json";
import { metadata } from "@shared/metadata";
import { useFocusWith } from "~/hooks/useFocus";
import * as Dialog from "@radix-ui/react-dialog";
import { useSearchBar } from "~/hooks/useSearch";
import { useRef, useMemo, useState } from "react";
import dataSources from "@shared/data-sources.ts";
import { objectEntries } from "@shared/type.util";
import { CardWrapper } from "~/components/column/card";

import { OverlayScrollbar } from "../overlay-scrollbar";

interface SourceItemProps {
    id: SourceID;
    name: string;
    title?: string;
    column: any;
    pinyin: string;
}

const visuallyHiddenStyle: CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
};

function groupByColumn(items: SourceItemProps[]) {
    return items
        .reduce(
            (acc, item) => {
                const k = acc.find((i) => i.column === item.column);
                if (k) k.sources = [...k.sources, item];
                else acc.push({ column: item.column, sources: [item] });
                return acc;
            },
            [] as {
                column: string;
                sources: SourceItemProps[];
            }[]
        )
        .sort((m, n) => {
            if (m.column === "科技") return -1;
            if (n.column === "科技") return 1;

            if (m.column === "未分类") return 1;
            if (n.column === "未分类") return -1;

            return m.column < n.column ? -1 : 1;
        });
}

export function SearchBar() {
    const { opened, toggle } = useSearchBar();
    const sourceItems = useMemo(
        () =>
            groupByColumn(
                objectEntries(dataSources)
                    .filter(([_, source]) => !source.redirect)
                    .map(([k, source]) => ({
                        id: k,
                        title: source.title,
                        column: source.column ? metadata[source.column].name : "未分类",
                        name: source.name,
                        pinyin: pinyin?.[k as keyof typeof pinyin] ?? "",
                    }))
            ),
        []
    );
    const inputRef = useRef<HTMLInputElement | null>(null);

    const [value, setValue] = useState<SourceID>("github-trending-today");

    useMount(() => {
        inputRef?.current?.focus();
        const keydown = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                toggle();
            }
        };
        document.addEventListener("keydown", keydown);
        return () => {
            document.removeEventListener("keydown", keydown);
        };
    });

    return (
        <Command.Dialog
            open={opened}
            onOpenChange={toggle}
            value={value}
            onValueChange={(v) => {
                if (v in dataSources) {
                    setValue(v as SourceID);
                }
            }}
        >
            <Dialog.Title style={visuallyHiddenStyle}>搜索新闻源</Dialog.Title>
            <Dialog.Description style={visuallyHiddenStyle}>输入关键词搜索并选择新闻源加入关注。</Dialog.Description>
            <Command.Input ref={inputRef} autoFocus placeholder="搜索你想要的" />
            <div className="md:flex pt-2">
                <OverlayScrollbar defer className="overflow-y-auto md:min-w-275px">
                    <Command.List>
                        <Command.Empty> 没有找到，可以前往 Github 提 issue </Command.Empty>
                        {sourceItems.map(({ column, sources }) => (
                            <Command.Group heading={column} key={column}>
                                {sources.map((item) => (
                                    <SourceItem item={item} key={item.id} />
                                ))}
                            </Command.Group>
                        ))}
                    </Command.List>
                </OverlayScrollbar>
                <div className="flex-1 pt-2 px-4 min-w-350px max-md:hidden">
                    <CardWrapper id={value} />
                </div>
            </div>
        </Command.Dialog>
    );
}

function SourceItem({ item }: { item: SourceItemProps }) {
    const { isFocused, toggleFocus } = useFocusWith(item.id);
    return (
        <Command.Item
            keywords={[item.name, item.title ?? "", item.pinyin]}
            value={item.id}
            className="flex justify-between items-center p-2"
            onSelect={toggleFocus}
        >
            <span className="flex gap-2 items-center">
                <span
                    className={clsx("w-4 h-4 rounded-md bg-cover")}
                    style={{
                        backgroundImage: `url(/icons/${item.id.split("-")[0]}.png)`,
                    }}
                />
                <span>{item.name}</span>
                <span className="text-xs text-neutral-400/80 self-end mb-3px">{item.title}</span>
            </span>
            <span className={clsx(isFocused ? "i-ph-star-fill" : "i-ph-star-duotone", "bg-primary op-40")} />
        </Command.Item>
    );
}
