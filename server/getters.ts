import type { SourceID } from "@shared/types";

import * as x from "glob:./sources/{*.ts,**/index.ts}";

import type { SourceGetter } from "./types";

export const getters = (function initGetters() {
  const _getters = {} as Record<SourceID, SourceGetter>;
  typeSafeObjectEntries(x).forEach(([id, v]) => {
    if (v.default instanceof Function) {
      Object.assign(_getters, { [id]: v.default });
    } else {
      Object.assign(_getters, v.default);
    }
  });
  return _getters;
})();
