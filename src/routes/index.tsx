import {focusSourcesAtom} from "~/atoms";
import {Column} from "~/components/column";
import {createFileRoute} from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
    const focusSources = useAtomValue(focusSourcesAtom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
    const id = useMemo(() => focusSources.length ? "focus" : "hottest", []);
    return <Column id={id}/>;
}
