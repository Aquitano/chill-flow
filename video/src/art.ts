export const FILM = { width: 1920, height: 1080, fps: 30, seconds: 30 } as const;

export const chapters = [
  { second: 0, name: "Observation" },
  { second: 5, name: "Interference" },
  { second: 10, name: "Letterforms" },
  { second: 15, name: "Rain" },
  { second: 20, name: "The instrument" },
  { second: 25, name: "chill" },
] as const;

const color = { ink: "#0a100e", paper: "#e6dfca", copper: "#c99e70", sage: "#a1b39b", dim: "#7b897a" };
const serif = '"Libre Caslon Display", Georgia, serif';
const mono = '"Courier New", monospace';
type Context = CanvasRenderingContext2D;
type Point = { x: number; y: number };
type Stroke = { path: Path2D; length: number; points: Point[] };

export type FilmAssets = { ui: HTMLImageElement };

const letters = [
  { advance: 170, paths: ["M150 27 C128 1 84 -1 49 17 C8 38 -4 82 18 120 C43 161 112 165 153 129"] },
  { advance: 157, paths: ["M17 -62 L17 145", "M17 65 C42 8 131 8 131 65 L131 145"] },
  { advance: 64, paths: ["M24 36 L24 145", "M24 -23 L24 -21"] },
  { advance: 76, paths: ["M23 -62 L23 119 Q23 150 52 140"] },
  { advance: 68, paths: ["M21 -62 L21 119 Q21 150 50 140"] },
] as const;

let strokes: Stroke[][] | undefined;

function letterStrokes() {
  if (strokes) return strokes;
  strokes = letters.map(letter => letter.paths.map(d => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
    element.setAttribute("d", d);
    const length = element.getTotalLength();
    const points = Array.from({ length: Math.ceil(length / 3) + 1 }, (_, i) => {
      const point = element.getPointAtLength(Math.min(length, i * 3));
      return { x: point.x, y: point.y };
    });
    return { path: new Path2D(d), length, points };
  }));
  return strokes;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };
const ease = (value: number) => 1 - (1 - clamp(value)) ** 4;
const hash = (value: number) => { const n = Math.sin(value * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

function line(ctx: Context, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function label(ctx: Context, text: string, x: number, y: number, alpha = 1, size = 17, align: CanvasTextAlign = "left") {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${size}px ${mono}`;
  ctx.textAlign = align;
  ctx.fillStyle = color.dim;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function frameMarks(ctx: Context, t: number, light = false) {
  ctx.save();
  ctx.strokeStyle = light ? "#253629" : color.sage;
  ctx.globalAlpha = .35;
  ctx.lineWidth = 1;
  for (const x of [76, 1844]) for (const y of [76, 1004]) {
    const dx = x < 960 ? 1 : -1;
    const dy = y < 540 ? 1 : -1;
    line(ctx, x, y, x + dx * 22, y);
    line(ctx, x, y, x, y + dy * 22);
  }
  ctx.restore();
  label(ctx, "chill / studies in sound", 104, 99, .8);
  label(ctx, `${String(Math.floor(t)).padStart(2, "0")}:${String(Math.floor((t % 1) * 30)).padStart(2, "0")}`, 1742, 99, .8);
}

function grain(ctx: Context, t: number, paper = false) {
  ctx.save();
  const tick = Math.floor(t * 8);
  ctx.fillStyle = paper ? "#1b281a" : color.paper;
  ctx.globalAlpha = paper ? .045 : .035;
  for (let i = 0; i < 3300; i++) {
    const x = hash(i * 3 + tick * 779) * 1920;
    const y = hash(i * 3 + 1 + tick * 779) * 1080;
    ctx.fillRect(x, y, hash(i + 99) > .96 ? 3 : 1, 1);
  }
  ctx.restore();
}

function specimen(ctx: Context, t: number, alpha = 1, shift = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const drift = Math.sin(t * .18) * 26;
  for (let row = 0; row < 68; row++) {
    const v = row / 67;
    for (let col = 0; col < 170; col++) {
      const u = col / 169 * 2 - 1;
      const dome = Math.sqrt(Math.max(0, 1 - u * u));
      const ripple = Math.sin(u * 15 + v * 24 - t * .66) * Math.sin(v * 8 + t * .2);
      const height = dome * (630 + v * 180) + ripple * (8 + 16 * v);
      const x = 1190 + shift + u * (870 + v * 230) + drift;
      const y = 1000 - height + v * 320;
      const light = (.3 + .7 * (1 - v)) * (.45 + .55 * dome);
      ctx.fillStyle = row < 7 ? color.paper : color.copper;
      ctx.globalAlpha = alpha * light * (.65 + .35 * hash(row * 170 + col));
      const size = 1.4 + v * 1.9;
      ctx.fillRect(x, y, size, size * .7);
    }
  }
  ctx.globalAlpha = alpha * .3;
  ctx.strokeStyle = color.copper;
  for (let row = 0; row < 18; row++) {
    const v = row / 17;
    ctx.beginPath();
    for (let col = 0; col <= 160; col++) {
      const u = col / 160 * 2 - 1;
      const dome = Math.sqrt(Math.max(0, 1 - u * u));
      const x = 1190 + shift + u * (870 + v * 230) + drift;
      const y = 1000 - dome * (630 + v * 180) + v * 320;
      if (col === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function interference(ctx: Context, t: number, settling: number) {
  ctx.save();
  const radius = 365;
  const cx = 1295;
  const cy = 570;
  ctx.strokeStyle = color.sage;
  ctx.lineWidth = 1;
  ctx.globalAlpha = .23;
  ctx.beginPath(); ctx.arc(cx, cy, radius + 24, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 64; i++) {
    const a = i / 64 * Math.PI * 2;
    line(ctx, cx + Math.cos(a) * (radius + 23), cy + Math.sin(a) * (radius + 23), cx + Math.cos(a) * (radius + (i % 8 === 0 ? 37 : 29)), cy + Math.sin(a) * (radius + (i % 8 === 0 ? 37 : 29)));
  }
  for (let i = 0; i < 26000; i++) {
    const u = hash(i * 2) * 2 - 1;
    const v = hash(i * 2 + 1) * 2 - 1;
    const r = Math.hypot(u, v);
    if (r > 1) continue;
    const phase = t * .23 * (1 - settling);
    const field = Math.cos(u * 8.8 + phase) * Math.cos(v * 13.2) - Math.cos(u * 13.2) * Math.cos(v * 8.8 - phase);
    const density = Math.exp(-Math.abs(field) * (6 + settling * 10));
    if (density < .12) continue;
    ctx.fillStyle = i % 11 === 0 ? color.paper : color.copper;
    ctx.globalAlpha = density * (.45 + .55 * (1 - r * .45));
    ctx.fillRect(cx + u * radius, cy + v * radius, 2.2, 2.2);
  }
  ctx.restore();
}

function printedTitle(ctx: Context, text: string, x: number, y: number, size: number, reveal: number, dark = false) {
  ctx.save();
  ctx.font = `${size}px ${serif}`;
  ctx.fillStyle = dark ? color.ink : color.paper;
  let offset = 0;
  [...text].forEach((letter, index) => {
    const width = ctx.measureText(letter).width;
    const p = ease(reveal * 1.5 - index * .025);
    if (p > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x + offset - 8, y - size * p, width + 15, size * p + 22); ctx.clip();
      ctx.fillText(letter, x + offset, y + (1 - p) * 15);
      ctx.restore();
    }
    offset += width - size * .027;
  });
  ctx.restore();
}

function signature(ctx: Context, t: number, progress: number, scale = 2.45, y = 535, dark = false) {
  ctx.save();
  const total = letters.reduce((sum, letter) => sum + letter.advance, 0);
  ctx.translate((1920 - total * scale) / 2, y - 40 * scale);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const paths = letterStrokes();
  let offset = 0;
  paths.forEach((letter, index) => {
    const p = ease(progress * 1.45 - index * .095);
    ctx.save(); ctx.translate(offset, 0);
    for (let echo = 8; echo >= 1; echo--) {
      ctx.save();
      const separation = (1 - smooth(progress)) * 7 + 1.7;
      ctx.translate(echo * separation * .25, echo * separation);
      ctx.strokeStyle = dark ? "#56624a" : color.copper;
      ctx.globalAlpha = .08 * (1 - smooth(progress * 1.2));
      ctx.lineWidth = .6;
      for (const stroke of letter) { ctx.setLineDash([stroke.length]); ctx.lineDashOffset = stroke.length * (1 - p); ctx.stroke(stroke.path); }
      ctx.restore();
    }
    for (const stroke of letter) {
      ctx.strokeStyle = dark ? color.ink : color.paper;
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = smooth(progress * 2 - .35);
      ctx.setLineDash([stroke.length + 1]);
      ctx.lineDashOffset = (stroke.length + 1) * (1 - p);
      ctx.stroke(stroke.path);
      ctx.setLineDash([]);
      ctx.fillStyle = dark ? color.ink : color.copper;
      const count = Math.ceil(stroke.points.length * p);
      for (let i = 0; i < count; i++) {
        const point = stroke.points[i];
        const scatter = (1 - smooth(progress * 1.3)) * 15;
        ctx.globalAlpha = .8 * (1 - smooth(progress * 1.6 - .4));
        ctx.fillRect(point.x + Math.sin(i * 2 + t) * scatter, point.y + Math.cos(i * 1.7 + t) * scatter, .9, .9);
      }
    }
    ctx.restore();
    offset += letters[index].advance;
  });
  ctx.restore();
}

function rain(ctx: Context, t: number, alpha: number) {
  ctx.save();
  ctx.font = `19px ${mono}`;
  ctx.fillStyle = color.sage;
  for (let i = 0; i < 640; i++) {
    const x = Math.floor(hash(i * 2 + 41) * 1920 / 18) * 18;
    const y = ((hash(i * 2 + 42) * 1500 + t * (55 + hash(i) * 115)) % 1380) - 150;
    ctx.globalAlpha = alpha * (.1 + hash(i * 3) * .55);
    ctx.fillText(i % 9 === 0 ? ":" : i % 3 === 0 ? "|" : ".", x, y);
  }
  ctx.restore();
}

function trace(ctx: Context, t: number, y: number, amplitude: number, alpha: number) {
  ctx.save();
  ctx.strokeStyle = color.sage;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let x = 125; x < 1795; x += 3) {
    const envelope = Math.sin((x - 125) / 1670 * Math.PI) ** 3;
    const signal = Math.sin(x * .035 - t * 2.4) * .6 + Math.sin(x * .071 + t * 1.8) * .4;
    const yy = y + signal * amplitude * envelope;
    if (x === 125) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();
  ctx.restore();
}

function product(ctx: Context, assets: FilmAssets, t: number) {
  const p = ease((t - 20) / 1.2);
  printedTitle(ctx, "An instrument", 130, 236, 113, (t - 20) * 1.4);
  printedTitle(ctx, "for focus.", 130, 353, 113, (t - 20.35) * 1.4);
  label(ctx, "Lo-fi music", 138, 486, smooth((t - 20.8) * 2), 34);
  label(ctx, "Ambient sound", 138, 540, smooth((t - 21.1) * 2), 34);
  label(ctx, "A focus timer", 138, 594, smooth((t - 21.4) * 2), 34);
  const x = 720;
  const y = 205;
  const width = 1090;
  const source = { x: assets.ui.naturalWidth * .04, y: assets.ui.naturalHeight * .105,
    width: assets.ui.naturalWidth * .926, height: assets.ui.naturalHeight * .836 };
  const height = width * source.height / source.width;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, width * p, height); ctx.clip();
  ctx.drawImage(assets.ui, source.x, source.y, source.width, source.height, x, y, width, height);
  ctx.restore();
  ctx.strokeStyle = "#77816b"; ctx.globalAlpha = .5;
  ctx.strokeRect(x, y, width, height); ctx.globalAlpha = 1;
  label(ctx, "Runs in your terminal.", 138, 900, smooth((t - 22) * 2), 28);
}

export function renderFrame(ctx: Context, frame: number, assets: FilmAssets) {
  const t = Math.max(0, Math.min(29.999, frame / FILM.fps));
  ctx.save();
  ctx.setTransform(ctx.canvas.width / FILM.width, 0, 0, ctx.canvas.height / FILM.height, 0, 0);
  ctx.fillStyle = color.ink;
  ctx.fillRect(0, 0, 1920, 1080);

  if (t < 5) {
    specimen(ctx, t, 1);
    printedTitle(ctx, "A quieter", 132, 304, 156, .8 + t * .4);
    printedTitle(ctx, "state.", 132, 454, 156, t - .2);
    label(ctx, "An observation in sound.", 140, 934, smooth(t - .65), 30);
    ctx.save(); ctx.strokeStyle = color.copper; ctx.globalAlpha = .4;
    line(ctx, 1550, 585, 1620, 480); line(ctx, 1620, 480, 1740, 480);
    ctx.restore();
  } else if (t < 10) {
    const local = t - 5;
    interference(ctx, local, smooth(local / 4));
    printedTitle(ctx, "Find a little", 132, 365, 116, local * 1.1);
    printedTitle(ctx, "quiet.", 132, 493, 154, (local - .2) * 1.1);
    trace(ctx, t, 866, 75 * (1 - smooth(local / 4)) + 7, .65);
    label(ctx, "A study of interference", 140, 949, .8, 28);
  } else if (t < 15) {
    const local = t - 10;
    ctx.fillStyle = color.paper; ctx.fillRect(0, 0, 1920, 1080);
    ctx.save(); ctx.strokeStyle = "#596650"; ctx.globalAlpha = .13;
    for (let y = 230; y < 880; y += 45) line(ctx, 132, y, 1788, y);
    for (let x = 160; x < 1800; x += 90) line(ctx, x, 204, x, 894);
    ctx.restore();
    signature(ctx, local, local / 3.5, 2.6, 535, true);
    label(ctx, "Lo-fi + ambient sound", 135, 955, smooth(local - 2), 30);
    label(ctx, "Drawn from the same line.", 1330, 955, smooth(local - 2.6), 26);
  } else if (t < 20) {
    const local = t - 15;
    rain(ctx, local, .7);
    specimen(ctx, t, .28, 150);
    printedTitle(ctx, "A little rain.", 133, 380, 159, local * 1.3);
    printedTitle(ctx, "Time to focus.", 133, 543, 126, (local - .7) * 1.1);
    trace(ctx, t, 868, 12, .5);
    label(ctx, "Music. Ambience. Your time.", 140, 954, smooth(local - 1.4), 30);
  } else if (t < 25) {
    product(ctx, assets, t);
  } else {
    const local = t - 25;
    specimen(ctx, t, .22, 20);
    signature(ctx, local, .6 + local / 2, 2.2, 451);
    printedTitle(ctx, "A quieter state.", 660, 794, 75, .7 + local);
    label(ctx, "Music, ambience, and focus. In your terminal.", 960, 854, smooth(local - .3), 30, "center");
    label(ctx, "github.com/Aquitano/chill-flow", 960, 970, smooth(local - .75), 28, "center");
  }

  frameMarks(ctx, t, t >= 10 && t < 15);
  grain(ctx, t, t >= 10 && t < 15);
  ctx.restore();
}

export async function loadFilmAssets(uiSource: string, fontSource: string): Promise<FilmAssets> {
  const face = new FontFace("Libre Caslon Display", `url("${fontSource}")`);
  const image = new Image();
  image.src = uiSource;
  const [loadedFace] = await Promise.all([face.load(), image.decode()]);
  document.fonts.add(loadedFace);
  return { ui: image };
}
