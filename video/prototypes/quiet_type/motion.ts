export const meta = {
  id: "QuietType",
  title: "Quiet type",
  description: "Two counter-moving l strokes settle into a tightly spaced word. A central aperture opens onto the real terminal, then closes to the title.",
  seconds: 11,
  fps: 30,
  width: 1920,
  height: 1080,
  posterFrame: 285,
} as const;

export type PrototypeAssets = { ui: HTMLImageElement; landscape: HTMLImageElement };

export const fontFaces: readonly { family: string; file: string }[] = [
  { family: "Geist", file: "assets/geist-sans-latin-500-normal.woff2" },
  { family: "Geist Mono", file: "assets/geist-mono-latin-400-normal.woff2" },
];

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const ease = (n: number) => {
  const p = clamp(n);
  return p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2;
};
const out = (n: number) => 1 - (1 - clamp(n)) ** 4;

function title(ctx: CanvasRenderingContext2D, t: number) {
  ctx.font = '500 440px "Geist"';
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#cdd6f4";
  const letters = [..."chill"];
  const widths = letters.map(letter => ctx.measureText(letter).width);
  const gap = -11;
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * 4;
  let x = (1920 - total) / 2 - 6;
  const baseline = 682;
  for (let i = 0; i < letters.length; i++) {
    ctx.save();
    if (i < 3) {
      const reveal = out((t - 0.72 - (2 - i) * 0.14) / 1.2);
      const expansion = (1 - ease((t - 0.9) / 1.8)) * (i - 2) * 48;
      const glyphX = x + expansion;
      ctx.beginPath();
      ctx.rect(glyphX + widths[i] * (1 - reveal), 280, widths[i] * reveal + 1, 430);
      ctx.clip();
      ctx.fillText(letters[i], glyphX, baseline);
    } else {
      const progress = out((t - (i === 3 ? 0.12 : 0.3)) / 1.28);
      const offset = (1 - progress) * (i === 3 ? -440 : 440);
      const spacing = (1 - ease((t - 0.68) / 1.45)) * (i === 3 ? -26 : 74);
      ctx.beginPath();
      ctx.rect(x + spacing - 12, 300, widths[i] + 24, 390);
      ctx.clip();
      ctx.fillText(letters[i], x + spacing, baseline + offset);
    }
    ctx.restore();
    x += widths[i] + gap;
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, frame: number, assets: PrototypeAssets): void {
  const t = Math.max(0, frame) / 30;
  ctx.save();
  ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#1e1e2e";
  ctx.fillRect(0, 0, 1920, 1080);
  title(ctx, t);

  if (t >= 7.45) {
    const reveal = ease((t - 7.7) / 0.95);
    const text = "Focus, in your terminal.";
    ctx.font = '400 32px "Geist Mono"';
    const width = ctx.measureText(text).width;
    ctx.save();
    ctx.beginPath();
    ctx.rect((1920 - width) / 2, 744, width * reveal, 60);
    ctx.clip();
    ctx.fillStyle = "#cdd6f4";
    ctx.fillText(text, (1920 - width) / 2, 783);
    ctx.restore();
  }

  const aperture = ease((t - 3.55) / 1.05) * (1 - ease((t - 7.05) / 1.1));
  if (aperture > 0) {
    ctx.save();
    ctx.beginPath();
    const openingWidth = 1920 * aperture;
    ctx.rect((1920 - openingWidth) / 2, 0, openingWidth, 1080);
    ctx.clip();
    ctx.fillStyle = "#1e1e2e";
    ctx.fillRect(0, 0, 1920, 1080);
    const imageWidth = 1440;
    const imageHeight = imageWidth * assets.ui.height / assets.ui.width;
    ctx.drawImage(assets.ui, (1920 - imageWidth) / 2, (1080 - imageHeight) / 2, imageWidth, imageHeight);
    ctx.restore();
  }
  ctx.restore();
}
