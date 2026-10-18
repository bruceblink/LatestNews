/** Keep credentials and app-specific runtime settings out of plugin child processes. */
export function createRestrictedWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const allowedNames = new Set(["path", "systemroot", "windir", "temp", "tmp", "home"]);
    return Object.fromEntries(Object.entries(source).filter(([name]) => allowedNames.has(name.toLowerCase())));
}
