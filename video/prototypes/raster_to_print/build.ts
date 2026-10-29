import {fontFaces, meta} from "./motion";
const result = await Bun.build({entrypoints: ["motion.ts"], target: "browser", format: "esm", minify: false});
if (!result.success) throw new Error("Drawing compilation failed");
const drawing = await result.outputs[0].text();
const previewFonts = await Promise.all(fontFaces.map(async (font) => ({
  ...font, file: `data:font/ttf;base64,${Buffer.from(await Bun.file(font.file).arrayBuffer()).toString("base64")}`,
})));
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raster to print</title>
<style>body{margin:0;background:#e9eaec;color:#111;font:14px system-ui}main{max-width:1200px;margin:24px auto;padding:0 18px}canvas{display:block;width:100%;height:auto;background:#f7f8f9}nav{display:flex;gap:14px;align-items:center;padding:16px 0}input{flex:1}button{font:inherit;padding:5px 14px}output{font-variant-numeric:tabular-nums}</style>
<main><canvas width="1920" height="1080" aria-label="chill film prototype"></canvas><nav><button id="play">Play</button><input aria-label="Film position" id="seek" type="range" min="0" max="329" value="0"><output id="time">0.00 / 11.00</output></nav></main>
<script type="module">
${drawing}
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
const seek=document.querySelector('#seek'),play=document.querySelector('#play'),time=document.querySelector('#time');
const load=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src});
const [ui,landscape]=await Promise.all([load('assets/ui.png'),load('assets/landscape.png'),...${JSON.stringify(previewFonts)}.map(async f=>{const font=new FontFace(f.family,'url("'+f.file+'")',{weight:'200 800'});document.fonts.add(await font.load())})]);
const assets={ui,landscape};let frame=0,playing=false,start=0;
function paint(){drawFrame(ctx,frame,assets);seek.value=frame;time.value=(frame/30).toFixed(2)+' / 11.00'}
function tick(now){if(playing){frame=Math.min(329,Math.floor((now-start)*30/1000));paint();if(frame===329){playing=false;play.textContent='Play'}}requestAnimationFrame(tick)}
play.onclick=()=>{playing=!playing;if(playing){if(frame===329)frame=0;start=performance.now()-frame/30*1000}play.textContent=playing?'Pause':'Play'};
seek.oninput=()=>{frame=Number(seek.value);start=performance.now()-frame/30*1000;paint()};paint();requestAnimationFrame(tick);
</script></html>`;
await Bun.write("preview.html", html);
console.log(`Built inline review player: ${meta.seconds}s, ${meta.fps}fps`);
