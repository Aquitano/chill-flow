# Render the timing options

Run these commands from `video/`.

1. Check the TypeScript sources:

   ```sh
   bun run check:timing
   ```

2. Render the refined 22-second cut:

   ```sh
   bun run render:film
   ```

   This writes `out/chill-refined.mp4`. To render the refined cut and all three earlier alternatives sequentially, run:

   ```sh
   bun run render:timing
   ```

   The script waits for each render to exit before starting the next. Every render uses `--concurrency 1`. It stops if a render fails.

   To use an existing Chrome executable, pass its path:

   ```sh
   bun run render:timing --browser-executable=/absolute/path/to/chrome-headless-shell
   ```

3. Open `out/chill-refined.mp4`. The earlier alternatives are `out/QuickRaster.mp4`, `out/AppFirst.mp4`, and `out/TerminalLaunch.mp4`.

To compare the cuts without exporting MP4s, run `bun run build:timing` and open `timing-options.html`. Keep the `assets/` and `public/` directories beside the HTML file for audio playback.

Edit the opening, camera moves, and feature captions in `motion.ts`. Edit the refined cut's timing and end-card animation in `refined.ts`.

The build generates the typography clicks and settling tones from `sound.ts`. Their timing follows the raster-letter animation in the opening and ending.

After changing the app UI or scripted inputs, regenerate the recording from the repository root:

```sh
cargo test --offline -p chill ui::review::walkthrough::export_edit_walkthrough -- --ignored --exact --nocapture
```

The recording uses the app's input handlers and renderer with offline data. The YouTube segment shows pasting a link into the dialog. It does not submit the link or fetch a stream.
