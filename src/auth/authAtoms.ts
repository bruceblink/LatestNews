import { atom } from "jotai";
import { apiFetch } from "~/utils";

/**
 * 登录态状态机
 */
export type AuthStatus =
    | "idle" // 尚未初始化
    | "loading" // 正在请求 /api/me
    | "authenticated" // 已登录
    | "unauthenticated"; // 未登录

/**
 * 用户信息结构（按你的后端来）
 */
export interface UserInfo {
    id: number;
    username: string;
    email?: string;
    roles: string[];
}

/**
 * 全局登录态
 */
export const authStatusAtom = atom<AuthStatus>("idle");

/**
 * 当前用户信息
 */
export const userAtom = atom<UserInfo | null>(null);

/**
 * 初始化登录态（只应该调用一次）
 */
export const initAuthAtom = atom(null, async (get, set) => {
    const status = get(authStatusAtom);

    // 🔒 防止重复初始化
    if (status !== "idle") return;

    set(authStatusAtom, "loading");

    try {
        const res = await apiFetch("/api/me", {
            credentials: "include", // 🔥 HTTP-only cookie 必须
        });
        if (!(res.status === "ok")) {
            set(userAtom, null);
            set(authStatusAtom, "unauthenticated");
            return;
        }
        const user: UserInfo = res.data;
        set(userAtom, user);
        set(authStatusAtom, "authenticated");
    } catch {
        set(userAtom, null);
        set(authStatusAtom, "unauthenticated");
    }
});
