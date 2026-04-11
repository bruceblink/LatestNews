import { getDefaultStore } from "jotai";
import { redirect, createFileRoute } from "@tanstack/react-router";
import { primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";
import { downloadMetadata, setAuthSyncFeedback, mergePrimitiveMetadata } from "~/services/metadata.service.ts";

export const Route = createFileRoute("/auth/callback")({
    beforeLoad: async () => {
        try {
            const metadata = await downloadMetadata();

            if (metadata) {
                const store = getDefaultStore();
                store.set(primitiveMetadataAtom, (prev) => mergePrimitiveMetadata(prev, metadata));
                setAuthSyncFeedback("success");
            }
        } catch {
            setAuthSyncFeedback("error");
        }

        throw redirect({
            to: "/",
            replace: true,
        });
    },
    component: () => null,
});
