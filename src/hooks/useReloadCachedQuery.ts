import type { QueryKey, QueryFunction, UseQueryOptions } from "@tanstack/react-query";

import { useMemo, useState, useEffect } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { type NewsReloadKind, projectNewsReloadData } from "~/services/news-reload-schema";
import {
    digestReloadKey,
    readReloadSnapshot,
    isPartialReloadData,
    writeReloadSnapshot,
    getBrowserNewsCacheScope,
    getBrowserNewsCacheGeneration,
} from "~/services/news-reload-cache.service";

type Options<T> = Omit<UseQueryOptions<T, Error, T, QueryKey>, "queryFn" | "enabled"> & {
    kind: NewsReloadKind;
    queryFn: QueryFunction<T, QueryKey>;
    enabled?: boolean;
    persist?: boolean;
};

/** Restore before enabling the query. Keep its real savedAt, not the reload
 * time; expired data stays visible while React Query performs a normal fetch. */
export function useReloadCachedQuery<T>({ kind, queryFn, enabled = true, persist = true, ...options }: Options<T>) {
    const client = useQueryClient();
    const scope = persist ? getBrowserNewsCacheScope() : undefined;
    const generation = getBrowserNewsCacheGeneration();
    const fingerprint = hashKey(options.queryKey);
    const key = useMemo<QueryKey>(() => JSON.parse(fingerprint) as QueryKey, [fingerprint]);
    const identity = hashKey([scope, kind, key]);
    const [restored, setRestored] = useState<{ identity: string; digest?: string; savedAt?: number }>();
    const ready = !scope || restored?.identity === identity;
    const digest = ready ? restored?.digest : undefined;

    useEffect(() => {
        if (!enabled || !scope) return undefined;
        let active = true;
        void (async () => {
            const candidate = await digestReloadKey(scope, kind, key);
            if (!active || generation !== getBrowserNewsCacheGeneration()) return;
            const existing = client.getQueryState(key);
            let savedAt: number | undefined;
            if (candidate && existing?.data === undefined && (!existing || existing.fetchStatus === "idle")) {
                const snapshot = readReloadSnapshot<T>(candidate, (data) => projectNewsReloadData(kind, data));
                if (snapshot) {
                    client.setQueryData(key, snapshot.data, { updatedAt: snapshot.savedAt });
                    savedAt = snapshot.savedAt;
                }
            }
            setRestored({ identity, digest: candidate, savedAt });
        })();
        return () => {
            active = false;
        };
    }, [client, enabled, generation, identity, key, kind, scope]);

    const query = useQuery<T>({
        ...options,
        enabled: enabled && ready,
        staleTime: (currentQuery) => {
            if (scope && kind === "insights" && isPartialReloadData(currentQuery.state.data)) return 30_000;
            const configured = options.staleTime;
            return (typeof configured === "function" ? configured(currentQuery) : configured) ?? 0;
        },
        queryFn: async (context) => {
            const response = await queryFn(context);
            if (scope) {
                // Manual refetch can run before asynchronous restoration ends.
                const target = digest ?? (await digestReloadKey(scope, kind, key));
                if (target && generation === getBrowserNewsCacheGeneration())
                    writeReloadSnapshot(target, response, (data) => projectNewsReloadData(kind, data));
            }
            return response;
        },
    });
    const isReloadSnapshot = Boolean(
        scope && ready && restored?.savedAt !== undefined && query.dataUpdatedAt === restored.savedAt
    );
    return {
        ...query,
        isReloadSnapshot,
        isFetching: query.isFetching || Boolean(enabled && !ready && query.data === undefined),
        async remember(response: T) {
            if (!scope) return;
            const target = digest ?? (await digestReloadKey(scope, kind, key));
            if (target && generation === getBrowserNewsCacheGeneration())
                writeReloadSnapshot(target, response, (data) => projectNewsReloadData(kind, data));
        },
    };
}
