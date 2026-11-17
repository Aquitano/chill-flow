import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Html5Audio, Sequence, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { FILM, loadWorldAssets, musicLevel, rainLevel, renderFrame, type WorldAssets } from "./world";

export function WorldFilm() {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const continued = useRef(false);
  const [handle] = useState(() => delayRender("Load the raster film's font and real UI captures"));
  const [assets, setAssets] = useState<WorldAssets | null>(null);

  useEffect(() => {
    let mounted = true;
    loadWorldAssets(staticFile("ui-film.svg"), staticFile("landscape.png"), staticFile("journey.png"), staticFile("fonts/Manrope-film.woff2"))
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

  return <AbsoluteFill style={{ background: "#f7f8f9" }}>
    <canvas ref={canvas} width={FILM.width} height={FILM.height} />
    <Sequence from={120} durationInFrames={780} layout="none" name="Lo-fi enters">
      <Html5Audio src={staticFile("audio/music.mp3")} volume={local => musicLevel(local + 120)} />
    </Sequence>
    <Sequence from={270} durationInFrames={630} layout="none" name="Rain enters">
      <Html5Audio src={staticFile("audio/rain.mp3")} volume={local => rainLevel(local + 270)} />
    </Sequence>
  </AbsoluteFill>;
}
