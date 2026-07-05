import type { SourceID } from "@shared/types";

import { createError } from "h3";
import dataSources from "@shared/data-sources";

import { hasSourceGetter } from "./source-fetch";

export function isValidFetchableSource(id?: SourceID) {
    return !!id && !!dataSources[id] && hasSourceGetter(id);
}

export function resolveSourceId(input: string): SourceID {
    const initialId = input as SourceID;
    if (isValidFetchableSource(initialId)) return initialId;

    const redirectID = dataSources[input as keyof typeof dataSources]?.redirect;
    if (redirectID && isValidFetchableSource(redirectID)) return redirectID;

    throw createError({
        statusCode: 400,
        message: "Invalid source id",
    });
}
