import type { SourceID } from "@shared/types";
import type { PropsWithChildren } from "react";
import type { ElementDragType, BaseEventPayload } from "@atlaskit/pragmatic-drag-and-drop/dist/types/internal-types";

import clsx from "clsx";
import { isiOS } from "~/utils";
import { useThrottleFn } from "ahooks";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useWindowSize } from "react-use";
import { useAtom, useAtomValue } from "jotai";
import { isMobile } from "react-device-detect";
import { useEntireQuery } from "~/hooks/query.ts";
import dataSources from "@shared/data-sources.ts";
import { useMemo, useEffect, useCallback } from "react";
import { goToTopAtom, currentSourcesAtom } from "~/atoms";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorderWithEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge";

import { CardWrapper } from "./card";
import { DndContext } from "../common/dnd";
import { useSortable } from "../common/dnd/useSortable";
import { OverlayScrollbar } from "../common/overlay-scrollbar";

import type { ItemsProps } from "./card";

const AnimationDuration = 200;
const WIDTH = 350;
export function Dnd() {
    const [items, setItems] = useAtom(currentSourcesAtom);
    const [parent] = useAutoAnimate({ duration: AnimationDuration });
    // 查询全部新闻 调用 '/api/s/entire' 接口
    useEntireQuery(items);
    const { width } = useWindowSize();
    const minWidth = useMemo(() => {
        // double padding = 32
        return Math.min(width - 32, WIDTH);
    }, [width]);

    if (!items.length) return null;

    return (
        <DndWrapper items={items} setItems={setItems} isSingleColumn={isMobile}>
            <OverlayScrollbar defer className="overflow-x-auto">
                <motion.ol
                    className={isMobile ? "flex px-2 gap-6 pb-4 scroll-smooth" : "grid w-full gap-6"}
                    ref={parent}
                    style={
                        isMobile
                            ? {
                                  // 横向滚动布局
                              }
                            : {
                                  gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
                              }
                    }
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: {
                            opacity: 0,
                        },
                        visible: {
                            opacity: 1,
                            transition: {
                                delayChildren: 0.1,
                                staggerChildren: 0.1,
                            },
                        },
                    }}
                >
                    {items
                        .filter((id): id is SourceID => id != null)
                        .map((id, index) => (
                            <motion.li
                                key={id}
                                className={clsx(
                                    isMobile && "flex-shrink-0",
                                    isMobile && index === items.length - 1 && "mr-2"
                                )}
                                style={isMobile ? { width: `${width - 16 > WIDTH ? WIDTH : width - 16}px` } : undefined}
                                transition={{
                                    type: "tween",
                                    duration: AnimationDuration / 1000,
                                }}
                                variants={{
                                    hidden: {
                                        y: 20,
                                        opacity: 0,
                                    },
                                    visible: {
                                        y: 0,
                                        opacity: 1,
                                    },
                                }}
                            >
                                <SortableCardWrapper id={id} />
                            </motion.li>
                        ))}
                </motion.ol>
            </OverlayScrollbar>
            {isMobile && (
                <div className="flex justify-center">
                    <span className="text-sm text-gray-500 text-center">左右滑动查看更多</span>
                </div>
            )}
        </DndWrapper>
    );
}

function DndWrapper({
    items,
    setItems,
    isSingleColumn,
    children,
}: PropsWithChildren<{
    items: SourceID[];
    setItems: (items: SourceID[]) => void;
    isSingleColumn: boolean;
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
                axis: isSingleColumn ? "horizontal" : "vertical",
            });
            setItems(update);
        },
        [items, setItems, isSingleColumn]
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
                    <button type="button" className={clsx("i-ph:dots-six-vertical-duotone", "cursor-grabbing")} />
                </div>
            </div>
        </div>
    );
}

function SortableCardWrapper({ id }: ItemsProps) {
    const { isDragging, setNodeRef, setHandleRef, OverlayContainer } = useSortable({ id });

    useEffect(() => {
        if (OverlayContainer) {
            OverlayContainer!.className += clsx("bg-base", !isiOS() && "rounded-2xl");
        }
    }, [OverlayContainer]);

    return (
        <>
            <CardWrapper ref={setNodeRef} id={id} isDragging={isDragging} setHandleRef={setHandleRef} />
            {OverlayContainer && createPortal(<CardOverlay id={id} />, OverlayContainer)}
        </>
    );
}
