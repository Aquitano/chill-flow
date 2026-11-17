import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { packRecording } from "../../src/recording";
import type { Recording } from "../../src/walkthrough";
import { variants, variantById } from "./motion";
import { typographyAudio } from "./sound";

const root = resolve(import.meta.dir, "../..");
const refined = variantById("ChillFilm");
await Bun.write(join(root, "public/audio/type.wav"), typographyAudio(refined.intro, refined.seconds));
for (const [source, target] of [
  ["assets/feature-walkthrough.json", "public/feature-walkthrough.json"],
  ["assets/Manrope-film.woff2", "public/fonts/Manrope-film.woff2"],
  ["assets/Terminal.woff2", "public/fonts/Terminal.woff2"],
  ["assets/music.mp3", "public/audio/music.mp3"],
  ["assets/rain.mp3", "public/audio/rain.mp3"],
]) await Bun.write(join(root, target), Bun.file(join(root, source)));
const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "preview.ts")], target: "browser", minify: true });
if (!bundle.success) throw new AggregateError(bundle.logs, "The preview did not build");
const script = (await bundle.outputs[0].text()).replaceAll("</script", "<\\/script");
const font = async (name: string) => `data:font/woff2;base64,${Buffer.from(await Bun.file(join(root, "assets", name)).arrayBuffer()).toString("base64")}`;
const recording = await Bun.file(join(root, "assets/feature-walkthrough.json")).json() as Recording;
const data = gzipSync(packRecording(recording), { level: 9 }).toString("base64");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>chill · Film edits</title>
<style>
:root{color-scheme:dark;--foreground:#eeeef0;--muted-foreground:#b7b7c7;--border:#414157;--primary:#f9e2af;--font-sans:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--foreground);font:14px/1.5 var(--font-sans)}main{max-width:1100px;margin:auto}nav{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}button{font:inherit;color:inherit;background:transparent;border:1px solid var(--border);border-radius:6px;padding:8px 12px;cursor:pointer}button[aria-pressed=true]{border-color:var(--primary)}button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:3px}canvas{display:block;width:100%;height:auto}section{display:flex;align-items:center;gap:12px;margin:12px 0}input{flex:1;min-width:0;accent-color:var(--primary)}output{font-variant-numeric:tabular-nums;white-space:nowrap}p,output{color:var(--muted-foreground)}small{display:block}#status{min-height:42px}#chapters button{font-size:12px}
</style><body><main><nav aria-label="Film variant">${variants.map(v => `<button data-variant="${v.id}">${v.name}<small>${v.seconds} seconds</small></button>`).join("")}</nav>
<canvas width="1920" height="1080" role="img" aria-label="chill app feature walkthrough"></canvas><section><button id="play" disabled>Loading</button><input id="scrub" type="range" min="0" max="809" value="0" aria-label="Video frame"><output>0 / 27s</output><button id="sound" aria-pressed="true">Sound on</button></section><p id="status">Loading the app capture.</p><nav id="chapters" aria-label="Features"><button data-source="1.8">Music</button><button data-source="5.5">YouTube link</button><button data-source="10.8">Rain</button><button data-source="14">Timer</button><button data-source="20">Full view</button></nav></main>
<audio id="music" src="assets/music.mp3" preload="metadata"></audio><audio id="rain" src="assets/rain.mp3" preload="metadata"></audio><audio id="effects" src="public/audio/type.wav" preload="auto"></audio>
<div hidden><span id="font" data-source="${await font("Manrope-film.woff2")}"></span><span id="terminal" data-source="${await font("Terminal.woff2")}"></span></div><script type="application/octet-stream" id="recording">${data}</script><script type="module">${script}</script></body></html>`;
await Bun.write(join(root, "timing-options.html"), html);
console.log(`Prepared ${variants.length} Remotion compositions and timing-options.html.`);
