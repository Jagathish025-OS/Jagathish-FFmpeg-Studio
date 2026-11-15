import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const DATA_DIR = process.env.DATA_DIR || '/var/data/ffmpeg-jobs';
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 10 * 1024 * 1024 * 1024);
const CHUNK_BYTES = 16 * 1024 * 1024;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
const jobs = new Map();

app.use(cors({
  origin(origin, callback) {
    if (!origin || !FRONTEND_ORIGIN || origin === FRONTEND_ORIGIN) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Upload-Offset'],
  exposedHeaders: ['Upload-Offset']
}));
app.use(express.json({ limit: '32kb' }));

const safeId = value => /^[0-9a-f-]{36}$/i.test(value || '');
const jobDir = id => path.join(DATA_DIR, id);
const inputPath = id => path.join(jobDir(id), 'input.media');

app.get('/health', (_req, res) => res.json({ ok: true, engine: 'ffmpeg', mode: 'disk-backed-chunk-upload' }));

app.post('/api/uploads', async (req, res) => {
  const id = randomUUID();
  await fs.mkdir(jobDir(id), { recursive: true });
  await fs.writeFile(path.join(jobDir(id), 'upload.json'), JSON.stringify({
    createdAt: Date.now(), filename: String(req.body?.filename || 'media-file').slice(0, 180)
  }));
  res.status(201).json({ uploadId: id, chunkBytes: CHUNK_BYTES, maxBytes: MAX_FILE_BYTES });
});

app.patch('/api/uploads/:id', express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES }), async (req, res) => {
  const { id } = req.params;
  if (!safeId(id)) return res.status(400).json({ error: 'Invalid upload ID' });
  const dir = jobDir(id);
  try {
    const info = JSON.parse(await fs.readFile(path.join(dir, 'upload.json'), 'utf8'));
    const current = await fs.stat(inputPath(id)).catch(() => ({ size: 0 }));
    const offset = Number(req.header('Upload-Offset'));
    if (!Number.isSafeInteger(offset) || offset !== current.size) {
      return res.status(409).json({ error: 'Upload offset mismatch', expectedOffset: current.size });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Empty upload chunk' });
    if (current.size + req.body.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'File exceeds configured upload limit' });
    await fs.appendFile(inputPath(id), req.body);
    const nextOffset = current.size + req.body.length;
    res.set('Upload-Offset', String(nextOffset)).json({ uploadId: id, offset: nextOffset });
  } catch {
    return res.status(404).json({ error: 'Upload session not found' });
  }
});

function buildArgs(tool, input, output, options) {
  const start = String(options.start || '00:00:00');
  const end = String(options.end || '00:00:15');
  const allowedFormats = new Set(['mp4', 'mkv', 'mov', 'webm', 'mp3', 'wav', 'aac', 'ogg', 'gif', 'jpg']);
  const format = allowedFormats.has(options.format) ? options.format : 'mp4';
  const args = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats'];
  const addInput = () => args.push('-i', input);
  if (tool === 'cut' || tool === 'audioCut') {
    args.push('-ss', start); addInput();
    const duration = Math.max(0.1, timeSeconds(end) - timeSeconds(start));
    args.push('-t', String(duration), '-c', 'copy');
  } else if (tool === 'compress') {
    addInput(); args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(clamp(options.quality, 18, 35, 25)), '-c:a', 'aac');
  } else if (tool === 'convert' || tool === 'audio') {
    addInput();
    if (['mp3', 'wav', 'aac', 'ogg'].includes(format)) args.push('-vn');
  } else if (tool === 'extract') {
    addInput(); args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
  } else if (tool === 'gif') {
    args.push('-ss', start); addInput(); args.push('-t', String(Math.max(0.1, timeSeconds(end) - timeSeconds(start))), '-vf', 'fps=12,scale=480:-1:flags=lanczos');
  } else if (tool === 'thumbnail') {
    args.push('-ss', start); addInput(); args.push('-frames:v', '1');
  } else if (tool === 'speed') {
    const speed = clamp(options.speed, 0.25, 4, 1.5);
    addInput(); args.push('-vf', `setpts=${(1 / speed).toFixed(3)}*PTS`, '-af', `atempo=${speed}`, '-c:v', 'libx264', '-c:a', 'aac');
  } else if (tool === 'crop') {
    const width = Math.round(clamp(options.width, 16, 7680, 1280));
    const height = Math.round(clamp(options.height, 16, 4320, 720));
    addInput(); args.push('-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`, '-c:a', 'copy');
  } else if (tool === 'watermark') {
    const text = String(options.watermark || 'Jagathish.online').replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 80);
    addInput(); args.push('-vf', `drawtext=text='${text}':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.5:x=20:y=h-th-20`, '-c:a', 'copy');
  } else {
    throw new Error('This tool is not yet available in the large-file engine. Use the browser engine or wait for the next server-tool rollout.');
  }
  args.push(output);
  return args;
}
function timeSeconds(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Time must use HH:MM:SS format');
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

app.post('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;
  if (!safeId(id)) return res.status(400).json({ error: 'Invalid upload ID' });
  if (jobs.has(id)) return res.status(409).json({ error: 'A job already exists for this upload' });
  try {
    const stat = await fs.stat(inputPath(id));
    if (!stat.size) return res.status(400).json({ error: 'Upload is empty' });
    const meta = JSON.parse(await fs.readFile(path.join(jobDir(id), 'upload.json'), 'utf8'));
    const tool = String(req.body?.tool || '');
    const format = String(req.body?.format || (tool === 'gif' ? 'gif' : tool === 'thumbnail' ? 'jpg' : 'mp4'));
    const output = path.join(jobDir(id), `output.${format}`);
    const args = buildArgs(tool, inputPath(id), output, { ...req.body, format });
    const job = { id, status: 'processing', progress: 0, error: '', output, filename: `jagathish-${tool}.${format}`, size: stat.size, sourceName: meta.filename };
    jobs.set(id, job);
    res.status(202).json({ id, status: job.status });
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      for (const line of chunk.split(/\r?\n/)) {
        const [key, value] = line.split('=');
        if (key === 'out_time_ms') {
          const elapsed = Number(value) / 1000000;
          const duration = Math.max(1, timeSeconds(req.body?.end || '00:00:15') - timeSeconds(req.body?.start || '00:00:00'));
          job.progress = Math.min(99, Math.round(elapsed / duration * 100));
        }
        if (key === 'progress' && value === 'end') job.progress = 100;
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', error => { job.status = 'failed'; job.error = error.message; });
    child.on('close', async code => {
      if (code === 0) {
        const outStat = await fs.stat(output).catch(() => null);
        if (outStat?.size) { job.status = 'completed'; job.progress = 100; job.outputSize = outStat.size; }
        else { job.status = 'failed'; job.error = 'FFmpeg produced no output'; }
      } else { job.status = 'failed'; job.error = stderr || `FFmpeg exited with code ${code}`; }
    });
  } catch (error) {
    jobs.delete(id);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Could not start processing' });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found (the worker may have restarted)' });
  res.json({ id: job.id, status: job.status, progress: job.progress, error: job.error || undefined, outputSize: job.outputSize });
});

app.get('/api/jobs/:id/download', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed') return res.status(404).json({ error: 'Output is not ready' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  const stream = (await import('node:fs')).createReadStream(job.output);
  stream.on('error', () => { if (!res.headersSent) res.sendStatus(500); });
  stream.pipe(res);
});

await fs.mkdir(DATA_DIR, { recursive: true });
app.listen(PORT, '0.0.0.0', () => console.log(`Large-file FFmpeg API listening on ${PORT}`));
