# Jagathish FFmpeg Studio

A browser-first media utility website built with React, TypeScript, Vite and FFmpeg.wasm. It is configured for deployment at https://jagathish.online/ffmpeg/.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

Deploy the generated `dist/` directory as a static site. No Node.js media backend or database is required: selected media is processed in the browser with FFmpeg.wasm and output files are created locally.

## Tools in this starter

Video compressor, video cutter, video converter, audio converter, video-to-GIF, audio extraction, video merger, audio cutter, SRT subtitle burn-in, text watermark, batch conversion, thumbnail extraction, speed adjustment, crop/resize and image slideshow.

## Notes and limitations

- FFmpeg WebAssembly is downloaded from unpkg on first use. Consider self-hosting pinned core assets for production reliability.
- Large files can consume substantial browser memory and processing time.
- Video merge currently uses stream-copy concat and therefore requires compatible input streams.
- Browser codec/filter support depends on the FFmpeg core build. Subtitle burn-in requires the subtitles filter.
- Batch mode emits individual converted files; it does not yet package them into a ZIP.
- Image slideshow expects compatible image inputs.
- This starter should be tested with representative files and browsers before being advertised as production-ready.

## Deployment under /ffmpeg/

The Vite base path is already set to `/ffmpeg/`. Build with `npm run build` and publish `dist/` at the matching path.