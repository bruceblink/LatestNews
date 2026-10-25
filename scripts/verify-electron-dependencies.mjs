import ts from "typescript";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";

const runtimeModules = new Set(["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/** Reject runtime package imports because the desktop manifest intentionally has no dependencies. */
export async function verifyElectronDependencies(outputRoot) {
    for (const directory of ["main", "preload"]) {
        const root = resolve(outputRoot, directory);
        for (const file of await readdir(root, { recursive: true, withFileTypes: true })) {
            if (!file.isFile() || !/\.[cm]?js$/.test(file.name)) continue;
            const path = resolve(file.parentPath, file.name);
            const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
            const externalModules = new Set();
            function visit(node) {
                let specifier;
                if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                    specifier = node.moduleSpecifier;
                } else if (
                    ts.isCallExpression(node) &&
                    ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
                        node.expression.kind === ts.SyntaxKind.ImportKeyword)
                ) {
                    specifier = node.arguments[0];
                }
                if (specifier && ts.isStringLiteralLike(specifier)) {
                    const name = specifier.text;
                    if (!name.startsWith(".") && !runtimeModules.has(name)) externalModules.add(name);
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
            if (externalModules.size) {
                throw new Error(`Electron bundle ${path} requires unpackaged modules: ${[...externalModules].join(", ")}`);
            }
        }
    }
}
