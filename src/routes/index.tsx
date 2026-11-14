import { Navigate, createFileRoute } from "@tanstack/react-router";

/** 应用入口直接进入洞察工作区，其他功能通过统一侧栏继续访问。 */
export const Route = createFileRoute("/")({
    component: HomeRedirect,
});

function HomeRedirect() {
    return <Navigate to="/insights" replace />;
}
