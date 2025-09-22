import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import unusedImportsPlugin from "eslint-plugin-unused-imports";

// ----------------------------------------------------------------------

// 公共规则（JS/React）
const commonRules = {
    ...reactHooksPlugin.configs.recommended.rules,
    "func-names": 1,
    "no-bitwise": 2,
    "no-unused-vars": 0,
    "object-shorthand": 1,
    "no-useless-rename": 1,
    "default-case-last": 2,
    "consistent-return": 2,
    "no-constant-condition": 1,
    "default-case": [2, { commentPattern: "^no default$" }],
    "lines-around-directive": [2, { before: "always", after: "always" }],
    "arrow-body-style": "off",
    "react/jsx-key": 0,
    "react/prop-types": 0,
    "react/display-name": 0,
    "react/no-children-prop": 0,
    "react/jsx-boolean-value": 2,
    "react/self-closing-comp": 2,
    "react/react-in-jsx-scope": 0,
    "react/jsx-no-useless-fragment": [1, { allowExpressions: true }],
    "react/jsx-curly-brace-presence": [2, { props: "never", children: "never" }],
    quotes: [2, "double", { avoidEscape: true }],
    "jsx-quotes": [2, "prefer-double"],
    "semi": ["error", "always"],   //  "error"：没有分号时报错 "always"：要求每条语句后必须有分号
};

// unused-imports
const unusedImportsRules = {
    "unused-imports/no-unused-imports": 1,
    "unused-imports/no-unused-vars": [
        0,
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
    ],
};

// Perfectionist 自定义分组 + 排序
const sortImportsRules = {
    "perfectionist/sort-named-imports": [1, { type: "line-length", order: "asc" }],
    "perfectionist/sort-named-exports": [1, { type: "line-length", order: "asc" }],
    "perfectionist/sort-exports": [1, { order: "asc", type: "line-length", groupKind: "values-first" }],
    "perfectionist/sort-imports": [
        2,
        {
            order: "asc",
            ignoreCase: true,
            type: "line-length",
            environment: "node",
            maxLineLength: undefined,
            newlinesBetween: "always",
            internalPattern: ["^src/.+"],
            groups: [
                "style",
                "side-effect",
                "type",
                ["builtin", "external"],
                "custom-mui",
                "custom-routes",
                "custom-hooks",
                "custom-utils",
                "internal",
                "custom-components",
                "custom-sections",
                "custom-auth",
                "custom-types",
                ["parent", "sibling", "index"],
                ["parent-type", "sibling-type", "index-type"],
                "object",
                "unknown",
            ],
            customGroups: {
                value: {
                    "custom-mui": ["^@mui/.+"],
                    "custom-auth": ["^src/auth/.+"],
                    "custom-hooks": ["^src/hooks/.+"],
                    "custom-utils": ["^src/utils/.+"],
                    "custom-types": ["^src/types/.+"],
                    "custom-routes": ["^src/routes/.+"],
                    "custom-sections": ["^src/sections/.+"],
                    "custom-components": ["^src/components/.+"],
                },
            },
        },
    ],
};


// ----------------------------------------------------------------------

// 导出 ESLint Flat Config
export default [
    // JS/React 文件规则
    {
        files: ["**/*.{js,jsx,mjs,cjs}"],
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
        plugins: {
            "react-hooks": reactHooksPlugin,
            "unused-imports": unusedImportsPlugin,
            perfectionist: perfectionistPlugin,
            import: importPlugin,
            react: reactPlugin,
        },
        settings: {
            "import/resolver": {
                typescript: { project: "./tsconfig.json" },
                node: true,
            },
            react: { version: "detect" },
        },
        rules: {
            ...commonRules,
            ...unusedImportsRules,
            ...sortImportsRules,
            "import/no-unresolved": "error",
        },
    },

    // TypeScript 文件规则
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsParser,
            globals: { ...globals.browser, ...globals.node },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            "react-hooks": reactHooksPlugin,
            "unused-imports": unusedImportsPlugin,
            perfectionist: perfectionistPlugin,
            import: importPlugin,
            react: reactPlugin,
        },
        settings: {
            "import/resolver": {
                typescript: { project: "./tsconfig.json" },
                node: true,
            },
            react: { version: "detect" },
        },
        rules: {
            ...commonRules,
            ...unusedImportsRules,
            ...sortImportsRules,
            // TS 专用规则
            "@typescript-eslint/no-shadow": 2,
            "@typescript-eslint/no-explicit-any": 0,
            "@typescript-eslint/no-empty-object-type": 0,
            "@typescript-eslint/consistent-type-imports": 1,
            "@typescript-eslint/no-unused-vars": [1, { args: "none" }],
        },
    },
];