export const DEFAULT_APP_TITLE = "LatestNews";

export function resolveAppTitle(value: string | undefined | null): string {
    return value?.trim() || DEFAULT_APP_TITLE;
}

export function escapeHtmlText(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}
