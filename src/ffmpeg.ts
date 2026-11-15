import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
let engine: FFmpeg | null = null; let loading: Promise<FFmpeg> | null = null;
export async function getEngine(log?: (s:string)=>void, progress?: (n:number)=>void) {
 if(engine?.loaded) return engine; if(loading) return loading;
 loading=(async()=>{const ff=new FFmpeg(); ff.on('log',({message})=>log?.(message)); ff.on('progress',({progress:p})=>progress?.(Math.round(Math.max(0,Math.min(1,p))*100)));
 const base='https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'; await ff.load({coreURL:await toBlobURL(base+'/ffmpeg-core.js','text/javascript'),wasmURL:await toBlobURL(base+'/ffmpeg-core.wasm','application/wasm')}); engine=ff; return ff;})();
 try{return await loading;}finally{loading=null;}
}
export { fetchFile };