import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Html5Audio, Sequence, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { FILM, MUSIC_START, RAIN_START, loadWalkthroughAssets, musicLevel, rainLevel, renderFrame, type WalkthroughAssets } from "./walkthrough";

export function WalkthroughFilm() {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const continued = useRef(false);
  const [handle] = useState(() => delayRender("Load the raster film's font and real UI captures"));
  const [assets, setAssets] = useState<WalkthroughAssets | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(staticFile("walkthrough.json"))
      .then(response => response.text())
      .then(recording => loadWalkthroughAssets(recording, staticFile("fonts/Manrope-film.woff2"), staticFile("fonts/Terminal.woff2")))
      .then(loaded => { if (mounted) setAssets(loaded); })
      .catch(cancelRender);
    return () => { mounted = false; };
  }, []);

  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !assets) return;
    renderFrame(ctx, frame, assets);
    if (!continued.current) { continueRender(handle); continued.current = true; }
  }, [frame, assets, handle]);

  return <AbsoluteFill style={{ background: "#1e1e2e" }}>
    <canvas ref={canvas} width={FILM.width} height={FILM.height} />
    <Sequence from={Math.round(MUSIC_START * 30)} durationInFrames={900 - Math.round(MUSIC_START * 30)} layout="none" name="Lo-fi enters">
      <Html5Audio src={staticFile("audio/music.mp3")} volume={local => musicLevel(local + MUSIC_START * 30)} />
    </Sequence>
    <Sequence from={Math.round(RAIN_START * 30)} durationInFrames={900 - Math.round(RAIN_START * 30)} layout="none" name="Rain enters">
      <Html5Audio src={staticFile("audio/rain.mp3")} volume={local => rainLevel(local + RAIN_START * 30)} />
    </Sequence>
  </AbsoluteFill>;
}
