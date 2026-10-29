import { drawWord } from "../raster_to_print/motion";

export const endCardStart = 18;
const edit = [
  [0, 0], [2.8, 3.5], [3.1, 4.1], [5.8, 7.2],
  [6.2, 8.4], [9, 11.5], [9.3, 12.6], [12.1, 15.4],
  [12.8, 18], [15.7, 21.3], [17.2, 22.8],
] as const;

export function retime(time: number, direction: "source" | "film") {
  const input = direction === "source" ? 0 : 1;
  const output = direction === "source" ? 1 : 0;
  const index = edit.findIndex(point => point[input] > time);
  if (index === 0) return edit[0][output];
  if (index < 0) return edit[edit.length - 1][output];
  const from = edit[index - 1], to = edit[index];
  const progress = (time - from[input]) / (to[input] - from[input]);
  return from[output] + (to[output] - from[output]) * progress;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 4;
const smooth = (n: number) => { const t = clamp(n); return t * t * t * (t * (t * 6 - 15) + 10); };

export function drawEndCard(ctx: CanvasRenderingContext2D, elapsed: number, drawApp: () => void) {
  ctx.fillStyle = "#f7f8f9";
  ctx.fillRect(0, 0, 1920, 1080);
  if (elapsed < .65) {
    const collapse = smooth(elapsed / .6);
    const width = 1920 - 1240 * collapse, height = 1080 - 1072 * collapse;
    ctx.save();
    ctx.globalAlpha = 1 - smooth((elapsed - .55) / .1);
    ctx.beginPath();
    ctx.roundRect((1920 - width) / 2, (1080 - height) / 2, width, height, Math.min(16 * collapse, height / 2));
    ctx.clip();
    drawApp();
    ctx.restore();
  }

  if (elapsed >= .6) {
    const reveal = elapsed - .6;
    ctx.save();
    ctx.globalAlpha = ease(reveal / .18);
    ctx.translate(960, 470);
    ctx.scale(1.25, 1.25);
    ctx.translate(-960, -515);
    drawWord(ctx, Math.min(5, .5 + reveal * 4.1), true);
    ctx.restore();
  }

  const caption = ease((elapsed - 1.15) / .45);
  ctx.save();
  ctx.beginPath();
  ctx.rect(300, 635, 1320, 70);
  ctx.clip();
  ctx.font = '500 36px "Manrope"';
  ctx.textAlign = "center";
  ctx.fillStyle = "#111111";
  ctx.globalAlpha = caption;
  ctx.fillText("Lo-fi, ambience, and a focus timer.", 960, 680 + 28 * (1 - caption));
  ctx.restore();

  ctx.save();
  ctx.font = '500 23px "Manrope"';
  ctx.textAlign = "center";
  ctx.fillStyle = "#656b76";
  ctx.globalAlpha = smooth((elapsed - 1.5) / .35);
  ctx.fillText("github.com/Aquitano/chill-flow", 960, 850);
  ctx.restore();
}
