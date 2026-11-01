export interface DesktopUpdateState {
    currentVersion: string;
    autoCheck: boolean;
    status:
        | "disabled"
        | "idle"
        | "checking"
        | "not-available"
        | "available"
        | "downloading"
        | "downloaded"
        | "installing"
        | "error";
    disabledReason?: "development" | "unsupported";
    availableVersion?: string;
    lastCheckedAt?: number;
    progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number };
    error?: "check-failed" | "download-failed" | "install-failed" | "settings-failed";
}

export interface DesktopUpdateBridge {
    getState(): Promise<DesktopUpdateState>;
    setAutoCheck(enabled: boolean): Promise<DesktopUpdateState>;
    check(): Promise<DesktopUpdateState>;
    download(): Promise<DesktopUpdateState>;
    cancel(): Promise<DesktopUpdateState>;
    install(): Promise<DesktopUpdateState>;
    onState(callback: (state: DesktopUpdateState) => void): () => void;
}
