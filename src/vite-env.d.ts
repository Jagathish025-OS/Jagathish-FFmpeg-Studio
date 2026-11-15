/// <reference types="vite/client" />

interface DesktopOutput {
  path: string;
  name: string;
  size: number;
}
interface Window {
  desktopFFmpeg?: {
    getPathForFile(file: File): string;
    runJob(request: {
      jobId: string;
      paths: string[];
      extraPath?: string;
      tool: string;
      options: Record<string, string>;
    }): Promise<{ outputs: DesktopOutput[] }>;
    cancelJob(jobId: string): Promise<boolean>;
    revealFile(filePath: string): Promise<void>;
    openDialog(kind?: string): Promise<string[]>;
    onProgress(callback: (data: { jobId: string; progress: number }) => void): () => void;
  };
}
