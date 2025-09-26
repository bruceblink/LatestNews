import process from "node:process";
import { defineEventHandler } from "h3";

export default defineEventHandler(async () => {
    return {
        enable: true,
        url: `https://github.com/login/oauth/authorize?client_id=${process.env.G_CLIENT_ID}`,
    };
});
