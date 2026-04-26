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
                    className="w-8 h-8 rounded-full bg-cover ring-1 ring-zinc-300 dark:ring-zinc-700/60"
                    target="_blank"
                    href={ds.home}
                    title={ds.desc}
                    style={{
                        backgroundImage: `url(/icons/${id.split("-")[0]}.png)`,
                    }}
                />
                <span className="flex flex-col">
                    <span className="flex items-center gap-2">
                        <span className="text-base font-semibold text-zinc-800 dark:text-zinc-200/90" title={ds.desc}>
                            {ds.name}
                        </span>
                        {healthStatusLabel && (
                            <span
                                className={clsx(
                                    "rounded px-1.5 py-0.5 text-xs",
                                    healthStatus === "failing"
                                        ? "bg-red-500/8 text-red-400/85"
                                        : "bg-zinc-200/75 dark:bg-zinc-700/35 text-zinc-700 dark:text-zinc-500"
                                )}
                            >
                                {healthStatusLabel}
                            </span>
                        )}
                        {ds?.title && (
                            <span
                                className={clsx(
                                    "text-xs rounded px-1 py-0.5",
                                    `color-${ds.color} bg-zinc-100/90 dark:bg-zinc-800/70 op-75`
                                )}
                            >
                                {ds.title}
                            </span>
                        )}
                    </span>
                    <span className="text-xs text-zinc-600">
                        <UpdatedTime isError={isError} updatedTime={data?.updatedTime} />
                    </span>
                </span>
            </div>
            <div className="flex gap-2 text-lg text-zinc-600/80 dark:text-zinc-500/60">
                {enableLogin.enable && (
                    <button
                        title="isFetching"
                        type="button"
                        className={clsx(
                            "btn hover:text-zinc-800 dark:hover:text-cyan-400 i-ph:arrow-counter-clockwise-duotone",
                            isFetching && "animate-spin i-ph:spinner-duotone"
                        )}
                        onClick={() => refresh(id)}
                    />
                )}
                <button
                    title={isFocused ? "取消关注" : "加入关注"}
                    type="button"
                    className={clsx(
                        "btn hover:text-zinc-800 dark:hover:text-cyan-400",
                        isFocused ? "i-ph:star-fill text-zinc-700 dark:text-cyan-400" : "i-ph:star-duotone"
                    )}
                    onClick={toggleFocus}
                />
                {/* firefox cannot drag a button */}
                {setHandleRef && (
                    <div
                        ref={setHandleRef}
                        className="btn hover:text-zinc-800 dark:hover:text-cyan-400 i-ph:dots-six-vertical-duotone cursor-grab"
                    />
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
