import {useLayoutEffect, useRef, useState} from "react";
import {AbsoluteFill, Composition, cancelRender, continueRender, delayRender, registerRoot, staticFile, useCurrentFrame} from "remotion";
import {drawFrame, fontFaces, meta, type PrototypeAssets} from "./motion";

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${path}`));
    image.src = staticFile(path);
  });
}

function Film() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender("Loading film assets"));
  const [assets, setAssets] = useState<PrototypeAssets | null>(null);
  useLayoutEffect(() => {
    let cancelled = false;
    Promise.all([
      loadImage("ui.png"), loadImage("landscape.png"),
      Promise.all(fontFaces.map(async ({family, file}) => {
        const font = new FontFace(family, `url("${staticFile(file.replace("assets/", ""))}")`, {weight: "200 800"});
        document.fonts.add(await font.load());
      })),
    ]).then(([ui, landscape]) => {
      if (!cancelled) {
        setAssets({ui, landscape});
      }
    }).catch((error: unknown) => cancelRender(error));
    return () => {cancelled = true;};
  }, []);
  useLayoutEffect(() => {
    if (!assets || !canvas.current) return;
    const context = canvas.current.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");
    drawFrame(context, frame, assets);
    continueRender(handle);
  }, [assets, frame, handle]);
  return <AbsoluteFill><canvas ref={canvas} width={meta.width} height={meta.height} /></AbsoluteFill>;
}

registerRoot(() => <Composition id={meta.id} component={Film} width={meta.width} height={meta.height} fps={meta.fps} durationInFrames={meta.seconds * meta.fps} />);
