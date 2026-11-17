import {drawFrame, fontFaces, meta, type PrototypeAssets} from "./motion";
const canvas = document.querySelector("canvas")!;
const context = canvas.getContext("2d")!;
const play = document.querySelector("button")!;
const scrub = document.querySelector<HTMLInputElement>("input")!;
const output = document.querySelector("output")!;
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;});
const [ui, landscape] = await Promise.all([loadImage("assets/ui.png"), loadImage("assets/landscape.png"), ...fontFaces.map(async face => {const font = await new FontFace(face.family, `url(${face.file})`).load(); document.fonts.add(font);})]);
const assets: PrototypeAssets = {ui, landscape};
let frame = 0;
let playing = false;
let start = 0;
function paint() {drawFrame(context, frame, assets); scrub.value = String(frame); output.value = `${(frame / 30).toFixed(1)} / ${meta.seconds}s`;}
play.onclick = () => {if (frame >= 329) frame = 0; playing = !playing; start = performance.now() - frame / 30 * 1000; play.textContent = playing ? "Pause" : "Play";};
scrub.oninput = () => {frame = Number(scrub.value); start = performance.now() - frame / 30 * 1000; paint();};
function tick(now: number) {if (playing) {frame = Math.min(329, Math.floor((now - start) / 1000 * 30)); if (frame === 329) {playing = false; play.textContent = "Play";} paint();} requestAnimationFrame(tick);}
paint(); requestAnimationFrame(tick);
