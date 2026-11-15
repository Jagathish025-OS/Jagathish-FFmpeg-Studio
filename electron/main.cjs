const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');

let win;
let active = new Map();
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 980, minHeight: 680,
    backgroundColor: '#0b1020',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(() => {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw new Error('Bundled FFmpeg executable was not found.');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const clamp = (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback;
const timeSeconds = value => {
  const p = String(value || '00:00:00').split(':').map(Number);
  if (p.length !== 3 || p.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Time must use HH:MM:SS format.');
  return p[0] * 3600 + p[1] * 60 + p[2];
};
const time = value => {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  return [Math.floor(n/3600), Math.floor(n%3600/60), n%60].map(x=>String(x).padStart(2,'0')).join(':');
};
const outputExt = (tool, format) => tool === 'gif' ? 'gif' : tool === 'thumbnail' ? 'jpg' :
  tool === 'extract' || tool === 'audioCut' ? 'mp3' : tool === 'audio' ? (['mp3','wav','aac','ogg'].includes(format) ? format : 'mp3') :
  tool === 'subtitle' || tool === 'watermark' || tool === 'speed' || tool === 'crop' || tool === 'compress' || tool === 'cut' || tool === 'merge' || tool === 'slideshow' || tool === 'batch' ? 'mp4' : format;
function outputPath(input, tool, ext, index) {
  const dir = path.dirname(input), base = path.basename(input, path.extname(input));
  return path.join(dir, base + '-jagathish-' + tool + (index ? '-' + (index+1) : '') + '.' + ext);
}
function runFfmpeg(args, jobId, duration) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner','-y','-progress','pipe:1','-nostats',...args], { windowsHide: true });
    active.set(jobId, child);
    let stderr = '', last = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      last += chunk;
      const lines = last.split(/\r?\n/); last = lines.pop() || '';
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_ms' && duration > 0 && win && !win.isDestroyed()) {
          const seconds = Number(value) / 1000000;
          win.webContents.send('ffmpeg:progress', { jobId, progress: Math.min(99, Math.round(seconds / duration * 100)) });
        }
        if (key === 'progress' && value === 'end' && win && !win.isDestroyed()) win.webContents.send('ffmpeg:progress', { jobId, progress: 100 });
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-10000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || 'FFmpeg exited with code ' + code)));
  });
}
function baseArgs(tool, input, out, opts, extra) {
  const a = [];
  const start = timeSeconds(opts.start), end = timeSeconds(opts.end);
  const duration = Math.max(0.1, end - start);
  if (tool === 'cut' || tool === 'audioCut') {
    a.push('-ss', time(start), '-i', input, '-t', String(duration));
    if (tool === 'audioCut') a.push('-vn','-c:a','libmp3lame','-q:a','2');
    else a.push('-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac');
  } else if (tool === 'compress') {
    a.push('-i',input,'-c:v','libx264','-preset','veryfast','-crf',String(clamp(opts.quality,18,35,25)),'-c:a','aac');
  } else if (tool === 'convert' || tool === 'audio') {
    a.push('-i',input);
    if (['mp3','wav','aac','ogg'].includes(path.extname(out).slice(1))) a.push('-vn');
  } else if (tool === 'extract') a.push('-i',input,'-vn','-c:a','libmp3lame','-q:a','2');
  else if (tool === 'gif') a.push('-ss',time(start),'-i',input,'-t',String(duration),'-vf','fps=12,scale=480:-1:flags=lanczos');
  else if (tool === 'thumbnail') a.push('-ss',time(start),'-i',input,'-frames:v','1');
  else if (tool === 'speed') {
    const s = clamp(opts.speed,0.25,4,1.5); a.push('-i',input,'-vf','setpts='+(1/s).toFixed(3)+'*PTS','-af','atempo='+s,'-c:v','libx264','-c:a','aac');
  } else if (tool === 'crop') {
    const w = Math.round(clamp(opts.width,16,7680,1280)), h = Math.round(clamp(opts.height,16,4320,720));
    a.push('-i',input,'-vf',`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,'-c:a','copy');
  } else if (tool === 'watermark') {
    const text = String(opts.watermark || 'Jagathish.online').replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,80);
    a.push('-i',input,'-vf',`drawtext=text='${text}':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.5:x=20:y=h-th-20`,'-c:a','copy');
  } else if (tool === 'subtitle') {
    if (!extra) throw new Error('Choose an SRT subtitle file.');
    const escaped = extra.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
    a.push('-i',input,'-vf',`subtitles='${escaped}'`,'-c:v','libx264','-preset','veryfast','-c:a','copy');
  } else throw new Error('Unsupported tool: '+tool);
  a.push(out);
  return { args:a, duration: tool==='cut'||tool==='audioCut'||tool==='gif' ? duration : 0 };
}
ipcMain.handle('ffmpeg:run', async (event, request) => {
  const jobId = String(request.jobId || Date.now());
  const paths = Array.isArray(request.paths) ? request.paths : [];
  const tool = String(request.tool || '');
  const opts = request.options || {};
  if (!paths.length || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p))) throw new Error('One or more input files could not be found.');
  const allowed = ['compress','cut','convert','audio','gif','extract','merge','audioCut','subtitle','watermark','batch','thumbnail','speed','crop','slideshow'];
  if (!allowed.includes(tool)) throw new Error('Unknown media tool.');
  const outputs = [];
  const ext = outputExt(tool, opts.format || 'mp4');
  const notify = p => { if (win && !win.isDestroyed()) win.webContents.send('ffmpeg:progress',{jobId,progress:p}); };
  try {
    if (tool === 'merge') {
      if (paths.length < 2) throw new Error('Select at least two videos to merge.');
      const list = path.join(path.dirname(paths[0]), 'jagathish-merge-'+jobId+'.txt');
      fs.writeFileSync(list, paths.map(p => "file '"+p.replace(/'/g,"'\\''")+"'").join('\n'));
      const out = outputPath(paths[0],tool,'mp4');
      await runFfmpeg(['-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac',out],jobId,0);
      fs.unlinkSync(list); outputs.push({path:out,name:path.basename(out),size:fs.statSync(out).size});
    } else if (tool === 'slideshow') {
      if (paths.length < 2) throw new Error('Select at least two images for a slideshow.');
      const list = path.join(path.dirname(paths[0]),'jagathish-slideshow-'+jobId+'.txt');
      fs.writeFileSync(list,paths.map(p=>"file '"+p.replace(/'/g,"'\\''")+"'\nduration 2").join('\n')+"\nfile '"+paths[paths.length-1].replace(/'/g,"'\\''")+"'");
      const out = outputPath(paths[0],tool,'mp4');
      await runFfmpeg(['-f','concat','-safe','0','-i',list,'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p','-r','30','-c:v','libx264','-pix_fmt','yuv420p',out],jobId,paths.length*2);
      fs.unlinkSync(list); outputs.push({path:out,name:path.basename(out),size:fs.statSync(out).size});
    } else {
      for (let i=0;i<paths.length;i++) {
        if (tool !== 'batch' && i > 0) break;
        const actualTool = tool === 'batch' ? 'convert' : tool;
        const actualOpts = tool === 'batch' ? {...opts,format:opts.format || 'mp4'} : opts;
        const outputExtValue = outputExt(actualTool,actualOpts.format || 'mp4');
        const out = outputPath(paths[i],tool,outputExtValue,paths.length>1?i:0);
        const built = tool === 'batch' ? {args:['-i',paths[i],'-c:v','libx264','-crf',String(clamp(opts.quality,18,35,25)),'-preset','veryfast','-c:a','aac',out],duration:0} : baseArgs(actualTool,paths[i],out,actualOpts,request.extraPath);
        await runFfmpeg(built.args,jobId,built.duration);
        outputs.push({path:out,name:path.basename(out),size:fs.statSync(out).size});
        notify(Math.round((i+1)/paths.length*100));
      }
    }
    return {outputs};
  } finally { active.delete(jobId); }
});
ipcMain.handle('ffmpeg:cancel', (_event, jobId) => { const child=active.get(String(jobId)); if(child) child.kill('SIGTERM'); return Boolean(child); });
ipcMain.handle('ffmpeg:reveal', (_event, filePath) => { if (typeof filePath==='string' && path.isAbsolute(filePath) && fs.existsSync(filePath)) shell.showItemInFolder(filePath); });
ipcMain.handle('ffmpeg:open-dialog', async (_event, kind) => {
  const properties = kind === 'images' ? ['openFile','multiSelections'] : ['openFile','multiSelections'];
  const filters = kind === 'images' ? [{name:'Images',extensions:['png','jpg','jpeg','webp','bmp']}] : [{name:'Media files',extensions:['mp4','mkv','mov','webm','avi','mp3','wav','aac','ogg','flac','m4a']},{name:'All files',extensions:['*']}];
  const result = await dialog.showOpenDialog(win,{properties,filters});
  return result.canceled ? [] : result.filePaths;
});
