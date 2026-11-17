import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { packRecording } from "./src/recording";
import type { Recording } from "./src/walkthrough";

const root = import.meta.dir;
const result = await Bun.build({ entrypoints: [join(root, "src/walkthrough-preview.ts")], target: "browser", minify: true });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const dataFont = async (name: string) => `data:font/woff2;base64,${Buffer.from(await Bun.file(join(root, "assets", name)).arrayBuffer()).toString("base64")}`;
const script = await result.outputs[0].text();
const template = await Bun.file(join(root, "src/walkthrough-template.html")).text();
const recording = await Bun.file(join(root, "assets/walkthrough.json")).text();
const html = template
  .replace("__FONT__", await dataFont("Manrope-film.woff2"))
  .replace("__TERMINAL_FONT__", await dataFont("Terminal.woff2"))
  .replace("__RECORDING__", gzipSync(packRecording(JSON.parse(recording) as Recording), { level: 9 }).toString("base64"))
  .replace("/* WORLD_SCRIPT */", script.replaceAll("</script", "<\\/script"));
await Bun.write(join(root, "walkthrough.html"), html);
for (const [source, target] of [
  ["assets/walkthrough.json", "public/walkthrough.json"],
  ["assets/Manrope-film.woff2", "public/fonts/Manrope-film.woff2"],
  ["assets/Terminal.woff2", "public/fonts/Terminal.woff2"],
  ["assets/music.mp3", "public/audio/music.mp3"],
  ["assets/rain.mp3", "public/audio/rain.mp3"],
]) await Bun.write(join(root, target), Bun.file(join(root, source)));
console.log("Built walkthrough.html and prepared the Remotion assets.");
