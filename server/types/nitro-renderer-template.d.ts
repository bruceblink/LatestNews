declare module "#nitro/virtual/renderer-template" {
    export function rendererTemplate(request: Request): string | Promise<string>;
}
