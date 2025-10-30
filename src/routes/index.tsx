import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { focusSourcesAtom } from "~/atoms";
import { Column } from "~/components/column";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
    component: IndexComponent,
});

function IndexComponent() {
    const focusSources = useAtomValue(focusSourcesAtom);
    const id = useMemo(() => (focusSources.length ? "focus" : "hottest"), [focusSources.length]);
    return <Column id={id} />;
}
