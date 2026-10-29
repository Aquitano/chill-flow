import { unpackRecording } from "../../src/recording";
import { loadWalkthroughAssets } from "../../src/walkthrough";
import { drawPrototype, filmTime, musicLevel, rainLevel, variants, type VariantId } from "./motion";

declare global {
  interface Window {
    timingReview: { seek: (id: VariantId, second: number) => void; state: () => { variant: VariantId; frame: number; playing: boolean } };
  }
}
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const ctx = canvas.getContext("2d")!;
const play = document.querySelector<HTMLButtonElement>("#play")!;
const scrub = document.querySelector<HTMLInputElement>("#scrub")!;
const clock = document.querySelector<HTMLOutputElement>("output")!;
const sound = document.querySelector<HTMLButtonElement>("#sound")!;
const music = document.querySelector<HTMLAudioElement>("#music")!;
const rain = document.querySelector<HTMLAudioElement>("#rain")!;
const effects = document.querySelector<HTMLAudioElement>("#effects")!;
const status = document.querySelector<HTMLElement>("#status")!;
const data = document.querySelector<HTMLScriptElement>("#recording")!.textContent!;
const font = document.querySelector<HTMLElement>("#font")!.dataset.source!;
const terminal = document.querySelector<HTMLElement>("#terminal")!.dataset.source!;
const packed = Uint8Array.from(atob(data), character => character.charCodeAt(0));
const buffer = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
const assets = await loadWalkthroughAssets(unpackRecording(buffer), font, terminal);
let variant: typeof variants[number] = variants[0];
let frame = 0, playing = false, enabled = true, origin = 0, originFrame = 0, animation = 0;
function draw() {
  drawPrototype(ctx, frame, assets, variant);
  scrub.max = String(variant.seconds * 30 - 1);
  scrub.value = String(frame);
  clock.value = `${(frame / 30).toFixed(1)} / ${variant.seconds}s`;
  play.textContent = playing ? "Pause" : frame >= variant.seconds * 30 - 1 ? "Replay" : "Play";
  sound.textContent = enabled ? "Sound on" : "Sound off";
  sound.setAttribute("aria-pressed", String(enabled));
  for (const [element, starts, level] of [
    [music, filmTime(variant, 1.8), musicLevel],
    [rain, filmTime(variant, 9.2), rainLevel],
    [effects, 0, () => variant.id === "ChillFilm" ? 1 : 0],
  ] as const) {
    const position = Math.max(0, frame / 30 - starts);
    element.volume = level(frame, variant); element.muted = !enabled;
    if (element.readyState && Math.abs(element.currentTime - position) > .25) element.currentTime = position;
    if (playing && enabled && frame / 30 >= starts) {
      if (element.paused) element.play().catch(() => { status.textContent = "The MP4 files include the audio mix."; });
    } else element.pause();
  }
}
function pause() { playing = false; cancelAnimationFrame(animation); music.pause(); rain.pause(); effects.pause(); }
function seek(id: VariantId, second: number) {
  pause(); variant = variants.find(option => option.id === id)!;
  frame = Math.min(variant.seconds * 30 - 1, Math.max(0, Math.round(second * 30)));
  document.querySelectorAll<HTMLButtonElement>("[data-variant]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.variant === id)));
  status.textContent = variant.description; draw();
}
function tick(now: number) {
  if (!playing) return;
  frame = Math.min(variant.seconds * 30 - 1, originFrame + Math.floor((now - origin) * .03));
  if (frame === variant.seconds * 30 - 1) pause();
  draw(); if (playing) animation = requestAnimationFrame(tick);
}
play.onclick = () => {
  if (playing) { pause(); draw(); return; }
  if (frame >= variant.seconds * 30 - 1) frame = 0;
  playing = true; origin = performance.now(); originFrame = frame; draw(); animation = requestAnimationFrame(tick);
};
scrub.oninput = () => seek(variant.id, Number(scrub.value) / 30);
sound.onclick = () => { enabled = !enabled; draw(); };
document.querySelectorAll<HTMLButtonElement>("[data-variant]").forEach(button => {
  button.onclick = () => { const option = variants.find(value => value.id === button.dataset.variant); if (option) seek(option.id, 0); };
});
document.querySelectorAll<HTMLButtonElement>("[data-source]").forEach(button => {
  button.onclick = () => seek(variant.id, filmTime(variant, Number(button.dataset.source)));
});
document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); draw(); } });
window.timingReview = { seek, state: () => ({ variant: variant.id, frame, playing }) };
play.disabled = false; seek(variant.id, 0);
