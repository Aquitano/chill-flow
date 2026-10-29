import {mkdir, copyFile} from "node:fs/promises";
import {fontFaces} from "./motion";

await mkdir("public/assets", {recursive: true});
for (const file of ["assets/ui.png", "assets/landscape.png", ...fontFaces.map(font => font.file)]) {
  await copyFile(file, `public/${file}`);
}
const build = await Bun.build({entrypoints: ["motion.ts"], target: "browser", format: "esm"});
if (!build.success) throw new Error(build.logs.join("\n"));
const drawing = await build.outputs[0].text();
await Bun.write("preview.html", `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>chill · Quiet type</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#15151f;color:#cdd6f4;font:14px system-ui,sans-serif;min-height:100vh;display:grid;align-content:center;padding:24px}main{width:min(100%,1440px);margin:auto}canvas{display:block;width:100%;aspect-ratio:16/9;background:#1e1e2e}footer{display:flex;align-items:center;gap:16px;margin-top:16px}button{background:transparent;color:inherit;border:1px solid #6c7086;border-radius:3px;padding:8px 14px;font:inherit;min-width:80px}input{flex:1;accent-color:#cdd6f4}output{font-variant-numeric:tabular-nums;min-width:80px}button:focus-visible,input:focus-visible{outline:2px solid #94e2d5;outline-offset:4px}
</style></head><body><main><canvas width="1920" height="1080" aria-label="Quiet type film"></canvas><footer><button type="button">Play</button><input aria-label="Film position" type="range" min="0" max="329" step="1" value="0"><output>0.0 / 11s</output></footer></main>
<script type="module">
${drawing}
const canvas=document.querySelector('canvas');
const ctx=canvas.getContext('2d');
const button=document.querySelector('button');
const scrub=document.querySelector('input');
const output=document.querySelector('output');
const loadImage=file=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=file;});
const [ui,landscape]=await Promise.all([loadImage('assets/ui.png'),loadImage('assets/landscape.png'),...fontFaces.map(async font=>{const face=await new FontFace(font.family,'url('+font.file+')',{weight:font.family==='Geist'?'500':'400'}).load();document.fonts.add(face);})]);
const assets={ui,landscape};let frame=0;let playing=false;let start=0;
function paint(){drawFrame(ctx,frame,assets);scrub.value=String(frame);output.textContent=(frame/30).toFixed(1)+' / 11s';}
button.onclick=()=>{if(frame>=329)frame=0;playing=!playing;start=performance.now()-frame/30*1000;button.textContent=playing?'Pause':'Play';paint();};
scrub.oninput=()=>{frame=Number(scrub.value);start=performance.now()-frame/30*1000;paint();};
function tick(now){if(playing){frame=Math.min(329,Math.floor((now-start)*30/1000));paint();if(frame===329){playing=false;button.textContent='Play';}}requestAnimationFrame(tick);}
paint();requestAnimationFrame(tick);
</script></body></html>`);
