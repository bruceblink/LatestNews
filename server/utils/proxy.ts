import { sourceApi } from "@shared/source-api";

export function proxyPicture(url: string) {
    return `/api${sourceApi.imageProxyV1}?${new URLSearchParams({ url })}`;
}
