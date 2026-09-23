// Type declaration for window.api exposed by preload.ts via contextBridge

interface EditableContextMenuData {
  x: number;
  y: number;
  misspelledWord: string;
  suggestions: string[];
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
}

interface Window {
  api: {
    openFileDialog: () => Promise<{ filePath: string; buffer: ArrayBuffer }[] | null>;
    saveFile: (filePath: string, arrayBuffer: ArrayBuffer) => Promise<{ ok: boolean; error?: string }>;
    saveFileCopy: (arrayBuffer: ArrayBuffer, defaultPath?: string) => Promise<{ ok: boolean; filePath?: string }>;
    showMessageBox: (options: { type?: string; buttons: string[]; title?: string; message: string; detail?: string; defaultId?: number; cancelId?: number }) => Promise<number>;
    openNewWindow: (filePath?: string) => Promise<{ ok: boolean }>;
    getWindowId: () => Promise<number>;
    openFileFromPath: (filePath: string) => Promise<{ filePath: string; buffer: ArrayBuffer } | null>;
    notifyTabTransferred: (sourceWindowId: number, filePath: string) => Promise<{ ok: boolean }>;
    getExtensionId: () => Promise<{ ok: boolean; id?: string; error?: string }>;
    setExtensionId: (id: string) => Promise<{ ok: boolean; error?: string }>;
    getReuseTabSetting: () => Promise<{ enabled: boolean }>;
    setReuseTabSetting: (enabled: boolean) => Promise<{ ok: boolean }>;
    getTheme: () => Promise<{ mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }>;
    setTheme: (mode: 'light' | 'dark' | 'system') => Promise<{ ok: boolean; error?: string }>;
    onThemeUpdated: (callback: (data: { mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }) => void) => void;
    onEditableContextMenu: (callback: (data: EditableContextMenuData) => void) => void;
    replaceMisspelling: (word: string) => void;
    addToDictionary:    (word: string) => void;
    editableCommand:    (command: 'cut' | 'copy' | 'paste') => void;
    onMenuEvent: (callback: (event: string) => void) => void;
    onOpenFileData: (callback: (data: { filePath: string; buffer: ArrayBuffer; sourceUrl: string | null }) => void) => void;
    onCloseTabByFilepath: (callback: (filePath: string) => void) => void;
    copyFileToClipboard: (filePath: string) => Promise<{ ok: boolean }>;
    revealInExplorer:    (filePath: string) => Promise<{ ok: boolean }>;
    openPrintPreview:       (filePath: string)                                         => Promise<{ ok: boolean; error?: string }>;
    onPdfData:              (callback: (data: { buffer: ArrayBuffer }) => void)        => void;
    getPrinters:            ()                                                          => Promise<{ name: string; isDefault: boolean }[]>;
    openPrinterPreferences: (printerName: string)                                      => Promise<{ ok: boolean; error?: string }>;
    executePrint: (options: {
      pdfBytes:    ArrayBuffer;
      deviceName:  string;
      copies:      number;
      color:       boolean;
      collate:     boolean;
      duplexMode:  'simplex' | 'longEdge' | 'shortEdge';
      scaleFactor: number;
      landscape:   boolean;
      pageSize:    { width: number; height: number }; // microns
    }) => Promise<{ ok: boolean; error?: string }>;
    startDrag: (filePath: string) => void;
    setUiZoom: (factor: number) => void;
    getUiZoom: () => number;
    minimizeWindow: () => Promise<{ ok: boolean }>;
    toggleMaximize: () => Promise<{ ok: boolean }>;
    closeWindow: () => Promise<{ ok: boolean }>;
    platform: string;
    openDevTools: () => void;
    focusWindow: () => Promise<{ ok: boolean }>;
    forceClose: () => Promise<{ ok: boolean }>;
    onBeforeClose: (callback: () => void) => void;
  };
}
