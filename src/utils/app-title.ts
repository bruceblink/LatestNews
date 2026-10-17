import { resolveAppTitle } from "@shared/app-title";

export const APP_TITLE = resolveAppTitle(import.meta.env.VITE_APP_TITLE);
