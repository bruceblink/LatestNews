/**
 * @type {import("prettier").Config}
 * Need to restart IDE when changing configuration
 * Open the command palette (Ctrl + Shift + P) and execute the command > Reload Window.
 */
const config = {
    // ------------------------
    // 基础格式化
    // ------------------------
    semi: true,                  // 每条语句末尾加分号
    tabWidth: 2,                 // 缩进宽度
    endOfLine: "lf",             // 使用 LF 作为换行符
    printWidth: 120,             // 每行最大长度
    trailingComma: "es5",        // 尾随逗号, 对象、数组、函数参数

    // ------------------------
    // JSX & React
    // ------------------------
    jsxSingleQuote: false,       // JSX 中使用双引号
    bracketSpacing: true,        // 对象字面量的大括号两侧加空格
    jsxBracketSameLine: false,   // JSX 末尾 `>` 是否另起一行
    proseWrap: "preserve",       // Markdown 或字符串是否换行
    quoteProps: "as-needed",     // 对象 key 是否加引号

    // ------------------------
    // HTML / JSON / YAML 等
    // ------------------------
    htmlWhitespaceSensitivity: "css", // HTML 空格敏感度
    embeddedLanguageFormatting: "auto", // 自动格式化嵌入的语言

    // ------------------------
    // 其他
    // ------------------------
    bracketSameLine: false,      // JSX 与对象闭合括号是否同行
    rangeStart: 0,               // 可限制格式化范围
    rangeEnd: Infinity,
    insertPragma: false,         // 是否在文件开头插入 @format
    requirePragma: false,        // 是否只格式化带 @format 注释的文件
};

export default config;
