import { getDefaultStore } from "jotai";
import { redirect, createFileRoute } from "@tanstack/react-router";
import { primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";
import { downloadMetadata, mergePrimitiveMetadata } from "~/services/metadata.service.ts";

export const Route = createFileRoute("/auth/callback")({
    beforeLoad: async () => {
        const metadata = await downloadMetadata();

        if (metadata) {
            const store = getDefaultStore();
            debugger;
            store.set(primitiveMetadataAtom, (prev) => mergePrimitiveMetadata(prev, metadata));
        }

        throw redirect({
            to: "/",
            replace: true,
        });
    },
    component: () => null,
});
