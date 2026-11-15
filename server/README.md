# Large-file FFmpeg engine

This is a separate API service for disk-backed FFmpeg processing. It is not part of the existing static-site deployment.

## Why a separate service

The current static site runs FFmpeg.wasm in browser memory. This API accepts resumable 16 MiB chunks, writes them to disk, then invokes the native `ffmpeg` executable against the disk file. It avoids loading the complete source video into Node.js memory.

## Deploy on Render

Create a **separate Web Service** from this repository and configure:

- Runtime: Docker
- Dockerfile Path: `./server/Dockerfile`
- Docker Context: repository root
- Health Check Path: `/health`
- Environment: `DATA_DIR=/var/data/ffmpeg-jobs`
- Environment: `FRONTEND_ORIGIN=https://jagathish-ffmpeg-studio.onrender.com` (change to the actual frontend origin)
- Environment: `MAX_FILE_BYTES=10737418240` (10 GiB)
- Persistent disk mount path: `/var/data`
- Persistent disk size: at least 15 GB for a 10 GB input plus output and temporary files

A persistent disk and paid Render service are required. Render documents that free web services do not support persistent disks and have 512 MB RAM. Choose compute with adequate RAM/CPU for your media workload; 2 GB RAM is a starting point, not a guarantee for every 4K codec or filter. See Render's current [free instance limitations](https://render.com/docs/free), [persistent disk documentation](https://render.com/docs/disks), and [compute plans](https://render.com/docs/compute-plans).

## Frontend configuration

After the API is deployed, add this environment variable to the existing **Static Site** and redeploy:

`VITE_LARGE_FILE_API_URL=https://YOUR-API-SERVICE.onrender.com`

The frontend sends files in chunks. The API currently supports single-input operations: video cutter, audio cutter, compressor, video/audio conversion, extract audio, video-to-GIF, thumbnail, speed, crop, and text watermark. Multi-file merge, slideshow, batch, and external subtitle-file jobs need a subsequent API extension.

## API

- `GET /health`
- `POST /api/uploads` JSON: `{ "filename": "clip.mkv" }`
- `PATCH /api/uploads/:id` raw body, `Upload-Offset: <current byte offset>`
- `POST /api/jobs/:id` JSON tool options
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/download`

## Important production hardening still required

This starter API is intended for a controlled personal deployment. Before opening it to the public, add authentication, per-user quotas, concurrent-job limits, automated retention/cleanup, durable job-state storage, and object storage for uploads/outputs. Uploaded media and generated files are sensitive; configure retention and access controls before public launch.
