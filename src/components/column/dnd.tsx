import type { SourceID } from "@shared/types";
import type { PropsWithChildren } from "react";
import type { ElementDragType, BaseEventPayload } from "@atlaskit/pragmatic-drag-and-drop/dist/types/internal-types";

import clsx from "clsx";
import { isiOS } from "~/utils";
import { useThrottleFn } from "ahooks";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useCallback } from "react";
import { useSearchBar } from "~/hooks/useSearch";
import { useEntireQuery } from "~/hooks/query.ts";
import dataSources from "@shared/data-sources.ts";
import { goToTopAtom, currentSourcesAtom } from "~/atoms";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useSourceHealthSummary } from "~/hooks/useSourceHealth";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorderWithEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge";

import { CardWrapper } from "./card";
import { DndContext } from "../common/dnd";
import { useSortable } from "../common/dnd/useSortable";

import type { ItemsProps } from "./card";

const AnimationDuration = 200;
export function Dnd() {
    const [items, setItems] = useAtom(currentSourcesAtom);
    const [parent] = useAutoAnimate({ duration: AnimationDuration });
    const { sourceHealthMap } = useSourceHealthSummary();
    const { toggle } = useSearchBar();
    useEntireQuery(items);

    if (!items.length) {
        return (
            <div className="column-empty">
                <span className="i-ph:star-duotone" aria-hidden="true" />
                <h2>让关注，从一个来源开始</h2>
                <p>搜索你喜欢的媒体与社区，点击星标加入这里。</p>
                <button type="button" className="primary-button" onClick={() => toggle(true)}>
                    发现新闻来源
                </button>
            </div>
        );
    }

    return (
        <DndWrapper items={items} setItems={setItems}>
            <motion.ol
                className="news-grid"
                ref={parent}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: AnimationDuration / 1000 }}
            >
                {items
                    .filter((id): id is SourceID => id != null)
                    .map((id) => (
                        <li key={id}>
                            <SortableCardWrapper id={id} healthStatus={sourceHealthMap.get(id)?.status} />
                        </li>
                    ))}
            </motion.ol>
        </DndWrapper>
    );
}

function DndWrapper({
    items,
    setItems,
    children,
}: PropsWithChildren<{
    items: SourceID[];
    setItems: (items: SourceID[]) => void;
}>) {
    const onDropTargetChange = useCallback(
        ({ location, source }: BaseEventPayload<ElementDragType>) => {
            const target = location.current.dropTargets[0];
            if (!target?.data || !source?.data) return;
            const closestEdgeOfTarget = extractClosestEdge(target.data);
            const fromIndex = items.indexOf(source.data.id as SourceID);
            const toIndex = items.indexOf(target.data.id as SourceID);
            if (fromIndex === toIndex || fromIndex === -1 || toIndex === -1) return;
            const update = reorderWithEdge({
                list: items,
                startIndex: fromIndex,
                indexOfTarget: toIndex,
                closestEdgeOfTarget,
                axis: "vertical",
            });
            setItems(update);
        },
        [items, setItems]
    );
    // 避免动画干扰
    const { run } = useThrottleFn(onDropTargetChange, {
        leading: true,
        trailing: true,
        wait: AnimationDuration,
    });
    const { el } = useAtomValue(goToTopAtom);
    return (
        <DndContext onDropTargetChange={run} autoscroll={el ? { element: el } : undefined}>
            {children}
        </DndContext>
    );
}

function CardOverlay({ id }: { id: SourceID }) {
    return (
        <div
            className={clsx(
                "flex flex-col p-4 backdrop-blur-5",
                `bg-${dataSources[id].color}-500 dark:bg-${dataSources[id].color} bg-op-40!`,
                !isiOS() && "rounded-2xl"
            )}
        >
            <div className={clsx("flex justify-between mx-2 items-center")}>
                <div className="flex gap-2 items-center">
                    <div
                        className={clsx("w-8 h-8 rounded-full bg-cover")}
                        style={{
                            backgroundImage: `url(/icons/${id.split("-")[0]}.png)`,
                        }}
                    />
                    <span className="flex flex-col">
                        <span className="flex items-center gap-2">
                            <span className="text-xl font-bold">{dataSources[id].name}</span>
                            {dataSources[id]?.title && (
                                <span
                                    className={clsx(
                                        "text-sm",
                                        `color-${dataSources[id].color} bg-base op-80 bg-op-50! px-1 rounded`
                                    )}
                                >
                                    {dataSources[id].title}
                                </span>
                            )}
                        </span>
                        <span className="text-xs op-70">拖拽中</span>
                    </span>
                </div>
                <div className={clsx("flex gap-2 text-lg", `color-${dataSources[id].color}`)}>
                    <button
                        type="button"
                        title="拖拽排序"
                        aria-label="拖拽排序"
                        className={clsx("i-ph:dots-six-vertical-duotone", "cursor-grabbing")}
                    />
                </div>
            </div>
        </div>
    );
}

function SortableCardWrapper({ id, healthStatus }: ItemsProps) {
    const { isDragging, setNodeRef, setHandleRef, OverlayContainer } = useSortable({ id });

    useEffect(() => {
        if (OverlayContainer) {
            OverlayContainer!.className += clsx("bg-base", !isiOS() && "rounded-2xl");
        }
    }, [OverlayContainer]);

    return (
        <>
            <CardWrapper
                ref={setNodeRef}
                id={id}
                healthStatus={healthStatus}
                isDragging={isDragging}
                setHandleRef={setHandleRef}
            />
            {OverlayContainer && createPortal(<CardOverlay id={id} />, OverlayContainer)}
        </>
    );
}
