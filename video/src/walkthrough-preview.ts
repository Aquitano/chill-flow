import { unpackRecording } from "./recording";
import { chapters, FILM, MUSIC_START, RAIN_START, loadWalkthroughAssets, musicLevel, rainLevel, renderFrame } from "./walkthrough";

declare global {
  interface Window {
    chillWorld: { seek: (frame: number) => void; state: () => { frame: number; playing: boolean; sound: boolean } };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#film");
const play = document.querySelector<HTMLButtonElement>("#play");
const sound = document.querySelector<HTMLButtonElement>("#sound");
const slider = document.querySelector<HTMLInputElement>("#scrub");
const clock = document.querySelector<HTMLOutputElement>("#clock");
const status = document.querySelector<HTMLElement>("#status");
const recording = document.querySelector<HTMLScriptElement>("#recording")?.textContent;
const terminalFont = document.querySelector<HTMLElement>("#terminal-font")?.dataset.source;
const font = document.querySelector<HTMLElement>("#font")?.dataset.source;
const music = document.querySelector<HTMLAudioElement>("#music");
const rain = document.querySelector<HTMLAudioElement>("#rain");
if (!canvas || !play || !sound || !slider || !clock || !status || !recording || !terminalFont || !font || !music || !rain) throw new Error("The film is missing its controls or assets.");
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas is unavailable.");
const view = { canvas, play, sound, slider, clock, status, recording, terminalFont, font, music, rain, context };
let frame = 630;
let playing = false;
let started = false;
let enabled = true;
let animation = 0;
let origin = 0;
let originFrame = 0;

async function start() {
  const packed = Uint8Array.from(atob(view.recording), character => character.charCodeAt(0));
  const recordingBuffer = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const assets = await loadWalkthroughAssets(unpackRecording(recordingBuffer), view.font, view.terminalFont);
  const audio = [
    { element: view.music, starts: MUSIC_START, level: musicLevel },
    { element: view.rain, starts: RAIN_START, level: rainLevel },
  ];

  function syncAudio() {
    for (const { element, starts, level } of audio) {
      element.muted = !enabled;
      element.volume = level(frame);
      const active = playing && enabled && frame >= starts * 30 && frame < 899;
      const offset = Number(element.dataset.offset || 0);
      const position = Math.max(0, frame / 30 - starts) + offset;
      if (Math.abs(element.currentTime - position) > .3 && element.readyState > 0) element.currentTime = position;
      if (active && element.paused) element.play().catch(() => {
        view.status.textContent = "The visuals are ready. Audio playback is unavailable here; the MP4 includes the mix.";
      });
      if (!active && !element.paused) element.pause();
    }
  }

  function draw() {
    renderFrame(view.context, frame, assets);
    view.slider.value = String(frame);
    view.clock.value = `${(frame / 30).toFixed(1)} / 30s`;
    view.play.textContent = playing ? "Pause" : frame >= 899 ? "Replay" : started ? "Play" : "Play from start";
    view.sound.textContent = enabled ? "Sound on" : "Sound off";
    view.sound.setAttribute("aria-pressed", String(enabled));
    document.querySelectorAll<HTMLButtonElement>("[data-frame]").forEach((button, index) => {
      const active = frame >= chapters[index].second * 30 && frame < (chapters[index + 1]?.second ?? 30) * 30;
      button.setAttribute("aria-pressed", String(active));
    });
    syncAudio();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(animation);
    for (const track of audio) track.element.pause();
  }

  function seek(next: number) {
    pause(); started = true;
    frame = Math.max(0, Math.min(899, Math.round(next)));
    draw();
  }

  function tick(now: number) {
    if (!playing) return;
    frame = Math.min(899, originFrame + Math.floor((now - origin) / 1000 * 30));
    if (frame >= 899) pause();
    draw();
    if (playing) animation = requestAnimationFrame(tick);
  }

  view.play.addEventListener("click", () => {
    if (playing) { pause(); draw(); return; }
    if (!started || frame >= 899) frame = 0;
    started = true; playing = true;
    origin = performance.now(); originFrame = frame;
    draw();
    animation = requestAnimationFrame(tick);
  });
  view.sound.addEventListener("click", () => { enabled = !enabled; draw(); });
  view.slider.addEventListener("input", () => seek(Number(view.slider.value)));
  document.querySelectorAll<HTMLButtonElement>("[data-frame]").forEach(button => button.addEventListener("click", () => seek(Number(button.dataset.frame))));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); draw(); } });
  view.play.disabled = false;
  view.sound.disabled = false;
  view.status.textContent = "30 seconds. A scripted walkthrough rendered by the app. Sound on.";
  window.chillWorld = { seek, state: () => ({ frame, playing, sound: enabled }) };
  draw();
  document.querySelector("#initial-poster")?.remove();
}

start().catch((error: unknown) => {
  view.status.textContent = error instanceof Error ? error.message : "The film assets could not load.";
  view.status.setAttribute("role", "alert");
});
