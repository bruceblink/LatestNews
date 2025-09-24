import getUserTable from "#/database/user";

export default defineEventHandler(async (event) => {
    try {
        const { id, type } = event.context.user;
        const userTable = getUserTable();

        if (event.method === "GET") {
            const { data, updated } = await userTable.getData(type, id);
            return {
                data,
                updatedTime: updated,
            };
        } else if (event.method === "POST") {
            const body = await readBody(event);
            verifyPrimitiveMetadata(body);
            const { updatedTime, data } = body;
            await userTable.setData(type, id, JSON.stringify(data));
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
