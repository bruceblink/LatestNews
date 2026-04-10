import clsx from "clsx"; // function ThemeToggle() {
import { useState } from "react";
import { useSetAtom } from "jotai";
import { motion } from "framer-motion";
import { PROJECT_URL } from "@shared/consts";
import { useToast } from "~/hooks/useToast";
import { login, logout, useLoginState } from "~/hooks/useLogin";
import { primitiveMetadataAtom, createDefaultPrimitiveMetadata } from "~/atoms/primitiveMetadataAtom";

// function ThemeToggle() {
//   const { isDark, toggleDark } = useDark()
//   return (
//     <li onClick={toggleDark} className="cursor-pointer [&_*]:cursor-pointer transition-all">
//       <span className={$("inline-block", isDark ? "i-ph-moon-stars-duotone" : "i-ph-sun-dim-duotone")} />
//       <span>
//         {isDark ? "浅色模式" : "深色模式"}
//       </span>
//     </li>
//   )
// }

export function Menu() {
    const { loggedIn, userInfo, enableLogin } = useLoginState();
    const [shown, show] = useState(false);
    const toaster = useToast();
    const setPrimitiveMetadata = useSetAtom(primitiveMetadataAtom);

    const handleResetLayout = () => {
        if (!window.confirm("确认重置当前布局到默认配置吗？")) return;

        setPrimitiveMetadata(createDefaultPrimitiveMetadata("manual"));
        toaster(loggedIn ? "布局已重置，稍后会自动同步到云端" : "布局已重置为默认配置", {
            type: "success",
        });
    };

    return (
        <span className="relative" onMouseEnter={() => show(true)} onMouseLeave={() => show(false)}>
            <span className="flex items-center scale-90">
                {enableLogin && loggedIn && userInfo?.avatar ? (
                    <button
                        type="button"
                        title="打开用户菜单"
                        aria-label="打开用户菜单"
                        className="h-6 w-6 rounded-full bg-cover"
                        style={{
                            backgroundImage: `url(${userInfo.avatar}&s=24)`,
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        title="打开菜单"
                        aria-label="打开菜单"
                        className="btn i-si:more-muted-horiz-circle-duotone"
                    />
                )}
            </span>
            {shown && (
                <div className="absolute right-0 z-99 bg-transparent pt-4 top-4">
                    <motion.div
                        id="dropdown-menu"
                        className={clsx(["w-200px", "bg-primary backdrop-blur-5 bg-op-70! rounded-lg shadow-xl"])}
                        initial={{
                            scale: 0.9,
                        }}
                        animate={{
                            scale: 1,
                        }}
                    >
                        <ol className="bg-base bg-op-70! backdrop-blur-md p-2 rounded-lg color-base text-base">
                            {enableLogin.enable &&
                                (loggedIn ? (
                                    <li onClick={logout}>
                                        <span className="i-ph:sign-out-duotone inline-block" />
                                        <span>退出登录</span>
                                    </li>
                                ) : (
                                    <li onClick={login}>
                                        <span className="i-ph:sign-in-duotone inline-block" />
                                        <span>Github 账号登录</span>
                                    </li>
                                ))}
                            <li onClick={handleResetLayout}>
                                <span className="i-ph:arrows-counter-clockwise-duotone inline-block" />
                                <span>重置布局</span>
                            </li>
                            {/* <ThemeToggle /> */}
                            <li
                                onClick={() => window.open(PROJECT_URL)}
                                className="cursor-pointer [&_*]:cursor-pointer transition-all"
                            >
                                <span className="i-ph:github-logo-duotone inline-block" />
                                <span>Star on Github </span>
                            </li>
                            <li className="flex gap-2 items-center">
                                <a href={`${PROJECT_URL}`}>
                                    <img
                                        alt="GitHub stars badge"
                                        src="https://img.shields.io/github/stars/bruceblink/LatestNews?logo=github&style=flat&labelColor=%235e3c40&color=%23614447"
                                    />
                                </a>
                                <a href={`${PROJECT_URL}/fork`}>
                                    <img
                                        alt="GitHub forks badge"
                                        src="https://img.shields.io/github/forks/bruceblink/LatestNews?logo=github&style=flat&labelColor=%235e3c40&color=%23614447"
                                    />
                                </a>
                            </li>
                        </ol>
                    </motion.div>
                </div>
            )}
        </span>
    );
}
