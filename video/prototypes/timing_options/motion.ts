import { updateTerminal, type WalkthroughAssets } from "../../src/walkthrough";
import { drawWord } from "../raster_to_print/motion";
import { drawEndCard, endCardStart, retime } from "./refined";

export const variants = [
  { id: "ChillFilm", name: "Refined cut", seconds: 22, intro: .8, rate: 1, opening: "raster", description: "Shorter pauses between actions, with a separate animated end card." },
  { id: "QuickRaster", name: "Quick raster", seconds: 27, intro: 1.25, rate: 1, opening: "raster", description: "The selected letter animation in 1.25 seconds, then five clear feature beats." },
  { id: "AppFirst", name: "App first", seconds: 24, intro: 0, rate: 1.08, opening: "app", description: "Starts in the product. Music is playing before two seconds." },
  { id: "TerminalLaunch", name: "Terminal launch", seconds: 30, intro: 1.55, rate: .94, opening: "command", description: "A short command prompt opening, with longer holds for the link and timer." },
] as const;
export type VariantId = typeof variants[number]["id"];
export type Variant = typeof variants[number];
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * t * (t * (t * 6 - 15) + 10); };
const background = "#1e1e2e";

export function variantById(id: VariantId) { return variants.find(variant => variant.id === id)!; }
export function filmTime(variant: Variant, sourceSecond: number) {
  return variant.intro + (variant.id === "ChillFilm" ? retime(sourceSecond, "film") : sourceSecond / variant.rate);
}
export function musicLevel(frame: number, variant: Variant) {
  const t = frame / 30;
  return .46 * smooth((t - filmTime(variant, 1.8)) / .25) * smooth((Math.min(variant.seconds, filmTime(variant, 1.8) + 26) - t) / 1.2);
}
export function rainLevel(frame: number, variant: Variant) {
  const t = frame / 30;
  const gain = [9.2, 9.6, 10, 10.4, 10.8].reduce((sum, source) => sum + smooth((t - filmTime(variant, source)) / .08), 0) / 5;
  const end = variant.id === "ChillFilm" ? endCardStart + .65 : variant.seconds;
  return .24 * gain * smooth((end - t) / 1.2);
}

type Camera = { time: number; zoom: number; x: number; y: number };
const cameras: readonly Camera[] = [
  { time: 0, zoom: 1, x: 960, y: 540 },
  { time: 1.1, zoom: 1.1, x: 875, y: 550 },
  { time: 3, zoom: 1.1, x: 875, y: 550 },
  { time: 4.1, zoom: 1.1, x: 960, y: 540 },
  { time: 6.9, zoom: 1.1, x: 960, y: 540 },
  { time: 8.7, zoom: 1.2, x: 1110, y: 535 },
  { time: 11.5, zoom: 1.2, x: 1110, y: 535 },
  { time: 13.1, zoom: 1.25, x: 1110, y: 430 },
  { time: 15.3, zoom: 1.25, x: 1110, y: 430 },
  { time: 17.7, zoom: 1, x: 960, y: 540 },
  { time: 19.4, zoom: 1, x: 960, y: 540 },
  { time: 24, zoom: 1.035, x: 960, y: 525 },
];
function cameraAt(time: number) {
  const index = cameras.findIndex(camera => camera.time > time);
  if (index <= 0) return index === 0 ? cameras[0] : cameras[cameras.length - 1];
  const from = cameras[index - 1], to = cameras[index];
  const p = smooth((time - from.time) / (to.time - from.time));
  return { time, zoom: from.zoom + (to.zoom - from.zoom) * p, x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
}
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, alpha: number, weight = 550) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px "Manrope"`;
  ctx.textAlign = "center"; ctx.fillStyle = "#f5f5f4";
  ctx.shadowColor = "rgba(10,12,24,.8)"; ctx.shadowBlur = 15; ctx.shadowOffsetY = 2;
  ctx.fillText(text, x, y); ctx.restore();
}
function cue(ctx: CanvasRenderingContext2D, text: string, source: number, start: number, end: number, x: number, y: number, size = 44) {
  label(ctx, text, x, y, size, smooth((source - start) / .22) * smooth((end - source) / .22));
}

export function drawPrototype(ctx: CanvasRenderingContext2D, frame: number, assets: WalkthroughAssets, variant: Variant) {
  const t = frame / 30;
  ctx.save(); ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
  ctx.globalAlpha = 1;
  if (t < variant.intro && variant.opening === "raster") {
    ctx.fillStyle = "#f7f8f9"; ctx.fillRect(0, 0, 1920, 1080);
    drawWord(ctx, t / variant.intro * 3.8);
    ctx.restore(); return;
  }
  if (t < variant.intro && variant.opening === "command") {
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1920, 1080);
    const typed = "chill".slice(0, Math.min(5, Math.floor(Math.max(0, t - .15) / .1)));
    ctx.font = '100px "Terminal"'; ctx.fillStyle = "#cdd6f4";
    ctx.fillText(`$ ${typed}`, 650, 555);
    if (t < 1.15) {
      ctx.fillStyle = "#f9e2af";
      ctx.fillRect(650 + ctx.measureText(`$ ${typed}`).width + 8, 476, 50, 96);
    }
    label(ctx, "Music in your terminal.", 960, 670, 31, smooth((t - .7) / .2));
    ctx.restore(); return;
  }
  const source = variant.id === "ChillFilm" ? retime(t - variant.intro, "source") : Math.max(0, (t - variant.intro) * variant.rate);
  updateTerminal(assets, Math.min(assets.recording.frames.length - 1, Math.floor(source * assets.recording.fps)));
  const camera = cameraAt(source);
  const drawApp = () => {
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1920, 1080);
    ctx.save(); ctx.translate(960, 540); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(assets.terminal, 53, 36, 1814, 1008); ctx.restore();
  };
  if (variant.id === "ChillFilm" && t >= endCardStart) {
    drawEndCard(ctx, t - endCardStart, drawApp);
    ctx.restore(); return;
  }
  drawApp();
  const x = 960 + (970 - camera.x) * camera.zoom;
  const y = 540 + (760 - camera.y) * camera.zoom;
  cue(ctx, "Play lo-fi from the catalog.", source, .15, 3.5, x, y, 42);
  cue(ctx, "Or paste a YouTube link.", source, 4.1, 6.8, 960, 870, 46);
  cue(ctx, "Mix rain with the music.", source, 8.4, 11.5, x, y, 44);
  cue(ctx, "Start a 25-minute timer.", source, 12.6, 15.4, x, Math.min(y, 930), 43);
  cue(ctx, "Hide the panels. Keep listening.", source, 18, 21.3, 960, 825, 44);
  const last = variant.id === "ChillFilm" ? 0 : smooth((t - (variant.seconds - 2.8)) / .35);
  label(ctx, "chill", 960, 740, 82, last, 700);
  label(ctx, "Lo-fi, ambience, and a focus timer.", 960, 805, 30, last);
  label(ctx, "github.com/Aquitano/chill-flow", 960, 920, 24, last);
  ctx.restore();
}
