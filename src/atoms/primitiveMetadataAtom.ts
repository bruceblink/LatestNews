import type { SourceID, FixedColumnID, PrimitiveMetadata } from "@shared/types";

import { atom } from "jotai";
import { userAtom } from "~/auth/authAtoms";
import { fixedColumnIds } from "@shared/types";
import { metadata } from "@shared/metadata.ts";
import dataSources from "@shared/data-sources.ts";
import { verifyPrimitiveMetadata } from "@shared/verify.ts";
import { objectEntries, objectFromEntries } from "@shared/type.util.ts";
import { shouldUseOfflineReadingSnapshot } from "@shared/offline-reading-state";

import { isBrowserOffline, readOfflineReadingSnapshot } from "../services/offline-reading-state.service";

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
                    .filter(([id]) => Object.hasOwn(initialMetadata, id))
                    .map(([id, s]) => {
                        if (id === "focus") {
                            // focus 特殊处理：只保留有效 source，替换 redirect
                            return [
                                id,
                                s.filter((k) => Object.hasOwn(dataSources, k)).map((k) => dataSources[k].redirect ?? k),
                            ];
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

export function createDefaultPrimitiveMetadata(action: PrimitiveMetadata["action"] = "init"): PrimitiveMetadata {
    return {
        updatedTime: action === "init" ? 0 : Date.now(),
        data: initialMetadata,
        action,
    };
}

const storageKey = "metadata";
type StoredMetadata = PrimitiveMetadata & { pendingAccountId?: number };

function readInitialMetadata(): { layout: PrimitiveMetadata; pendingAccountId?: number } {
    try {
        const item = localStorage.getItem(storageKey);
        if (item) {
            const { pendingAccountId, ...stored } = JSON.parse(item) as StoredMetadata;
            verifyPrimitiveMetadata(stored);
            const action = stored.action === "manual" ? "manual" : "init";
            return {
                layout: preprocessMetadata({ ...stored, action }),
                pendingAccountId:
                    action === "manual" && Number.isSafeInteger(pendingAccountId) ? pendingAccountId : undefined,
            };
        }
    } catch {}

    const initialValue = createDefaultPrimitiveMetadata();
    const snapshot = readOfflineReadingSnapshot();
    if (
        !shouldUseOfflineReadingSnapshot({
            isOffline: isBrowserOffline(),
            hasPersistedLiveValue: false,
            snapshotState: snapshot.state,
        })
    ) {
        return { layout: initialValue };
    }

    return {
        layout: preprocessMetadata({
            ...initialValue,
            data: { ...initialValue.data, focus: snapshot.snapshot?.focusSources ?? [] },
        }),
    };
}

const storedMetadataAtom = atom(readInitialMetadata());
export const pendingLayoutAccountIdAtom = atom((get) => get(storedMetadataAtom).pendingAccountId);

export const primitiveMetadataAtom = atom(
    (get) => get(storedMetadataAtom).layout,
    (get, set, update: Update<PrimitiveMetadata>) => {
        const { layout: current, pendingAccountId } = get(storedMetadataAtom);
        const next = typeof update === "function" ? update(current) : update;
        if (next === current) return;
        if (next.action !== "manual" && next.updatedTime < current.updatedTime) return;

        // Keep the draft's owner so a different account cannot upload it on login.
        const owner = next.action === "manual" ? (pendingAccountId ?? get(userAtom)?.id) : undefined;
        const layout =
            next.action === "manual"
                ? { ...next, updatedTime: Math.max(next.updatedTime, current.updatedTime + 1) }
                : next;
        localStorage.setItem(storageKey, JSON.stringify({ ...layout, pendingAccountId: owner }));
        set(storedMetadataAtom, { layout, pendingAccountId: owner });
    }
);
