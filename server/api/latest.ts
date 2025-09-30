import { defineEventHandler } from "h3";
import { Version } from "@shared/consts";

export default defineEventHandler(async () => {
    return {
        v: Version,
    };
});
