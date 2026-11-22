import { redirect, createFileRoute } from "@tanstack/react-router";
import { authLayoutCallbackKey } from "~/services/metadata.service";

export const Route = createFileRoute("/auth/callback")({
    beforeLoad: () => {
        sessionStorage.setItem(authLayoutCallbackKey, "true");
        throw redirect({
            to: "/",
            replace: true,
        });
    },
    component: () => null,
});
