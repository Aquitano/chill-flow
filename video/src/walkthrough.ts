import { drawWord as rasterWord } from "../prototypes/raster_to_print/motion";

export const FILM = { width: 1920, height: 1080, fps: 30, seconds: 30 } as const;
export const APP_START = 3.6;
export const MUSIC_START = APP_START + 33 / 15;
export const RAIN_START = APP_START + 86 / 15;
export const chapters = [
  { second: 0, name: "Raster opening" },
  { second: 3.6, name: "Find music" },
  { second: 8.1, name: "Mix rain" },
  { second: 13, name: "Start focus" },
  { second: 16.8, name: "Your space" },
  { second: 22.4, name: "Settle in" },
] as const;

type Cell = [index: number, symbol: string, style: number];
export type Recording = {
  columns: number; rows: number; fps: number;
  styles: [foreground: string, background: string, flags: number][];
  frames: Cell[][];
  inputs: [tick: number, key: string][];
  octants: string[];
};
export type WalkthroughAssets = {
  recording: Recording;
  terminal: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  tick: number;
  octants: ReadonlyMap<string, number>;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p); };
const terminalColor = "#1e1e2e";

export function musicLevel(frame: number) {
  const t = frame / FILM.fps;
  return .46 * smooth((t - MUSIC_START) / .45) * smooth((30 - t) / 1.4);
}
export function rainLevel(frame: number) {
  const t = frame / FILM.fps;
  const tick = (t - APP_START) * 15;
  const gain = [86, 92, 98, 104, 110].reduce((level, at) => level + smooth((tick - at) / 1.2), 0) / 5;
  return .24 * gain * smooth((30 - t) / 1.4);
}

export function updateTerminal(assets: WalkthroughAssets, tick: number) {
  const { context: ctx, recording, terminal } = assets;
  if (tick < assets.tick) {
    ctx.fillStyle = terminalColor;
    ctx.fillRect(0, 0, terminal.width, terminal.height);
    assets.tick = -1;
  }
  for (let f = assets.tick + 1; f <= tick; f++) {
    for (const [index, symbol, style] of recording.frames[f]) {
      const x = index % recording.columns * 18;
      const y = Math.floor(index / recording.columns) * 36;
      const [fg, bg, flags] = recording.styles[style];
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, 18, 36);
      if (symbol === " ") continue;
      ctx.globalAlpha = flags & 4 ? .5 : 1;
      ctx.fillStyle = fg;
      const octant = assets.octants.get(symbol);
      if (octant !== undefined) {
        for (let bit = 0; bit < 8; bit++) {
          if (!(octant & (1 << bit))) continue;
          const left = Math.round(bit % 2 * 9);
          const top = Math.round(Math.floor(bit / 2) * 9);
          const right = Math.round((bit % 2 + 1) * 9);
          const bottom = Math.round((Math.floor(bit / 2) + 1) * 9);
          ctx.fillRect(x + left, y + top, right - left, bottom - top);
        }
      }
      else {
        ctx.font = `${flags & 2 ? "italic " : ""}${flags & 1 ? "bold " : ""}28px "Terminal"`;
        ctx.fillText(symbol, x, y + 28, 18);
        if (flags & 8) ctx.fillRect(x, y + 32, 18, 2);
      }
    }
  }
  assets.tick = tick;
}

type Camera = { second: number; zoom: number; x: number; y: number };
const cameraStops: readonly Camera[] = [
  { second: 3.6, zoom: 1, x: 960, y: 540 },
  { second: 4.1, zoom: 1, x: 960, y: 540 },
  { second: 5.7, zoom: 1.13, x: 855, y: 566 },
  { second: 7.1, zoom: 1.13, x: 855, y: 566 },
  { second: 9.2, zoom: 1.24, x: 1115, y: 555 },
  { second: 11.5, zoom: 1.24, x: 1115, y: 555 },
  { second: 13.7, zoom: 1.28, x: 1123, y: 430 },
  { second: 15.7, zoom: 1.28, x: 1123, y: 430 },
  { second: 18.4, zoom: 1, x: 960, y: 540 },
  { second: 23.4, zoom: 1, x: 960, y: 540 },
  { second: 30, zoom: 1.07, x: 960, y: 510 },
];

export function cameraAt(second: number): Camera {
  const index = cameraStops.findIndex(stop => stop.second > second);
  if (index < 0) return cameraStops[cameraStops.length - 1];
  if (index === 0) return cameraStops[0];
  const from = cameraStops[index - 1];
  const to = cameraStops[index];
  const t = clamp((second - from.second) / (to.second - from.second));
  const p = t * t * t * (t * (t * 6 - 15) + 10);
  const mix = (a: number, b: number) => a + (b - a) * p;
  return { second, zoom: mix(from.zoom, to.zoom), x: mix(from.x, to.x), y: mix(from.y, to.y) };
}

function screenPoint(camera: Camera, x: number, y: number) {
  return { x: 960 + (x - camera.x) * camera.zoom, y: 540 + (y - camera.y) * camera.zoom };
}

function caption(ctx: CanvasRenderingContext2D, title: string, time: number, start: number, end: number, point: { x: number; y: number }, size = 52) {
  const alpha = smooth((time - start) / .45) * smooth((end - time) / .35);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `550 ${size}px "Manrope"`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#f5f5f4";
  ctx.shadowColor = "rgba(10,12,24,.85)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 2;
  ctx.fillText(title, point.x, point.y + (1 - smooth((time - start) / .6)) * 5);
  ctx.restore();
}

function keypress(ctx: CanvasRenderingContext2D, recording: Recording, tick: number, point: { x: number; y: number }) {
  const latest = recording.inputs.filter(([at]) => at <= tick).at(-1);
  if (!latest) return;
  const [at, key] = latest;
  const age = (tick - at) / recording.fps;
  if (age > .8 || (key.length === 1 && "relax".includes(key))) return;
  ctx.save();
  ctx.globalAlpha = smooth((.8 - age) / .25);
  ctx.font = '500 25px "Manrope"';
  ctx.fillStyle = "#f5f5f4";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(10,12,24,.9)";
  ctx.shadowBlur = 10;
  ctx.fillText(key === "Right" ? "Right arrow" : key, point.x, point.y + 43);
  ctx.restore();
}

export function renderFrame(ctx: CanvasRenderingContext2D, frame: number, assets: WalkthroughAssets) {
  const t = frame / FILM.fps;
  if (t < APP_START) {
    ctx.save();
    ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
    ctx.fillStyle = "#f7f8f9";
    ctx.fillRect(0, 0, 1920, 1080);
    rasterWord(ctx, t);
    ctx.restore();
    return;
  }
  const tick = Math.min(assets.recording.frames.length - 1, Math.floor((t - APP_START) * assets.recording.fps + .0001));
  updateTerminal(assets, tick);
  ctx.save();
  ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = terminalColor;
  ctx.fillRect(0, 0, 1920, 1080);
  const camera = cameraAt(t);
  ctx.save();
  ctx.translate(960, 540);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(assets.terminal, 53, 36, 1814, 1008);
  ctx.restore();
  const label = screenPoint(camera, 970, 700);
  caption(ctx, "Find your music.", t, 3.8, 6.8, label);
  caption(ctx, "Add a little rain.", t, 8.1, 10.7, label);
  caption(ctx, "Make time to focus.", t, 13, 15.3, label);
  caption(ctx, "A world made of sound.", t, 23.5, 26.4, { x: 960, y: 800 }, 70);
  caption(ctx, "chill", t, 27.4, 31, { x: 960, y: 740 }, 88);
  caption(ctx, "Lo-fi, ambience, and focus.", t, 27.7, 31, { x: 960, y: 800 }, 30);
  caption(ctx, "github.com/Aquitano/chill-flow", t, 28, 31, { x: 960, y: 904 }, 24);
  keypress(ctx, assets.recording, tick, label);
  ctx.restore();
}

export async function loadWalkthroughAssets(recordingSource: string | Recording, displayFont: string, terminalFont: string): Promise<WalkthroughAssets> {
  const recording = typeof recordingSource === "string" ? JSON.parse(recordingSource) as Recording : recordingSource;
  const faces = await Promise.all([
    new FontFace("Manrope", `url("${displayFont}")`, { weight: "200 800" }).load(),
    new FontFace("Terminal", `url("${terminalFont}")`).load(),
  ]);
  faces.forEach(face => document.fonts.add(face));
  const terminal = document.createElement("canvas");
  terminal.width = recording.columns * 18;
  terminal.height = recording.rows * 36;
  const context = terminal.getContext("2d");
  if (!context) throw new Error("Terminal drawing is unavailable.");
  return { recording, terminal, context, tick: -1, octants: new Map(recording.octants.map((symbol, bits) => [symbol, bits])) };
}
