import type { SourceID, SourceResponse } from "@shared/types"

export const cacheSources = new Map<SourceID, SourceResponse>()
export const refetchSources = new Set<SourceID>()
