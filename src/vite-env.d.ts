/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

// Build-time constants injected via `define` in vite.config.ts.
declare const __APP_VERSION__: string;
declare const __CORE_VERSION__: string;
declare const __PDFJS_VERSION__: string;
declare const __ORT_RUNTIME_FILES__: string[];
/** Worker and module scripts under public/ (the AI, OCR and PDF runtimes), as site paths. */
declare const __RUNTIME_SCRIPTS__: string[];
