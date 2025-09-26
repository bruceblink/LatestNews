import process from "node:process";
import { UserTable } from "#/database/user";
import { readBody, defineEventHandler } from "h3";
import { verifyPrimitiveMetadata } from "@shared/verify.ts";

export default defineEventHandler(async (event) => {
    try {
        const { id } = event.context.user;
        const db = useDatabase();
        if (!db) throw new Error("Not found database");
        const userTable = new UserTable(db);
        if (process.env.INIT_TABLE !== "false") await userTable.init();
        if (event.method === "GET") {
            const { data, updated } = await userTable.getData(id);
            return {
                data: data ? JSON.parse(data) : undefined,
                updatedTime: updated,
            };
        } else if (event.method === "POST") {
            const body = await readBody(event);
            verifyPrimitiveMetadata(body);
            const { updatedTime, data } = body;
            await userTable.setData(id, JSON.stringify(data), updatedTime);
            return {
                success: true,
                updatedTime,
            };
        }
    } catch (e) {
        logger.error(e);
        throw createError({
            statusCode: 500,
            message: e instanceof Error ? e.message : "Internal Server Error",
        });
    }
    return undefined;
});
