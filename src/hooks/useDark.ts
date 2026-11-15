import { useAtom } from "jotai";
import { useMedia } from "react-use";
import { useMemo, useEffect } from "react";
import { atomWithStorage, createJSONStorage, unstable_withStorageValidator as withStorageValidator } from "jotai/utils";

export declare type ColorScheme = "dark" | "light" | "auto";

const colorSchemeStorage = withStorageValidator(
    (value): value is ColorScheme => value === "light" || value === "dark" || value === "auto"
)(createJSONStorage());

export const colorSchemeAtom = atomWithStorage<ColorScheme>("color-scheme", "light", colorSchemeStorage, {
    getOnInit: true,
});

export function useDark() {
    const [colorScheme, setColorScheme] = useAtom(colorSchemeAtom);
    const prefersDarkMode = useMedia("(prefers-color-scheme: dark)");
    const isDark = useMemo(
        () => (colorScheme === "auto" ? prefersDarkMode : colorScheme === "dark"),
        [colorScheme, prefersDarkMode]
    );

    useEffect(() => {
        document.documentElement.classList.toggle("dark", isDark);
    }, [isDark]);

    const setDark = (value: ColorScheme) => {
        setColorScheme(value);
    };

    const toggleDark = () => {
        setColorScheme(isDark ? "light" : "dark");
    };

    return { isDark, setDark, toggleDark };
}
