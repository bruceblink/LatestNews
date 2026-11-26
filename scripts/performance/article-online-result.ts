import { rename, readFile, writeFile } from "node:fs/promises";

/** IPC is only a control channel. Large run results are published as files
 * before process exit; the parent never accepts a successful exit alone. */
export async function publishOnlineResult(path: string, value: unknown) {
    const temporary = path + ".partial";
    await writeFile(temporary, JSON.stringify(value) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
}
export async function readOnlineResult<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, "utf8")) as T;
}
