import { defineEventHandler } from "h3";

export default defineEventHandler(async () => {
    // 如果 VITE_API_URL或者JWT_SECRET两个环境变量没有配置，直接无法登录
    const enable = Boolean(process.env.VITE_API_URL && process.env.JWT_SECRET);
    return { enable };
});
