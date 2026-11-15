import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let engine: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getEngine(
  log?: (message: string) => void,
  progress?: (percent: number) => void,
) {
  if (engine?.loaded) return engine;
  if (loading) return loading;

  loading = (async () => {
    const ff = new FFmpeg();
    ff.on('log', ({ message }) => log?.(message));
    ff.on('progress', ({ progress: value }) => {
      progress?.(Math.round(Math.max(0, Math.min(1, value)) * 100));
    });

    // Vite must use the ESM FFmpeg core build. The worker URL is supplied
    // explicitly so the core can load its companion worker in the browser.
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    ]);

    await ff.load({ coreURL, wasmURL, workerURL });
    engine = ff;
    return ff;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export { fetchFile };
