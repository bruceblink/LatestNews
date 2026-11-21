import { createError, defineEventHandler } from "h3";

// Keep unknown API requests out of the SPA fallback in both Nitro and Vite.
export default defineEventHandler(() => {
    throw createError({ statusCode: 404, message: "API endpoint not found" });
});
