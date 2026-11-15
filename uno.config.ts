import { hex2rgba } from "@unocss/rule-utils";
import { presetIcons, presetWind3, defineConfig, transformerDirectives, transformerVariantGroup } from "unocss";

import { dataSources } from "./shared/data-sources";
import { appNavigation, columnNavigation } from "./shared/app-navigation";

export default defineConfig({
    mergeSelectors: false,
    transformers: [transformerDirectives(), transformerVariantGroup()],
    presets: [
        presetWind3(),
        presetIcons({
            scale: 1.2,
        }),
    ],
    rules: [
        [
            /^sprinkle-(.+)$/,
            ([_, d], { theme }) => {
                // @ts-expect-error >_<
                const hex: any = theme.colors?.[d]?.[400];
                if (hex) {
                    return {
                        "background-image": `radial-gradient(ellipse 80% 80% at 50% -30%,
         rgba(${hex2rgba(hex)?.join(", ")}, 0.3), rgba(255, 255, 255, 0));`,
                    };
                }
                return undefined;
            },
        ],
        [
            "font-brand",
            {
                "font-family": `"Baloo 2", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace; `,
            },
        ],
    ],
    shortcuts: {
        "color-base": "color-[var(--text-primary)]",
        "bg-base": "bg-[var(--surface)]",
        btn: "op75 hover:op100 cursor-pointer transition-colors",
    },
    safelist: [
        ...Object.values(appNavigation).map((item) => item.icon),
        ...columnNavigation.map((item) => item.icon),
        ...["orange", ...new Set(Object.values(dataSources).map((k) => k.color))]
            .map((k) =>
                `bg-${k} color-${k} border-${k} sprinkle-${k} shadow-${k}
       bg-${k}-500 color-${k}-500
       dark:bg-${k} dark:color-${k}`
                    .trim()
                    .split(/\s+/)
            )
            .flat(),
    ],
    extendTheme: (theme) => {
        // 旧页面沿用原有工具类，但普通控件与新工作台共用中性色；告警色保持独立。
        // @ts-expect-error UnoCSS 的扩展主题未声明颜色字段。
        theme.colors.zinc = theme.colors.neutral;
        // @ts-expect-error UnoCSS 的扩展主题未声明颜色字段。
        theme.colors.cyan = theme.colors.neutral;
        // @ts-expect-error UnoCSS 的扩展主题未声明颜色字段。
        theme.colors.primary = theme.colors.neutral;
        return theme;
    },
});
