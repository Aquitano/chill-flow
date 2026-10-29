import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {AbsoluteFill, Composition, cancelRender, continueRender, delayRender, registerRoot, staticFile, useCurrentFrame} from "remotion";
import {drawFrame, fontFaces, meta, type PrototypeAssets} from "./motion";

function loadImage(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${file}`));
    image.src = staticFile(file);
  });
}

function Film() {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender("Loading local images and fonts"));
  const [assets, setAssets] = useState<PrototypeAssets | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      loadImage("assets/ui.png"),
      loadImage("assets/landscape.png"),
      ...fontFaces.map(async font => {
        const face = await new FontFace(font.family, `url(${staticFile(font.file)})`, {weight: font.family === "Geist" ? "500" : "400"}).load();
        document.fonts.add(face);
      }),
    ]).then(([ui, landscape]) => {
      if (active) setAssets({ui, landscape});
    }).catch(error => {
      cancelRender(error);
    });
    return () => { active = false; };
  }, [handle]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (assets && ctx) {
      drawFrame(ctx, frame, assets);
      continueRender(handle);
    }
  }, [assets, frame, handle]);
  return <AbsoluteFill><canvas ref={canvas} width={meta.width} height={meta.height}/></AbsoluteFill>;
}

registerRoot(() => <Composition id={meta.id} component={Film} durationInFrames={meta.seconds * meta.fps} fps={meta.fps} width={meta.width} height={meta.height}/>);
