import type { SourceQuery } from "@shared/source-api";
import type { SourceID, SourceResponse } from "@shared/types";

import { delay } from "@root/shared/utils";
import { useQuery } from "@tanstack/react-query";
import dataSources from "@root/shared/data-sources";
import { fetchSource } from "~/services/source.service";
import { getSourceQuerySchedule } from "@shared/source-query-schedule";
import { getSourceCacheKey, createBearerHeaders } from "@shared/source-api";

import { useSourceHealthSummary } from "./useSourceHealth";
import { cacheSources, refetchSources } from "../utils/data";

/**
 * 自定义 Hook: 管理单个新闻源的数据获取与缓存
 */
export function useNewsSource(id: SourceID) {
    const { sourceHealthMap } = useSourceHealthSummary();
    const sourceHealth = sourceHealthMap.get(id);
    const schedule = getSourceQuerySchedule(id, sourceHealth?.status === "failing");

    return useQuery<SourceResponse>({
        queryKey: getSourceCacheKey(id),
        queryFn: async () => {
            const query: SourceQuery = { id };
            let headers: Record<string, string> | undefined;

            // 强制刷新逻辑
            if (refetchSources.has(id)) {
                query.latest = true;
                headers = createBearerHeaders(localStorage.getItem("access_token"));
                refetchSources.delete(id);
            } else if (cacheSources.has(id)) {
                // 使用缓存并延时，配合 UI 动画
                await delay(200);
                return cacheSources.get(id)!;
            }

            const response = await fetchSource(query, headers);

            // diff 逻辑（仅 hottest 类型）
            try {
                if (response.items && dataSources[id].type === "hottest" && cacheSources.has(id)) {
                    const old = cacheSources.get(id)!;
                    response.items.forEach((item, i) => {
                        const oldIdx = old.items.findIndex((k) => k.id === item.id);
                        item.extra = { ...item.extra, diff: oldIdx === -1 ? undefined : oldIdx - i };
                    });
                }
            } catch (e) {
                console.error(e);
            }

            cacheSources.set(id, response);
            return response;
        },
        placeholderData: (prev) => prev,
        staleTime: schedule.staleTime,
        refetchInterval: schedule.refetchInterval,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
