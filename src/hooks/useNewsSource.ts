import type { SourceQuery } from "@shared/source-api";
import type { SourceID, SourceResponse } from "@shared/types";

import { useAtomValue } from "jotai";
import dataSources from "@root/shared/data-sources";
import { fetchSource } from "~/services/source.service";
import { getSourceQuerySchedule } from "@shared/source-query-schedule";
import { getSourceCacheKey, createBearerHeaders } from "@shared/source-api";
import { runtimeCatalogRevisionAtom } from "~/services/runtime-source-catalog.service";

import { useSourceHealthSummary } from "./useSourceHealth";
import { cacheSources, refetchSources } from "../utils/data";
import { useReloadCachedQuery } from "./useReloadCachedQuery";

/**
 * 自定义 Hook: 管理单个新闻源的数据获取与缓存
 */
export function useNewsSource(id: SourceID) {
    useAtomValue(runtimeCatalogRevisionAtom);
    const { sourceHealthMap } = useSourceHealthSummary();
    const sourceHealth = sourceHealthMap.get(id);
    const schedule = getSourceQuerySchedule(id, sourceHealth?.status === "failing");

    return useReloadCachedQuery<SourceResponse>({
        kind: "source",
        enabled: !dataSources[id].disable,
        queryKey: getSourceCacheKey(id),
        queryFn: async ({ client, queryKey }) => {
            const query: SourceQuery = { id };
            let headers: Record<string, string> | undefined;

            // 强制刷新逻辑
            if (refetchSources.has(id)) {
                query.latest = true;
                headers = createBearerHeaders(localStorage.getItem("access_token"));
                refetchSources.delete(id);
            }

            const response = await fetchSource(query, headers);
            const previous = client.getQueryData<SourceResponse>(queryKey) ?? cacheSources.get(id);
            if (response.status === "empty" && previous?.items.length) {
                return { ...previous, status: "stale-cache" };
            }

            if (previous && response.updatedTime > previous.updatedTime && dataSources[id].type === "hottest") {
                const oldRanks = new Map(previous.items.map((item, index) => [item.id, index]));
                response.items = response.items.map((item, index) => {
                    const oldRank = oldRanks.get(item.id);
                    return {
                        ...item,
                        extra: { ...item.extra, diff: oldRank === undefined ? undefined : oldRank - index },
                    };
                });
            }

            if (response.items.length) cacheSources.set(id, response);
            return response;
        },
        initialData: () => cacheSources.get(id),
        initialDataUpdatedAt: () => {
            const updatedTime = cacheSources.get(id)?.updatedTime;
            return typeof updatedTime === "string" ? Date.parse(updatedTime) || 0 : updatedTime;
        },
        staleTime: schedule.staleTime,
        refetchInterval: schedule.refetchInterval,
        refetchOnMount: true,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
