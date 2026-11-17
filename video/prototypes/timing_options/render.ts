import { resolve } from "node:path";
import { variants } from "./motion";

const root = resolve(import.meta.dir, "../..");
for (const variant of variants) {
  const output = variant.id === "ChillFilm" ? "chill-refined" : variant.id;
  const process = Bun.spawn([
    resolve(root, "node_modules/.bin/remotion"), "render",
    "prototypes/timing_options/index.tsx", variant.id, `out/${output}.mp4`,
    "--codec", "h264", "--crf", "18", ...Bun.argv.slice(2), "--concurrency", "1",
  ], { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await process.exited;
  if (code !== 0) throw new Error(`${variant.id} render failed with exit code ${code}`);
}
