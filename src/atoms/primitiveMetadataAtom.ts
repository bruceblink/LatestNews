import type { PrimitiveAtom } from "jotai";
import type { SourceID, FixedColumnID, PrimitiveMetadata } from "@shared/types";

import { atom } from "jotai";
import { fixedColumnIds } from "@shared/types";
import { metadata } from "@shared/metadata.ts";
import dataSources from "@shared/data-sources.ts";
import { verifyPrimitiveMetadata } from "@shared/verify.ts";
import { objectEntries, objectFromEntries } from "@shared/type.util.ts";

import type { Update } from "./types";

// 生成初始的 metadata（只保留 fixedColumnIds）
const initialMetadata = objectFromEntries(fixedColumnIds.map((id) => [id, metadata[id].sources] as const)) as Record<
    FixedColumnID,
    SourceID[]
>;

// 预处理 metadata：校正非法 source，补全缺失项
export function preprocessMetadata(target: PrimitiveMetadata): PrimitiveMetadata {
    return {
        data: {
            ...initialMetadata,
            ...objectFromEntries(
                objectEntries(target.data)
                    .filter(([id]) => initialMetadata[id])
                    .map(([id, s]) => {
                        if (id === "focus") {
                            // focus 特殊处理：只保留有效 source，替换 redirect
                            return [id, s.filter((k) => dataSources[k]).map((k) => dataSources[k].redirect ?? k)];
                        }
                        // 旧数据：只保留 initialMetadata 中存在的，并替换 redirect
                        const oldS = s
                            .filter((k) => initialMetadata[id].includes(k))
                            .map((k) => dataSources[k].redirect ?? k);

                        // 新数据：initialMetadata 中有但旧数据没有的
                        const newS = initialMetadata[id].filter((k) => !oldS.includes(k));

                        return [id, [...oldS, ...newS]];
                    })
            ),
        },
        action: target.action,
        updatedTime: target.updatedTime,
    };
}

// ========== 创建 Atom 工厂函数 ==========

function createPrimitiveMetadataAtom(
    key: string,
    initialValue: PrimitiveMetadata,
    preprocess: (stored: PrimitiveMetadata) => PrimitiveMetadata
): PrimitiveAtom<PrimitiveMetadata> {
    const getInitialValue = (): PrimitiveMetadata => {
        const item = localStorage.getItem(key);
        try {
            if (item) {
                const stored = JSON.parse(item) as PrimitiveMetadata;
                verifyPrimitiveMetadata(stored);
                return preprocess({
                    ...stored,
                    action: "init",
                });
            }
        } catch {}
        return initialValue;
    };

    const baseAtom = atom(getInitialValue());

    return atom<
        PrimitiveMetadata,
        [Update<PrimitiveMetadata>], // 明确指定 Args 是元组
        void
    >(
        (get) => get(baseAtom),
        (get, set, ...args) => {
            const update = args[0]; // 正确取出 Update<PrimitiveMetadata>
            const current = get(baseAtom);

            const nextValue = update instanceof Function ? update(current) : update;

            if (nextValue.updatedTime >= current.updatedTime) {
                set(baseAtom, nextValue);
                localStorage.setItem(key, JSON.stringify(nextValue));
            }
        }
    );
}

export function createDefaultPrimitiveMetadata(action: PrimitiveMetadata["action"] = "init"): PrimitiveMetadata {
    return {
        updatedTime: action === "init" ? 0 : Date.now(),
        data: initialMetadata,
        action,
    };
}

// ========== 导出全局唯一 atom ==========

export const primitiveMetadataAtom = createPrimitiveMetadataAtom(
    "metadata",
    createDefaultPrimitiveMetadata(),
    preprocessMetadata
);
