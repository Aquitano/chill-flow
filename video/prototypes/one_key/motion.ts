export const meta = {
  id: "OneKey", title: "One key", description: "A timer key becomes an aperture into the real terminal. One action, then stillness.",
  seconds: 11, fps: 30, width: 1920, height: 1080, posterFrame: 294,
} as const;
export type PrototypeAssets = {ui: HTMLImageElement; landscape: HTMLImageElement};
export const fontFaces: readonly {family: string; file: string}[] = [{family: "Chill Terminal", file: "assets/Terminal.ttf"}];
const palette = {base: "#1e1e2e", text: "#cdd6f4", amber: "#f9e2af", teal: "#94e2d5"};
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => 1 - Math.pow(1 - clamp(v), 5);
const smooth = (v: number) => {const t = clamp(v); return t * t * (3 - 2 * t);};
const mix = (a: number, b: number, v: number) => a + (b - a) * v;

function player(ctx: CanvasRenderingContext2D, assets: PrototypeAssets) {
  ctx.drawImage(assets.ui, 160, 207, 2543, 1546, 132, 36, 1656, 1008);
}

function title(ctx: CanvasRenderingContext2D, frame: number) {
  const start = 236;
  const beats = [0, 8, 14, 25, 29];
  const x = 670;
  const cell = 116;
  ctx.font = '192px "Chill Terminal"';
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.text;
  let cursor = x;
  for (let i = 0; i < 5; i++) {
    const age = frame - start - beats[i];
    if (age < 0) break;
    const char = "chill"[i];
    ctx.save();
    if (char === "i" && age < 9) {
      ctx.beginPath(); ctx.rect(x + i * cell, 446, cell, 140); ctx.clip();
    } else {
      ctx.beginPath(); ctx.rect(x + i * cell, 345, cell * ease(age / 4), 235); ctx.clip();
    }
    ctx.fillText(char, x + i * cell, 566);
    ctx.restore();
    cursor = x + (i + 1) * cell;
  }
  if (frame < 284 || frame % 32 < 19) {
    ctx.fillStyle = palette.amber;
    ctx.fillRect(cursor + 9, 417, 18, 153);
  }
  const reveal = ease((frame - 277) / 16);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 635, 1920 * reveal, 70); ctx.clip();
  ctx.fillStyle = palette.text;
  ctx.font = '32px "Chill Terminal"';
  ctx.textAlign = "center";
  ctx.fillText("Focus, in your terminal.", 960, 673);
  ctx.restore();
}

export function drawFrame(ctx: CanvasRenderingContext2D, frame: number, assets: PrototypeAssets): void {
  ctx.save();
  ctx.scale(ctx.canvas.width / 1920, ctx.canvas.height / 1080);
  ctx.fillStyle = palette.base; ctx.fillRect(0, 0, 1920, 1080);
  if (frame < 77) {
    const press = smooth((frame - 46) / 5) * (1 - smooth((frame - 53) / 7));
    const vanish = 1 - smooth((frame - 61) / 10);
    ctx.save();
    ctx.translate(925, 550 + press * 12);
    ctx.scale(1 + press * .035, 1 - press * .1);
    ctx.globalAlpha = vanish;
    ctx.fillStyle = palette.text; ctx.font = '212px "Chill Terminal"'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("t", 0, 0);
    ctx.restore();
    const aperture = ease((frame - 63) / 14);
    ctx.fillStyle = frame < 51 ? palette.amber : palette.teal;
    if (frame > 19 || frame < 10) ctx.fillRect(mix(1014, 951, aperture), mix(467, 537, aperture), 18, mix(157, 6, aperture));
  }
  if (frame >= 72 && frame < 236) {
    const widthOpen = ease((frame - 72) / 24);
    const heightOpen = ease((frame - 87) / 33);
    const close = smooth((frame - 214) / 18);
    const w = mix(18, 1656, widthOpen) * (1 - close);
    const h = mix(6, 1008, heightOpen) * (1 - close);
    ctx.save();
    ctx.beginPath(); ctx.rect(960 - w / 2, 540 - h / 2, w, h); ctx.clip();
    player(ctx, assets);
    ctx.restore();
    if (frame < 109) {
      ctx.fillStyle = palette.teal;
      ctx.globalAlpha = 1 - smooth((frame - 99) / 10);
      ctx.fillRect(960 + w / 2 - 6, 540 - h / 2, 6, h);
      ctx.globalAlpha = 1;
    }
  }
  if (frame >= 236) title(ctx, frame);
  ctx.restore();
}
