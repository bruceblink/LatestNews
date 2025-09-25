import type { SourceID } from "@shared/types";

import * as x from "glob:./sources/{*.ts,**/index.ts}";

import type { SourceGetter } from "./types";

export const getters = (function initGetters() {
    const _getters = {} as Record<SourceID, SourceGetter>;
    typeSafeObjectEntries(x).forEach(([id, v]) => {
        Object.assign(_getters, { [id]: v.default });
    });
    return _getters;
})();
