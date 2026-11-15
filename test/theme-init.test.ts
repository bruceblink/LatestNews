import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { it, vi, expect, describe } from "vitest";

const script = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");

describe("initial theme script", () => {
    it.each([
        { saved: '"light"', systemDark: true, expected: false },
        { saved: '"dark"', systemDark: false, expected: true },
        { saved: '"auto"', systemDark: true, expected: true },
        { saved: '"auto"', systemDark: false, expected: false },
        { saved: null, systemDark: true, expected: false },
        { saved: "invalid JSON", systemDark: true, expected: false },
        { saved: '"unknown"', systemDark: true, expected: false },
        { saved: "null", systemDark: true, expected: false },
    ])("applies $saved before app startup when system dark is $systemDark", ({ saved, systemDark, expected }) => {
        const toggle = vi.fn();
        const getItem = vi.fn(() => saved);
        const matchMedia = vi.fn(() => ({ matches: systemDark }));

        runInNewContext(script, {
            document: { documentElement: { classList: { toggle } } },
            localStorage: { getItem },
            window: { matchMedia },
        });

        expect(getItem).toHaveBeenCalledWith("color-scheme");
        expect(toggle).toHaveBeenCalledExactlyOnceWith("dark", expected);
        if (saved === '"auto"') expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
        else expect(matchMedia).not.toHaveBeenCalled();
    });

    it("keeps the default light theme when reading storage is blocked", () => {
        const toggle = vi.fn();

        expect(() =>
            runInNewContext(script, {
                document: { documentElement: { classList: { toggle } } },
                localStorage: {
                    getItem() {
                        throw new Error("Storage is unavailable");
                    },
                },
            })
        ).not.toThrow();
        expect(toggle).toHaveBeenCalledExactlyOnceWith("dark", false);
    });
});
