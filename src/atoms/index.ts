import type { Getter, Setter } from "jotai";
import type { SourceID, FixedColumnID, PrimitiveMetadata } from "@shared/types";

import { atom } from "jotai";
import dataSources from "@shared/data-sources";
import { getUnifiedFeedScopeSources } from "@shared/unified-feed";
import { runtimeCatalogRevisionAtom } from "~/services/runtime-source-catalog.service";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom.ts";

import type { Update } from "./types";

/** 将 Update<T> 解析为最终值 */
function resolveUpdate<T>(prev: T, update: Update<T>): T {
    return typeof update === "function" ? (update as (p: T) => T)(prev) : update;
}

/**
 * 把修改 primitiveMetadataAtom.data[key] 的通用逻辑抽出来
 * - get / set 使用 jotai 的 Getter / Setter
 * - key 必须是 FixedColumnID（你的 fixed 列集合）
 * - update 支持值或 updater 函数
 */
function updatePrimitiveData<T>(get: Getter, set: Setter, key: FixedColumnID, update: Update<T>) {
    const prevMeta = get(primitiveMetadataAtom) as PrimitiveMetadata;
    const prevValue = (prevMeta.data[key] ?? (undefined as unknown)) as T;
    const nextValue = resolveUpdate(prevValue, update);

    set(primitiveMetadataAtom, {
        ...prevMeta,
        updatedTime: Date.now(),
        action: "manual",
        data: {
            ...prevMeta.data,
            [key]: nextValue,
        },
    });
}

/**
 * 工厂：根据 primitiveMetadataAtom.data 的某个固定 key 创建一个可读写 atom
 * - key: FixedColumnID
 * - defaultValue: 当 primitiveMetadataAtom.data[key] 未定义时的回退值
 */
export function createDataAtom<T>(key: FixedColumnID, defaultValue: T) {
    return atom<T, [Update<T>], void>(
        (get) => {
            const meta = get(primitiveMetadataAtom) as PrimitiveMetadata;
            return (meta.data[key] ?? defaultValue) as T;
        },
        (get, set, update) => {
            updatePrimitiveData(get, set, key, update);
        }
    );
}

/* ========== 使用示例 / 导出 ========== */

/**
 * focusSourcesAtom —— 专用的 focus 列数据 atom（等同原实现）
 * 使用工厂创建，默认空数组
 */
export const focusSourcesAtom = createDataAtom<SourceID[]>("focus", [] as SourceID[]);

export const feedScopeSourcesAtom = atom((get) => {
    get(runtimeCatalogRevisionAtom);
    const focus = get(focusSourcesAtom);
    return {
        focus: getUnifiedFeedScopeSources("focus", focus),
        hottest: getUnifiedFeedScopeSources("hottest", focus),
        realtime: getUnifiedFeedScopeSources("realtime", focus),
        broad: getUnifiedFeedScopeSources("broad", focus),
    };
});

/**
 * currentColumnIDAtom —— 当前固定列（FixedColumnID）的选择
 */
export const currentColumnIDAtom = atom<FixedColumnID>("focus");

export const visibleColumnsAtom = atom((get) => {
    get(runtimeCatalogRevisionAtom);
    const { data } = preprocessMetadata(get(primitiveMetadataAtom));
    return {
        focus: data.focus.filter((id) => Object.hasOwn(dataSources, id)),
        hottest: data.hottest.filter((id) => Object.hasOwn(dataSources, id)),
        realtime: data.realtime.filter((id) => Object.hasOwn(dataSources, id)),
    };
});

/**
 * currentSourcesAtom —— 根据 currentColumnIDAtom 动态读取 / 写入对应的 primitiveMetadataAtom.data[key]
 * （写入统一委托给 updatePrimitiveData）
 */
export const currentSourcesAtom = atom<SourceID[], [Update<SourceID[]>], void>(
    (get) => get(visibleColumnsAtom)[get(currentColumnIDAtom)],
    (get, set, update) => {
        const key = get(currentColumnIDAtom);
        const visible = get(visibleColumnsAtom)[key];
        const next = resolveUpdate(visible, update);
        updatePrimitiveData<SourceID[]>(get, set, key, (stored) => [
            ...next,
            ...stored.filter((id) => !Object.hasOwn(dataSources, id)),
        ]);
    }
);

/**
 * goToTopAtom —— UI 状态：是否需要执行滚动到顶部，和相关元素 / 回调
 */
export type GoToTopState = {
    ok: boolean;
    el?: HTMLElement;
    fn?: () => void;
};

export const goToTopAtom = atom<GoToTopState>({
    ok: false,
    el: undefined,
    fn: undefined,
});
