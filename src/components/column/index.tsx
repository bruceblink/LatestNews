import type { FixedColumnID } from "@shared/types";

import { useEffect } from "react";
import { useTitle } from "react-use";
import { useAtom, useAtomValue } from "jotai";
import { APP_TITLE } from "~/utils/app-title";
import { currentColumnIDAtom } from "~/atoms";
import { metadata } from "@shared/metadata.ts";
import { useSearchBar } from "~/hooks/useSearch";
import { primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";

import { Dnd } from "./dnd";

const columnDescriptions = {
    focus: { title: "我的关注", description: "你关心的来源，按自己的节奏阅读。", icon: "i-ph:star-duotone" },
    hottest: { title: "热门榜单", description: "发现正在被讨论的事，看见不同的视角。", icon: "i-ph:fire-duotone" },
    realtime: {
        title: "实时快讯",
        description: "跟进最新动态，不错过每一个重要时刻。",
        icon: "i-ph:lightning-duotone",
    },
};

export function Column({ id, isHome = false }: { id: FixedColumnID; isHome?: boolean }) {
    const [currentColumnID, setCurrentColumnID] = useAtom(currentColumnIDAtom);
    const { data } = useAtomValue(primitiveMetadataAtom);
    const { toggle } = useSearchBar();
    useEffect(() => {
        setCurrentColumnID(id);
    }, [id, setCurrentColumnID]);
    useTitle(`${APP_TITLE} | ${metadata[id].name}`);
    const description = columnDescriptions[id];
    const Heading = isHome ? "h2" : "h1";

    return (
        <section className="column-section" aria-labelledby={`column-${id}-title`}>
            <div className="column-heading">
                <div>
                    <div className="column-title-line">
                        <span className={description.icon} aria-hidden="true" />
                        <Heading id={`column-${id}-title`}>{description.title}</Heading>
                        <span className="source-count">{data[id].length} 个来源</span>
                    </div>
                    <p>{description.description}</p>
                </div>
                <button type="button" className="text-action" onClick={() => toggle(true)}>
                    <span className="i-ph:plus-duotone" aria-hidden="true" /> 发现来源
                </button>
            </div>
            {id === currentColumnID && <Dnd />}
        </section>
    );
}
