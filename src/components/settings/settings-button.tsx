import * as Dialog from "@radix-ui/react-dialog";

import { SettingsPanel } from "./settings-panel";

/** Open the shared configuration panel from either Web or Electron. */
export function SettingsButton() {
    return (
        <Dialog.Root>
            <Dialog.Trigger asChild>
                <button type="button" title="设置" aria-label="打开设置" className="icon-button">
                    <span className="i-ph:gear-six-duotone" aria-hidden="true" />
                </button>
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="settings-overlay" />
                <Dialog.Content className="settings-dialog">
                    <div className="settings-dialog-heading">
                        <div>
                            <Dialog.Title className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">
                                设置
                            </Dialog.Title>
                            <Dialog.Description className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                                管理 Web 和桌面端共用的应用配置。
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <button type="button" title="关闭设置" aria-label="关闭设置" className="icon-button">
                                <span className="i-ph:x-duotone" aria-hidden="true" />
                            </button>
                        </Dialog.Close>
                    </div>
                    <SettingsPanel showTitle={false} />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
