import { useTitle } from "react-use";
import { APP_TITLE } from "~/utils/app-title";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPanel } from "~/components/settings/settings-panel";

export const Route = createFileRoute("/settings")({
    component: SettingsPage,
});

function SettingsPage() {
    useTitle(`${APP_TITLE} | 设置`);
    return <SettingsPanel />;
}
