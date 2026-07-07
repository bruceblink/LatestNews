import type { ReadingState } from "@shared/reading-state";

import { atomWithStorage } from "jotai/utils";
import { createDefaultReadingState } from "@shared/reading-state";

export const readingStateAtom = atomWithStorage<ReadingState>("reading-state", createDefaultReadingState(), undefined, {
    getOnInit: true,
});
