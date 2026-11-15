import {useEffect,useState} from 'react';
import {getEngine,fetchFile} from './ffmpeg';
const tools=[
['compress','Video compressor','Video','Reduce MP4 size'],['cut','Video cutter','Video','Trim a clip by time'],['convert','Video converter','Video','Convert video formats'],['audio','Audio converter','Audio','Convert audio formats'],['gif','Video to GIF','Video','Create an animated GIF'],['extract','Extract audio','Audio','Save soundtrack as MP3'],['merge','Video merger','Video','Join compatible clips'],['audioCut','Audio cutter','Audio','Trim an audio track'],['subtitle','Subtitle editor','Subtitles','Burn an SRT file into video'],['watermark','Watermark editor','Video','Overlay text on video'],['batch','Batch processing','Advanced','Convert multiple files'],['thumbnail','Thumbnail generator','Images','Extract a still frame'],['speed','Video speed changer','Video','Change playback speed'],['crop','Video cropper','Video','Crop to a chosen size'],['slideshow','Image slideshow','Images','Create a video from images']];
const exts=['mp4','webm','mov','mkv','mp3','wav','aac','ogg'];
// FFmpeg.wasm buffers input files in WebAssembly memory. Keep browser jobs bounded.
const MAX_TOTAL_INPUT_BYTES=256*1024*1024;
export default function App(){
 const [tool,setTool]=useState('compress'),[files,setFiles]=useState<File[]>([]),[extra,setExtra]=useState<File|null>(null),[start,setStart]=useState('00:00:00'),[end,setEnd]=useState('00:00:15'),[format,setFormat]=useState('mp4'),[quality,setQuality]=useState('25'),[speed,setSpeed]=useState('1.5'),[watermark,setWatermark]=useState('Jagathish.online'),[width,setWidth]=useState('1280'),[height,setHeight]=useState('720'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[logs,setLogs]=useState<string[]>([]),[error,setError]=useState(''),[outputs,setOutputs]=useState<{url:string,name:string,size:number}[]>([]);
 useEffect(()=>{
  if(!window.desktopFFmpeg)return;
  return window.desktopFFmpeg.onProgress(({progress})=>setProgress(progress));
 },[]);
 const selected=tools.find(t=>t[0]===tool)!;
 const multi=['merge','batch','slideshow'].includes(tool);
 const add=(list:FileList|null)=>{if(!list)return;setFiles(p=>multi?[...p,...Array.from(list)]:Array.from(list).slice(0,1));setOutputs([]);setError('')};
 const runLargeFile=async()=>{
  const api=(import.meta.env.VITE_LARGE_FILE_API_URL||'').replace(/\\/$/,'');
  if(!api)throw new Error('Large-file processing is not connected yet. The large-file API must be deployed and VITE_LARGE_FILE_API_URL configured in Render.');
  if(files.length!==1||multi)throw new Error('The large-file engine currently supports one input file per job. Multi-file merge, slideshow and batch will be added in a later upgrade.');
  const file=files[0];
  const init=await fetch(api+'/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name})});
  if(!init.ok)throw new Error('Could not start large-file upload: '+(await init.text()));
  const {uploadId,chunkBytes}=await init.json();
  for(let offset=0;offset<file.size;){
   const end=Math.min(file.size,offset+chunkBytes);
   const response=await fetch(api+'/api/uploads/'+uploadId,{method:'PATCH',headers:{'Content-Type':'application/octet-stream','Upload-Offset':String(offset)},body:file.slice(offset,end)});
   if(!response.ok)throw new Error('Upload failed at '+(offset/1048576).toFixed(0)+' MB: '+(await response.text()));
   offset=end;setProgress(Math.round(offset/file.size*40));
   logLarge('Uploaded '+(offset/1048576).toFixed(0)+' / '+(file.size/1048576).toFixed(0)+' MB');
  }
  const started=await fetch(api+'/api/jobs/'+uploadId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,start,end,format:tool==='audioCut'||tool==='extract'?'mp3':tool==='gif'?'gif':tool==='thumbnail'?'jpg':format,quality,speed,width,height,watermark})});
  if(!started.ok)throw new Error('Could not start FFmpeg job: '+(await started.text()));
  while(true){
   await new Promise(resolve=>setTimeout(resolve,1800));
   const statusResponse=await fetch(api+'/api/jobs/'+uploadId);
   if(!statusResponse.ok)throw new Error('Could not read processing status: '+(await statusResponse.text()));
   const status=await statusResponse.json();setProgress(40+Math.round((status.progress||0)*0.6));
   if(status.status==='failed')throw new Error(status.error||'Large-file processing failed.');
   if(status.status==='completed'){
    // Use a direct download URL so multi-gigabyte outputs stream to the browser
    // instead of being copied into a second in-memory Blob.
    setOutputs([{url:api+'/api/jobs/'+uploadId+'/download',name:'jagathish-'+tool+'.'+(tool==='gif'?'gif':tool==='thumbnail'?'jpg':format),size:status.outputSize||0}]);
    setProgress(100);return;
   }
  }
 };
 const logLarge=(message:string)=>setLogs(p=>[...p.slice(-5),message]);
 const run=async()=>{
  if(!files.length){setError('Choose a file first.');return}
  if(multi&&files.length<2){setError('Choose at least two files.');return}
  if(window.desktopFFmpeg){
   setBusy(true);setError('');setOutputs([]);setProgress(0);setLogs(['Starting local desktop FFmpeg…']);
   try{
    const paths=files.map(file=>window.desktopFFmpeg!.getPathForFile(file));
    if(paths.some(path=>!path))throw new Error('Could not access the selected file path. Please choose the file again.');
    const extraPath=extra?window.desktopFFmpeg.getPathForFile(extra):undefined;
    const result=await window.desktopFFmpeg.runJob({jobId:String(Date.now()),paths,extraPath,tool,options:{start,end,format,quality,speed,width,height,watermark}});
    setOutputs(result.outputs.map((o:{path:string,name:string,size:number})=>({url:'',path:o.path,name:o.name,size:o.size})));
    setProgress(100);setLogs(['Finished. Output saved beside the original media file.']);
   }catch(e){setError(e instanceof Error?e.message:String(e))}
   finally{setBusy(false)}
   return;
  }
  const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
  if(totalBytes>MAX_TOTAL_INPUT_BYTES){
   setBusy(true);setError('');setOutputs([]);setProgress(0);setLogs([]);
   try{await runLargeFile()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
   return;
  }
  setBusy(true);setError('');setOutputs([]);setProgress(0);setLogs([]);
  const log=(s:string)=>setLogs(p=>[...p.slice(-5),s]);
  try{
   const ff=await getEngine(log,setProgress); const made:{url:string,name:string,size:number}[]=[];
   const safe=(s:string)=>s.replace(/[^a-z0-9._-]/gi,'_');
   if(tool==='merge'||tool==='slideshow'){
    const names:string[]=[];
    for(let i=0;i<files.length;i++){const n='input_'+i+'.'+(tool==='slideshow'?'jpg':(files[i].name.split('.').pop()||'mp4'));names.push(n);log('Reading '+files[i].name+' ('+(files[i].size/1048576).toFixed(1)+' MB)…');await ff.writeFile(n,await fetchFile(files[i]));}
    const list=tool==='merge'?'join.txt':'slides.txt';
    const body=tool==='merge'?names.map(n=>"file '"+n+"'").join('\n'):names.map(n=>"file '"+n+"'\nduration 2").join('\n')+"\nfile '"+names[names.length-1]+"'";
    await ff.writeFile(list,new TextEncoder().encode(body));
    const out=tool==='merge'?'merged.mp4':'slideshow.mp4';
    const args=tool==='merge'?['-f','concat','-safe','0','-i',list,'-c','copy',out]:['-f','concat','-safe','0','-i',list,'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p','-r','30',out];
    await ff.exec(['-y',...args]);const data=await ff.readFile(out);const blob=new Blob([data as Uint8Array],{type:'video/mp4'});made.push({url:URL.createObjectURL(blob),name:out,size:blob.size});
    for(const n of [...names,list,out])await ff.deleteFile(n).catch(()=>{});
   }else{
    for(let i=0;i<files.length;i++){
     const f=files[i],input='input_'+i+'.'+(f.name.split('.').pop()||'dat');log('Reading '+f.name+' ('+(f.size/1048576).toFixed(1)+' MB) into browser memory…');await ff.writeFile(input,await fetchFile(f));
     let ext=tool==='gif'?'gif':tool==='thumbnail'?'jpg':tool==='extract'?'mp3':tool==='audio'||tool==='audioCut'?'mp3':tool==='subtitle'||tool==='watermark'||tool==='speed'||tool==='crop'||tool==='compress'||tool==='cut'?'mp4':format;
     const out='output_'+i+'.'+ext;let args:string[]=['-y'];
     if(tool==='compress')args.push('-i',input,'-c:v','libx264','-crf',quality,'-preset','ultrafast','-c:a','aac');
     else if(tool==='cut'||tool==='audioCut')args.push('-ss',start,'-to',end,'-i',input,'-c','copy');
     else if(tool==='convert'||tool==='audio')args.push('-i',input,...(['mp3','wav','aac','ogg'].includes(ext)?['-vn']:[]));
     else if(tool==='extract')args.push('-i',input,'-vn','-c:a','libmp3lame','-q:a','2');
     else if(tool==='gif')args.push('-ss',start,'-to',end,'-i',input,'-vf','fps=12,scale=480:-1:flags=lanczos');
     else if(tool==='thumbnail')args.push('-ss',start,'-i',input,'-frames:v','1');
     else if(tool==='speed'){const v=Math.max(.25,Math.min(4,Number(speed)||1));args.push('-i',input,'-vf',`setpts=${(1/v).toFixed(3)}*PTS`,'-af',`atempo=${v}`,'-c:v','libx264','-c:a','aac')}
     else if(tool==='crop')args.push('-i',input,'-vf',`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,'-c:a','copy');
     else if(tool==='watermark')args.push('-i',input,'-vf',`drawtext=text='${watermark.replace(/['\\:]/g,'')}':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.5:x=20:y=h-th-20`,'-c:a','copy');
     else if(tool==='subtitle'){if(!extra)throw new Error('Select an SRT subtitle file.');await ff.writeFile('captions.srt',await fetchFile(extra));args.push('-i',input,'-vf',"subtitles=captions.srt",'-c:a','copy')}
     else if(tool==='batch')args.push('-i',input,'-c:v','libx264','-crf',quality,'-preset','ultrafast','-c:a','aac');
     await ff.exec([...args,out]);const data=await ff.readFile(out);const mime=ext==='mp3'?'audio/mpeg':ext==='gif'?'image/gif':ext==='jpg'?'image/jpeg':ext==='wav'?'audio/wav':'video/mp4';const blob=new Blob([data as Uint8Array],{type:mime});made.push({url:URL.createObjectURL(blob),name:multi?safe(f.name.replace(/\.[^.]+$/,''))+'_converted.'+ext:'jagathish-'+tool+'.'+ext,size:blob.size});
     await ff.deleteFile(input).catch(()=>{});await ff.deleteFile(out).catch(()=>{});
    }
   }
   setOutputs(made);log('Processing complete.');
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 return <div className="shell"><header><a className="brand" href="#">✦ <span>Jagathish <b>FFmpeg Studio</b></span></a><span className="private">● LOCAL BROWSER PROCESSING</span></header><main><section className="hero"><p className="eyebrow">PRIVATE MEDIA WORKSPACE</p><h1>Your media.<br/><em>Your tools.</em></h1><p>Convert, compress and edit video and audio directly in your browser. Your media files stay on your device.</p><div className="chips"><span>✓ No account</span><span>✓ No media upload</span><span>✓ FFmpeg powered</span></div></section><section className="toolbox"><div className="section-title"><div><small>YOUR TOOLKIT</small><h2>Choose a tool</h2></div><span>15 tools</span></div><div className="tool-grid">{tools.map(t=><button key={t[0]} className={tool===t[0]?'active':''} onClick={()=>{setTool(t[0]);setFiles([]);setOutputs([]);setError('')}}><span className="tool-symbol">{t[2]==='Audio'?'♫':t[2]==='Images'?'▧':t[2]==='Subtitles'?'▤':'▶'}</span><b>{t[1]}</b><small>{t[3]}</small></button>)}</div></section><section className="workspace"><div className="section-title"><div><small>EDITOR WORKSPACE</small><h2>{selected[1]}</h2></div><span className="local">● Runs locally</span></div><label className="drop"><input type="file" multiple={multi} accept={tool==='slideshow'?'image/*':tool==='audio'||tool==='audioCut'||tool==='extract'?'audio/*,video/*':'video/*,audio/*'} onChange={e=>add(e.target.files)}/><strong>＋ Drop files here or click to browse</strong><small>{multi?'Select multiple files':'Select one media file'} · Files remain in this browser</small></label>{files.length>0&&<div className="filelist">{files.map((f,i)=><div key={i}>📄 {f.name} <small>{(f.size/1048576).toFixed(2)} MB</small></div>)}</div>}<div className="settings"><label>Output format<select value={format} onChange={e=>setFormat(e.target.value)}>{exts.map(x=><option key={x}>{x}</option>)}</select></label>{['cut','audioCut','gif','thumbnail'].includes(tool)&&<><label>Start time<input value={start} onChange={e=>setStart(e.target.value)}/></label><label>End time<input value={end} onChange={e=>setEnd(e.target.value)}/></label></>}{['compress','batch'].includes(tool)&&<label>Quality (CRF 18–35)<input type="number" min="18" max="35" value={quality} onChange={e=>setQuality(e.target.value)}/></label>}{tool==='speed'&&<label>Speed (0.25×–4×)<input value={speed} onChange={e=>setSpeed(e.target.value)}/></label>}{tool==='crop'&&<><label>Width<input value={width} onChange={e=>setWidth(e.target.value)}/></label><label>Height<input value={height} onChange={e=>setHeight(e.target.value)}/></label></>}{tool==='watermark'&&<label>Watermark text<input value={watermark} onChange={e=>setWatermark(e.target.value)}/></label>}{tool==='subtitle'&&<label>Subtitle file (.srt)<input type="file" accept=".srt" onChange={e=>setExtra(e.target.files?.[0]||null)}/></label>}</div><button className="run" disabled={busy||!files.length} onClick={run}>{busy?'Processing…':'▶ Start processing'}</button>{busy&&<div className="progress"><div style={{width:progress+'%'}}/></div>}{error&&<p className="error">{error}</p>}{outputs.map((o,i)=><div className="output" key={i}><span>✓ {o.name} · {(o.size/1048576).toFixed(2)} MB</span>{o.path?<button onClick={()=>window.desktopFFmpeg?.revealFile(o.path!)}>Show in folder ↗</button>:<a href={o.url} download={o.name}>Download ↓</a>}</div>)}{logs.length>0&&<pre className="logs">{logs.join('\n')}</pre>}</section></main><footer>Jagathish.online · Built with React, TypeScript and FFmpeg.wasm</footer></div>;
}