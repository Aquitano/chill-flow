import * as quietType from "./quiet_type/motion";
import * as singleHorizon from "./single_horizon/motion";
import * as rasterToPrint from "./raster_to_print/motion";
import * as oneKey from "./one_key/motion";

const studies = [
  { ...quietType, slug: "quiet_type", still: 42, summary: "Counter-moving letter strokes." },
  { ...singleHorizon, slug: "single_horizon", still: 126, summary: "One line opens into Fuji at dawn." },
  { ...rasterToPrint, slug: "raster_to_print", still: 32, summary: "Pixels settle into solid typography." },
  { ...oneKey, slug: "one_key", still: 42, summary: "A key becomes the opening into the app." },
];

const canvas = document.querySelector<HTMLCanvasElement>("#film");
const play = document.querySelector<HTMLButtonElement>("#play");
const playAll = document.querySelector<HTMLButtonElement>("#play-all");
const speed = document.querySelector<HTMLButtonElement>("#speed");
const scrub = document.querySelector<HTMLInputElement>("#scrub");
const clock = document.querySelector<HTMLOutputElement>("#clock");
const description = document.querySelector<HTMLElement>("#description");
const cards = document.querySelector<HTMLElement>("#cards");
const ui = document.querySelector<HTMLImageElement>("#ui-source");
const landscape = document.querySelector<HTMLImageElement>("#landscape-source");
const fontData = document.querySelector<HTMLScriptElement>("#font-data");
if (!canvas || !play || !playAll || !speed || !scrub || !clock || !description || !cards || !ui || !landscape || !fontData) throw new Error("The comparison is missing its controls or assets.");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas is unavailable.");
const view = { canvas, play, playAll, speed, scrub, clock, description, cards, ui, landscape, ctx, fontData };

declare global {
  interface Window {
    chillComparison: { select: (index: number) => void; seek: (frame: number) => void; getState: () => { index: number; frame: number; playing: boolean; all: boolean } };
  }
}

async function start() {
  const fonts: { family: string; url: string }[] = JSON.parse(view.fontData.textContent || "[]");
  await Promise.all([view.ui.decode(), view.landscape.decode(), ...fonts.map(async font => {
    const face = new FontFace(font.family, `url("${font.url}")`, { weight: "100 900" });
    document.fonts.add(await face.load());
  })]);
  const assets = { ui: view.ui, landscape: view.landscape };
  let index = 0;
  let frame = 80;
  let playing = false;
  let all = false;
  let fresh = true;
  let rate = 1;
  let origin = 0;
  let originFrame = 0;
  let animation = 0;

  function draw() {
    const study = studies[index];
    view.ctx.resetTransform();
    study.drawFrame(view.ctx, frame, assets);
    view.scrub.max = String(study.meta.seconds * study.meta.fps - 1);
    view.scrub.value = String(frame);
    view.clock.value = `${(frame / study.meta.fps).toFixed(1)} / ${study.meta.seconds}s`;
    view.description.textContent = `${study.meta.title}. ${study.summary}`;
    view.canvas.setAttribute("aria-label", study.meta.description);
    view.cards.querySelectorAll<HTMLButtonElement>("button").forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    view.play.textContent = playing ? "Pause" : frame >= study.meta.seconds * study.meta.fps - 1 ? "Replay" : "Play";
    view.playAll.textContent = all ? "Playing all four" : "Play all four";
  }

  function pause() {
    playing = false; all = false;
    cancelAnimationFrame(animation);
  }

  function select(next: number) {
    pause();
    index = Math.max(0, Math.min(studies.length - 1, Math.round(next)));
    frame = studies[index].slug === "quiet_type" ? 80 : studies[index].still;
    fresh = true;
    draw();
  }

  function seek(next: number) {
    pause(); fresh = false;
    frame = Math.max(0, Math.min(studies[index].meta.seconds * 30 - 1, Math.round(next)));
    draw();
  }

  function tick(now: number) {
    if (!playing) return;
    const end = studies[index].meta.seconds * 30 - 1;
    frame = Math.min(end, originFrame + Math.floor((now - origin) / 1000 * 30 * rate));
    if (frame === end) {
      if (all && index < studies.length - 1) {
        index++; frame = 0; originFrame = 0; origin = now;
      } else pause();
    }
    draw();
    if (playing) animation = requestAnimationFrame(tick);
  }

  function begin() {
    cancelAnimationFrame(animation);
    if (fresh || frame >= studies[index].meta.seconds * 30 - 1) frame = 0;
    fresh = false; playing = true;
    originFrame = frame; origin = performance.now();
    draw();
    animation = requestAnimationFrame(tick);
  }

  studies.forEach((study, i) => {
    const button = view.cards.querySelectorAll<HTMLButtonElement>("button")[i];
    button.setAttribute("aria-label", `Select ${study.meta.title}`);
    const context = button.querySelector("canvas")?.getContext("2d");
    if (context) study.drawFrame(context, study.still, assets);
    button.querySelector("img")?.remove();
    button.addEventListener("click", () => select(i));
  });
  view.play.disabled = false;
  view.playAll.disabled = false;
  view.speed.disabled = false;
  view.play.addEventListener("click", () => {
    if (playing) { pause(); draw(); }
    else begin();
  });
  view.playAll.addEventListener("click", () => {
    pause(); index = 0; frame = 0; fresh = false; all = true; begin();
  });
  view.speed.addEventListener("click", () => {
    rate = rate === 1 ? .5 : 1;
    view.speed.setAttribute("aria-pressed", String(rate === .5));
    origin = performance.now(); originFrame = frame;
  });
  view.scrub.addEventListener("input", () => seek(Number(view.scrub.value)));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); draw(); } });
  window.chillComparison = { select, seek, getState: () => ({ index, frame, playing, all }) };
  draw();
  document.querySelector("#initial-poster")?.remove();
}

start().catch((error: unknown) => {
  view.description.textContent = error instanceof Error ? error.message : "The comparison could not load.";
  view.description.setAttribute("role", "alert");
});
