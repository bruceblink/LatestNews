import * as Dialog from "@radix-ui/react-dialog";

import { SettingsPanel } from "./settings-panel";

/** Open the shared configuration panel from either Web or Electron. */
export function SettingsButton() {
    return (
        <Dialog.Root>
            <Dialog.Trigger asChild>
                <button
                    type="button"
                    title="设置"
                    aria-label="打开设置"
                    className="btn text-zinc-600 dark:text-zinc-500/80 hover:text-zinc-900 dark:hover:text-zinc-300 i-ph:gear-six-duotone"
                />
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-100 bg-zinc-950/35 backdrop-blur-sm" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-101 max-h-[88vh] w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-base p-5 text-base shadow-2xl outline-none">
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div>
                            <Dialog.Title className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">
                                设置
                            </Dialog.Title>
                            <Dialog.Description className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                                管理 Web 和桌面端共用的应用配置。
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                title="关闭设置"
                                aria-label="关闭设置"
                                className="btn i-ph:x-duotone text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                            />
                        </Dialog.Close>
                    </div>
                    <SettingsPanel showTitle={false} />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
