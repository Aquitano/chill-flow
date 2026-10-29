export const meta = {
  id: "RasterToPrint", title: "Raster to print",
  description: "Terminal-scale blocks settle by letter, then become crisp Manrope. A real player interlude returns to a quiet typographic signature.",
  seconds: 11, fps: 30, width: 1920, height: 1080, posterFrame: 144,
} as const;

export type PrototypeAssets = {ui: HTMLImageElement; landscape: HTMLImageElement};
export const fontFaces: readonly {family: string; file: string}[] = [
  {family: "Manrope", file: "assets/Manrope.ttf"},
];

const paper = "#f7f8f9";
const ink = "#111111";
const font = '800 370px "Manrope"';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 4;
const smooth = (n: number) => {const p = clamp(n); return p * p * (3 - 2 * p);};
type Cell = {x: number; y: number};
type Glyph = {image: HTMLCanvasElement; cells: Cell[]; width: number; advance: number};
let glyphs: Glyph[] | undefined;

function getGlyphs(ctx: CanvasRenderingContext2D): Glyph[] {
  if (glyphs) return glyphs;
  ctx.font = font;
  glyphs = [..."chill"].map((letter) => {
    const advance = ctx.measureText(letter).width - 13;
    const image = document.createElement("canvas");
    image.width = Math.ceil(advance + 40);
    image.height = 410;
    const g = image.getContext("2d", {willReadFrequently: true});
    if (!g) throw new Error("Canvas context unavailable");
    g.font = font;
    g.fillStyle = ink;
    g.fillText(letter, 8, 335);
    const pixels = g.getImageData(0, 0, image.width, image.height);
    const cells: Cell[] = [];
    for (let y = 0; y < 390; y += 15) {
      for (let x = 0; x < image.width; x += 15) {
        let coverage = 0;
        let samples = 0;
        for (let dy = 2; dy < 15; dy += 4) {
          for (let dx = 2; dx < 15; dx += 4) {
            const px = x + dx;
            if (px >= image.width) continue;
            coverage += pixels.data[((y + dy) * image.width + px) * 4 + 3] / 255;
            samples++;
          }
        }
        if (coverage / samples > 0.43) cells.push({x, y});
      }
    }
    return {image, cells, width: image.width, advance};
  });
  return glyphs;
}

export function drawWord(ctx: CanvasRenderingContext2D, time: number, end = false) {
  const letters = getGlyphs(ctx);
  const width = letters.reduce((n, glyph) => n + glyph.advance, 0) + 13;
  ctx.save();
  if (end) {
    ctx.translate(960, 515);
    ctx.scale(0.66, 0.66);
    ctx.translate(-960, -515);
  }
  let x = (1920 - width) / 2 - 8;
  const y = end ? 310 : 300;
  letters.forEach((glyph, index) => {
    const printed = ease((time - 2.1 - index * 0.16) / 1.35);
    const seam = 410 * (1 - printed);
    ctx.save();
    ctx.translate(x, y);
    if (printed < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-100, -160, glyph.width + 200, seam + 160);
      ctx.clip();
      ctx.fillStyle = ink;
      for (const cell of glyph.cells) {
        let delay = index * 0.12;
        let dx = 0;
        let dy = 0;
        if (index === 0) {
          dx = cell.y < 230 ? -25 : 25;
          dy = cell.y < 230 ? -18 : 18;
          delay += cell.x / glyph.width * 0.25;
        } else if (index === 1) {
          if (cell.x > 65) {dy = 55; dx = 15; delay += 0.3 + cell.x / glyph.width * 0.16;}
        } else if (index === 2) {
          if (cell.y < 125) {dy = -86; delay += 0.68;}
        } else {
          dy = -45;
          delay += (335 - cell.y) / 700;
        }
        const settle = ease((time - 0.45 - delay) / 1.05);
        const gap = 1.5 * (1 - smooth((time - 1.6) / 0.6));
        ctx.fillRect(cell.x + dx * (1 - settle), cell.y + dy * (1 - settle), 15 - gap, 15 - gap);
      }
      ctx.restore();
    }
    if (printed > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, seam, glyph.width, 410 - seam);
      ctx.clip();
      ctx.drawImage(glyph.image, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    x += glyph.advance;
  });
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, reveal: number, y: number) {
  const text = "Focus, in your terminal.";
  ctx.font = '500 38px "Manrope"';
  const width = ctx.measureText(text).width;
  const x = (1920 - width) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 3, y - 50, (width + 6) * ease(reveal), 70);
  ctx.clip();
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawFrame(ctx: CanvasRenderingContext2D, frame: number, assets: PrototypeAssets): void {
  const time = Math.max(0, frame) / meta.fps;
  ctx.save();
  ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 1920, 1080);
  if (time < 6.15) {
    drawWord(ctx, time);
    drawLine(ctx, (time - 4.15) / 0.75, 745);
  } else if (time < 8.8) {
    ctx.fillStyle = "#1e1e2e";
    ctx.fillRect(0, 0, 1920, 1080);
    const width = 1480;
    const height = width * assets.ui.naturalHeight / assets.ui.naturalWidth;
    ctx.drawImage(assets.ui, (1920 - width) / 2, (1080 - height) / 2, width, height);
  } else {
    drawWord(ctx, 5, true);
    drawLine(ctx, (time - 8.95) / 0.55, 680);
  }
  ctx.restore();
}
