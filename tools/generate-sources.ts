import { join } from "node:path";
import { consola } from "consola";
import { pinyin } from "@napi-rs/pinyin";
import { readFileSync, writeFileSync } from "node:fs";

import { projectDir } from "../shared/dir";
import { genSources } from "../shared/pre-sources";

export function generateSourceFiles(outputDir = join(projectDir, "shared")) {
    const sources = genSources();
    const pinyinMap = Object.fromEntries(
        Object.entries(sources)
            .filter(([, source]) => !source.redirect)
            .map(([id, { name, title }]) => [id, pinyin(title ? `${name}-${title}` : name).join("")])
    );

    writeIfChanged("pinyin.json", pinyinMap);
    writeIfChanged("sources.json", sources);

    function writeIfChanged(name: string, data: unknown) {
        const path = join(outputDir, name);
        const json = JSON.stringify(data, undefined, 2);
        try {
            if (readFileSync(path, "utf8") === json) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        writeFileSync(path, json);
        consola.info(`Generated ${name}`);
    }
}
