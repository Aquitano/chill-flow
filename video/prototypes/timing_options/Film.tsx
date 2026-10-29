import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Html5Audio, Sequence, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { loadWalkthroughAssets, type WalkthroughAssets } from "../../src/walkthrough";
import { drawPrototype, filmTime, musicLevel, rainLevel, variantById, type VariantId } from "./motion";

export function TimingFilm({ variant: id }: { variant: VariantId }) {
  const frame = useCurrentFrame();
  const variant = variantById(id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender("Load recorded app and fonts"));
  const continued = useRef(false);
  const [assets, setAssets] = useState<WalkthroughAssets | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch(staticFile("feature-walkthrough.json")).then(response => response.text())
      .then(recording => loadWalkthroughAssets(recording, staticFile("fonts/Manrope-film.woff2"), staticFile("fonts/Terminal.woff2")))
      .then(loaded => { if (mounted) setAssets(loaded); }).catch(cancelRender);
    return () => { mounted = false; };
  }, []);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !assets) return;
    drawPrototype(ctx, frame, assets, variant);
    if (!continued.current) { continueRender(handle); continued.current = true; }
  }, [frame, assets, variant, handle]);
  const music = Math.round(filmTime(variant, 1.8) * 30);
  const rain = Math.round(filmTime(variant, 9.2) * 30);
  return <AbsoluteFill style={{ background: "#1e1e2e" }}>
    <canvas ref={canvas} width={1920} height={1080} />
    {id === "ChillFilm" && <Html5Audio src={staticFile("audio/type.wav")} />}
    <Sequence from={music} durationInFrames={variant.seconds * 30 - music} layout="none">
      <Html5Audio src={staticFile("audio/music.mp3")} volume={local => musicLevel(local + music, variant)} />
    </Sequence>
    <Sequence from={rain} durationInFrames={variant.seconds * 30 - rain} layout="none">
      <Html5Audio src={staticFile("audio/rain.mp3")} volume={local => rainLevel(local + rain, variant)} />
    </Sequence>
  </AbsoluteFill>;
}
