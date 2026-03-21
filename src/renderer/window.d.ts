// Type declaration for window.api exposed by preload.ts via contextBridge

interface Window {
  api: {
    openFileDialog: () => Promise<{ filePath: string; buffer: ArrayBuffer }[] | null>;
    saveFile: (filePath: string, arrayBuffer: ArrayBuffer) => Promise<void>;
    saveFileCopy: (arrayBuffer: ArrayBuffer) => Promise<void>;
    openNewWindow: (filePath?: string) => Promise<void>;
    getWindowId: () => Promise<number>;
    openFileFromPath: (filePath: string) => Promise<{ filePath: string; buffer: ArrayBuffer } | null>;
    notifyTabTransferred: (sourceWindowId: number, filePath: string) => Promise<void>;
    onMenuEvent: (callback: (event: string) => void) => void;
    onOpenFileData: (callback: (data: { filePath: string; buffer: ArrayBuffer }) => void) => void;
    onCloseTabByFilepath: (callback: (filePath: string) => void) => void;
    startDrag: (filePath: string) => void;
    setUiZoom: (factor: number) => void;
    getUiZoom: () => number;
    minimizeWindow: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    closeWindow: () => Promise<void>;
    platform: string;
    openDevTools: () => void;
    focusWindow: () => Promise<void>;
    forceClose: () => Promise<void>;
    onBeforeClose: (callback: () => void) => void;
  };
}
