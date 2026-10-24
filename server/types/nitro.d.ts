import "h3";

declare module "h3" {
    interface H3EventContext {
        disabledLogin?: boolean;
        user?: {
            id: string;
            type?: string;
        };
        waitUntil?: (promise: Promise<unknown>) => void;
    }
}
