import type { UserDTO } from "#/types.ts";

import { SignJWT } from "jose";
import process from "node:process";
import getUserTable from "#/database/user";
import { sendRedirect, defineEventHandler } from "h3";
import { Version, APP_NAME, PROJECT_URL } from "@shared/consts.ts";

export default defineEventHandler(async (event) => {
    const userTable = getUserTable();
    if (!userTable) throw new Error("db is not defined");
    const response: {
        access_token: string;
        token_type: string;
        scope: string;
    } = await $fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        body: new URLSearchParams({
            client_id: process.env.G_CLIENT_ID!,
            client_secret: process.env.G_CLIENT_SECRET!,
            code: getQuery(event).code as string,
        }).toString(),
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });

    const userInfo: {
        login: string;
        id: number;
        name: string;
        avatar_url: string;
        email: string;
        notification_email: string;
    } = await myFetch("https://api.github.com/user", {
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `token ${response.access_token}`,
            // 必须有 user-agent，在 cloudflare worker 会报错
            "User-Agent": `${APP_NAME}/${Version} (+${PROJECT_URL})`,
        },
    });

    const userDTO: UserDTO = {
        provide_id: String(userInfo.id),
        email: userInfo.email || userInfo.notification_email,
        username: userInfo.login,
        display_name: userInfo.name,
        avatar_url: userInfo.avatar_url,
        type: "github",
        data: userInfo,
    };
    // 将用户数据插入数据库
    await userTable.addUser(userDTO);

    const jwtToken = await new SignJWT({
        id: userInfo.id,
        type: "github",
    })
        .setExpirationTime("60d")
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode(process.env.JWT_SECRET!));

    // nitro 有 bug，在 cloudflare 里没法 set cookie
    // seconds
    // const maxAge = 60 * 24 * 60 * 60
    // setCookie(event, "user_jwt", jwtToken, { maxAge })
    // setCookie(event, "user_avatar", userInfo.avatar_url, { maxAge })
    // setCookie(event, "user_name", userInfo.name, { maxAge })

    const params = new URLSearchParams({
        login: "github",
        jwt: jwtToken,
        user: JSON.stringify({
            avatar: userInfo.avatar_url,
            name: userInfo.name,
        }),
    });
    return sendRedirect(event, `/?${params.toString()}`);
});
