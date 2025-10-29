import type { SourceID, SourceResponse } from "@shared/types";

import { myFetch } from "~/utils";
import { delay } from "@root/shared/utils";
import { useQuery } from "@tanstack/react-query";
import dataSources from "@root/shared/data-sources";

import { cacheSources, refetchSources } from "../utils/data";

/**
 * 自定义 Hook: 管理单个新闻源的数据获取与缓存
 */
export function useNewsSource(id: SourceID) {
    return useQuery<SourceResponse>({
        queryKey: ["source", id],
        queryFn: async () => {
            let url = `/s?id=${id}`;
            const headers: Record<string, string> = {};

            // 强制刷新逻辑
            if (refetchSources.has(id)) {
                url = `/s?id=${id}&latest`;
                const jwt = localStorage.getItem("access_token");
                if (jwt) headers.Authorization = `Bearer ${jwt}`;
                refetchSources.delete(id);
            } else if (cacheSources.has(id)) {
                // 使用缓存并延时，配合 UI 动画
                await delay(200);
                return cacheSources.get(id)!;
            }

            const response: SourceResponse = await myFetch(url, { headers });

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
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
