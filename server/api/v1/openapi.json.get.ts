import { setHeader, defineEventHandler } from "h3";
import { Version, APP_NAME } from "@shared/consts";
import { createOpenApiDocument } from "@shared/openapi";

export default defineEventHandler((event) => {
    setHeader(event, "content-type", "application/json;charset=utf-8");
    return createOpenApiDocument({
        title: APP_NAME,
        version: Version,
    });
});
