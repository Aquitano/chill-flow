import { drawFrame as rasterOpening, type PrototypeAssets } from "../prototypes/raster_to_print/motion";

export const FILM = { width: 1920, height: 1080, fps: 30, seconds: 30 } as const;
export const chapters = [
  { second: 0, name: "Raster opening" },
  { second: 4, name: "Lo-fi music" },
  { second: 9, name: "Ambient sound" },
  { second: 14, name: "Focus timer" },
  { second: 19, name: "A world of sound" },
  { second: 26, name: "chill" },
] as const;

export type WorldAssets = PrototypeAssets & { journey: HTMLImageElement };
type Context = CanvasRenderingContext2D;
type Box = { x: number; y: number; width: number; height: number };
const palette = { paper: "#f7f8f9", ink: "#111111", secondary: "#52545b", terminal: "#1e1e2e" };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };
const mix = (a: number, b: number, progress: number) => a + (b - a) * progress;
const full = { x: 0, y: -54, width: 1440, height: 900 };
const ambience = { x: 1071, y: 250, width: 369, height: 230.625 };
const timer = { x: 1071, y: 16, width: 369, height: 230.625 };
const viewport = { x: 800, y: 220, width: 1000, height: 625 };

function camera(ctx: Context, image: HTMLImageElement, from: Box, to: Box, progress: number) {
  const p = smooth(progress);
  const source = {
    x: mix(from.x, to.x, p), y: mix(from.y, to.y, p),
    width: mix(from.width, to.width, p), height: mix(from.height, to.height, p),
  };
  ctx.save();
  ctx.beginPath(); ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height); ctx.clip();
  ctx.fillStyle = palette.terminal;
  ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.drawImage(image, source.x, source.y, source.width, source.height, viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.restore();
}

function text(ctx: Context, lines: readonly string[], x: number, y: number, size: number, weight: number, fill: string, lineHeight = 1.14) {
  ctx.save();
  ctx.font = `${weight} ${size}px "Manrope"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fill;
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * size * lineHeight));
  ctx.restore();
}

function feature(ctx: Context, title: readonly string[], body: readonly string[]) {
  text(ctx, title, 135, 355, 96, 800, palette.ink);
  text(ctx, body, 141, title.length === 1 ? 475 : 575, 36, 500, palette.secondary, 1.5);
}

function landscape(ctx: Context, image: HTMLImageElement, box: Box) {
  const width = image.naturalWidth - 44;
  const height = 656;
  const scale = Math.max(box.width / width, box.height / height);
  const sourceWidth = box.width / scale;
  const sourceHeight = box.height / scale;
  ctx.drawImage(image, 22 + (width - sourceWidth) / 2, 96 + (height - sourceHeight) / 2, sourceWidth, sourceHeight,
    box.x, box.y, box.width, box.height);
}

function world(ctx: Context, frame: number, assets: WorldAssets) {
  const t = frame / 30;
  const open = smooth((t - 19) / 1.1);
  const box = {
    x: mix(viewport.x, 0, open), y: mix(viewport.y, 360, open),
    width: mix(viewport.width, 1920, open), height: mix(viewport.height, 720, open),
  };
  text(ctx, ["A world made of sound."], 135, 167, 92, 800, palette.ink);
  text(ctx, ["Living scenes, drawn in terminal characters."], 142, 260, 38, 500, palette.secondary);
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip();
  landscape(ctx, assets.journey, box);
  const turn = (t - 22.45) / .95;
  for (let column = 0; column < 64; column++) {
    const p = smooth(turn * 1.7 - column / 64 * .7);
    if (p === 0) continue;
    const width = box.width / 64;
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x + column * width, box.y, width + 1, box.height * p); ctx.clip();
    landscape(ctx, assets.landscape, box);
    ctx.restore();
  }
  ctx.restore();
}

export function musicLevel(frame: number) {
  const second = frame / 30;
  return .46 * smooth((second - 4) / 1.1) * smooth((30 - second) / 1.7);
}

export function rainLevel(frame: number) {
  const second = frame / 30;
  return .24 * smooth((second - 9) / 1.6) * smooth((30 - second) / 1.7);
}

export function renderFrame(ctx: Context, frame: number, assets: WorldAssets) {
  const second = frame / FILM.fps;
  if (second < 4) {
    rasterOpening(ctx, frame, assets);
    return;
  }
  if (second >= 26) {
    rasterOpening(ctx, 300, assets);
    ctx.save();
    ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
    ctx.font = '500 28px "Manrope"';
    ctx.textAlign = "center";
    ctx.fillStyle = palette.secondary;
    ctx.fillText("github.com/Aquitano/chill-flow", 960, 870);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, 1920, 1080);
  if (second < 9) {
    feature(ctx, ["Press play."], ["Lo-fi music from the catalog", "or your YouTube links.", "All in your terminal."]);
    camera(ctx, assets.ui, { x: -48, y: -84, width: 1536, height: 960 }, full, (second - 4) / 1.2);
  } else if (second < 14) {
    feature(ctx, ["Add a little", "rain."], ["Blend ambient sounds", "with your music."]);
    camera(ctx, assets.ui, full, ambience, (second - 9) / 1.1);
  } else if (second < 19) {
    feature(ctx, ["Time for", "focus."], ["A built-in timer for", "focus blocks and breaks."]);
    camera(ctx, assets.ui, ambience, timer, (second - 14) / .9);
  } else world(ctx, frame, assets);
  ctx.restore();
}

export async function loadWorldAssets(uiSource: string, landscapeSource: string, journeySource: string, fontSource: string): Promise<WorldAssets> {
  const loadImage = async (source: string) => {
    const image = new Image(); image.src = source; await image.decode(); return image;
  };
  const font = new FontFace("Manrope", `url("${fontSource}")`, { weight: "200 800" });
  const [ui, landscape, journey, face] = await Promise.all([
    loadImage(uiSource), loadImage(landscapeSource), loadImage(journeySource), font.load(),
  ]);
  document.fonts.add(face);
  return { ui, landscape, journey };
}
