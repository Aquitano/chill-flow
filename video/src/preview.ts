import { chapters, FILM, loadFilmAssets, renderFrame } from "./art";

declare global {
  interface Window {
    chillFilm: { seek: (frame: number) => void; durationInFrames: number };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#film");
const play = document.querySelector<HTMLButtonElement>("#play");
const slider = document.querySelector<HTMLInputElement>("#scrub");
const clock = document.querySelector<HTMLOutputElement>("#clock");
const status = document.querySelector<HTMLElement>("#status");
const image = document.querySelector<HTMLImageElement>("#film-ui");
const font = document.querySelector<HTMLElement>("#film-font");
const fontSource = font?.dataset.source;
if (!canvas || !play || !slider || !clock || !status || !image || !fontSource) throw new Error("The film preview is missing its controls or assets.");
const context = canvas.getContext("2d");
if (!context) throw new Error("This browser cannot draw the film.");
const view = { canvas, play, slider, clock, status, context, image, fontSource };
let frame = 375;
let playing = false;
let started = false;
let animationFrame = 0;
let startTime = 0;
let startFrame = 0;

async function start() {
  const assets = await loadFilmAssets(view.image.src, view.fontSource);
  const durationInFrames = FILM.fps * FILM.seconds;
  view.play.disabled = false;
  view.status.textContent = "30-second direction study. Silent. Procedural imagery and custom letter animation, authored in TypeScript.";

  function draw() {
    renderFrame(view.context, frame, assets);
    view.slider.value = String(frame);
    view.clock.value = `0:${String(Math.floor(frame / FILM.fps)).padStart(2, "0")} / 0:30`;
    document.querySelectorAll<HTMLButtonElement>("[data-frame]").forEach(button => {
      const second = frame / FILM.fps;
      button.setAttribute("aria-pressed", String(second >= Number(button.dataset.frame) / 30 && second < Number(button.dataset.frame) / 30 + 5));
    });
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(animationFrame);
    view.play.textContent = frame === durationInFrames - 1 ? "Replay" : "Play";
  }

  function seek(next: number) {
    pause(); started = true;
    frame = Math.max(0, Math.min(durationInFrames - 1, Math.round(next)));
    draw();
  }

  function tick(now: number) {
    if (!playing) return;
    frame = Math.min(durationInFrames - 1, startFrame + Math.floor((now - startTime) / 1000 * FILM.fps));
    draw();
    if (frame >= durationInFrames - 1) pause();
    else animationFrame = requestAnimationFrame(tick);
  }

  view.play.addEventListener("click", () => {
    if (playing) { pause(); return; }
    if (!started || frame >= durationInFrames - 1) frame = 0;
    started = true; playing = true;
    startTime = performance.now(); startFrame = frame;
    view.play.textContent = "Pause";
    animationFrame = requestAnimationFrame(tick);
  });
  view.slider.addEventListener("input", () => seek(Number(view.slider.value)));
  document.querySelectorAll<HTMLButtonElement>("[data-frame]").forEach(button => button.addEventListener("click", () => seek(Number(button.dataset.frame))));
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  document.querySelectorAll<HTMLCanvasElement>("[data-still]").forEach(still => {
    const ctx = still.getContext("2d");
    if (ctx) renderFrame(ctx, Number(still.dataset.still), assets);
  });
  document.querySelector("#chapters")?.setAttribute("aria-label", chapters.map(chapter => chapter.name).join(", "));
  window.chillFilm = { seek, durationInFrames };
  draw();
}

start().catch((error: unknown) => {
  view.status.textContent = error instanceof Error ? error.message : "The film assets could not load.";
  view.status.setAttribute("role", "alert");
});
