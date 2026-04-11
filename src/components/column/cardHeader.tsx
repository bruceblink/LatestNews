import type { SourceID } from "@shared/types.ts";
import type { SourceHealthStatus } from "~/hooks/useSourceHealth";

import clsx from "clsx";
import { useRefetch } from "~/hooks/useRefetch";
import { useLoginState } from "~/hooks/useLogin";
import dataSources from "@shared/data-sources.ts";
import { useFocusWith } from "~/hooks/useFocus.ts";
import { useRelativeTime } from "~/hooks/useRelativeTime";

interface CardHeaderProps {
    id: SourceID;
    data: any;
    healthStatus?: SourceHealthStatus;
    isFetching: boolean;
    isError: boolean;
    updatedTime?: string | number;
    setHandleRef?: (el: HTMLDivElement | null) => void;
}

/**
 * 新闻源顶部栏
 */
export function CardHeader({ id, data, healthStatus, isFetching, isError, setHandleRef }: CardHeaderProps) {
    const { refresh } = useRefetch();
    const { enableLogin } = useLoginState();
    const { isFocused, toggleFocus } = useFocusWith(id);
    const ds = dataSources[id];
    const healthStatusLabel = healthStatus === "failing" ? "异常" : healthStatus === "idle" ? "未采样" : undefined;

    return (
        <div className={clsx("flex justify-between mx-2 mt-0 mb-2 items-center")}>
            <div className="flex gap-2 items-center">
                <a
                    className={clsx("w-8 h-8 rounded-full bg-cover")}
                    target="_blank"
                    href={ds.home}
                    title={ds.desc}
                    style={{
                        backgroundImage: `url(/icons/${id.split("-")[0]}.png)`,
                    }}
                />
                <span className="flex flex-col">
                    <span className="flex items-center gap-2">
                        <span className="text-xl font-bold" title={ds.desc}>
                            {ds.name}
                        </span>
                        {healthStatusLabel && (
                            <span
                                className={clsx(
                                    "rounded px-1.5 py-0.5 text-xs",
                                    healthStatus === "failing"
                                        ? "bg-red-500/10 text-red-700 dark:text-red-300"
                                        : "bg-neutral-500/10 text-neutral-600 dark:text-neutral-300"
                                )}
                            >
                                {healthStatusLabel}
                            </span>
                        )}
                        {ds?.title && (
                            <span
                                className={clsx("text-sm", `color-${ds.color} bg-base op-80 bg-op-50\\! px-1 rounded`)}
                            >
                                {ds.title}
                            </span>
                        )}
                    </span>
                    <span className="text-xs op-70">
                        <UpdatedTime isError={isError} updatedTime={data?.updatedTime} />
                    </span>
                </span>
            </div>
            <div className={clsx("flex gap-2 text-lg", `color-${ds.color}`)}>
                {enableLogin.enable && (
                    <button
                        title="isFetching"
                        type="button"
                        className={clsx(
                            "btn i-ph:arrow-counter-clockwise-duotone",
                            isFetching && "animate-spin i-ph:spinner-duotone"
                        )}
                        onClick={() => refresh(id)}
                    />
                )}
                <button
                    title="isFocused"
                    type="button"
                    className={clsx("btn", isFocused ? "i-ph:star-fill" : "i-ph:star-duotone")}
                    onClick={toggleFocus}
                />
                {/* firefox cannot drag a button */}
                {setHandleRef && (
                    <div ref={setHandleRef} className={clsx("btn", "i-ph:dots-six-vertical-duotone", "cursor-grab")} />
                )}
            </div>
        </div>
    );
}

function UpdatedTime({ isError, updatedTime }: { updatedTime: any; isError: boolean }) {
    const relativeTime = useRelativeTime(updatedTime ?? "");
    if (relativeTime) return `${relativeTime}更新`;
    if (isError) return "获取失败";
    return "加载中...";
}
