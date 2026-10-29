import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { FILM, loadFilmAssets, renderFrame, type FilmAssets } from "./art";

export function Film() {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender("Load the film's font and product image"));
  const [assets, setAssets] = useState<FilmAssets | null>(null);
  const continued = useRef(false);

  useEffect(() => {
    let mounted = true;
    loadFilmAssets(staticFile("ui.png"), staticFile("fonts/LibreCaslonDisplay-Regular.ttf"))
      .then(loaded => { if (mounted) setAssets(loaded); })
      .catch(cancelRender);
    return () => { mounted = false; };
  }, []);

  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !assets) return;
    renderFrame(context, frame, assets);
    if (!continued.current) {
      continueRender(handle);
      continued.current = true;
    }
  }, [assets, frame, handle]);

  return <AbsoluteFill style={{ background: "#0a100e" }}>
    <canvas ref={canvas} width={FILM.width} height={FILM.height} />
  </AbsoluteFill>;
}
