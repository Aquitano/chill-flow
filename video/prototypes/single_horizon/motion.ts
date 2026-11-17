export const meta = {
  id: 'SingleHorizon',
  title: 'Single horizon',
  description: 'One boundary settles, opens onto the real Fuji terminal, and becomes the baseline of chill.',
  seconds: 11,
  fps: 30,
  width: 1920,
  height: 1080,
  posterFrame: 288,
} as const;

export type PrototypeAssets = {ui: HTMLImageElement; landscape: HTMLImageElement};
export const fontFaces: readonly {family: string; file: string}[] = [
  {family: 'Horizon Sans', file: 'public/assets/DejaVuSans-Bold.ttf'},
];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {const x = clamp(n); return x * x * x * (10 + x * (-15 + x * 6));};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function drawFrame(ctx: CanvasRenderingContext2D, frame: number, assets: PrototypeAssets): void {
  const t = frame / 30;
  ctx.save();
  ctx.setTransform(ctx.canvas.width / 1920, 0, 0, ctx.canvas.height / 1080, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, 1920, 1080);

  const open = smooth((t - 2.0) / 1.65);
  const close = smooth((t - 5.85) / 1.65);
  const aperture = open * (1 - close);
  const baseline = mix(mix(540, 850, open), 615, close);
  const left = mix(300, 660, close);
  const right = mix(1620, 1260, close);
  const lineExit = smooth((t - 8.35) / .65);

  if (aperture > 0) {
    ctx.save();
    const height = 670 * aperture;
    ctx.beginPath();
    ctx.rect(300, baseline - height, 1320, height);
    ctx.clip();
    ctx.drawImage(assets.landscape, 300, baseline - 670, 1320, 670);
    ctx.restore();
  }

  if (lineExit < 1) {
    const settle = 1 - smooth((t - .25) / 1.85);
    const grow = smooth(t / .9);
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const u = i / 240;
      const x = mix(960, mix(left, right, u), grow);
      const localized = Math.exp(-(((u - .47) / .16) ** 2));
      const bend = Math.sin((u - .38) * 15) * localized * 65 * settle;
      const y = baseline + bend;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#f9e2af';
    ctx.globalAlpha = 1 - lineExit;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (t >= 7.15) {
    ctx.font = '700 230px "Horizon Sans"';
    ctx.fillStyle = '#cdd6f4';
    const letters = ['c', 'h', 'i', 'l', 'l'];
    const widths = letters.map(letter => ctx.measureText(letter).width);
    const tracking = -9;
    const total = widths.reduce((sum, width) => sum + width, 0) + tracking * 4;
    let x = (1920 - total) / 2;
    const starts = [7.15, 7.33, 7.52, 7.62, 7.62];
    letters.forEach((letter, index) => {
      const progress = smooth((t - starts[index]!) / .9);
      const width = widths[index]!;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 30, 280, width + 60, 335);
      ctx.clip();
      const drift = (1 - progress) * [12, -8, 0, -5, 5][index]!;
      ctx.translate(x + width / 2 + drift, 585 + (1 - progress) * 235);
      ctx.rotate((1 - progress) * [-.12, .06, 0, -.055, .055][index]!);
      ctx.scale(1, mix(.82, 1, progress));
      ctx.fillText(letter, -width / 2, 0);
      ctx.restore();
      x += width + tracking;
    });
    const caption = smooth((t - 8.65) / .75);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 660, 1920 * caption, 80);
    ctx.clip();
    ctx.font = '700 32px "Horizon Sans"';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#cdd6f4';
    ctx.fillText('Focus, in your terminal.', 960, 699);
    ctx.restore();
  }
  ctx.restore();
}
