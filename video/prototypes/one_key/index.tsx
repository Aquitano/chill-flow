import React, {useLayoutEffect, useRef, useState} from "react";
import {Composition, registerRoot, useCurrentFrame, delayRender, continueRender, cancelRender, staticFile} from "remotion";
import {drawFrame, fontFaces, meta, type PrototypeAssets} from "./motion";

function Film() {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender("Load film assets"));
  const [assets, setAssets] = useState<PrototypeAssets | null>(null);
  useLayoutEffect(() => {
    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`Cannot load ${src}`)); image.src = staticFile(src.replace(/^assets\//, ""));
    });
    Promise.all([
      loadImage("assets/ui.png"), loadImage("assets/landscape.png"),
      ...fontFaces.map(async face => { const font = await new FontFace(face.family, `url(${staticFile(face.file.replace(/^assets\//, ""))})`).load(); document.fonts.add(font); }),
    ]).then(([ui, landscape]) => {setAssets({ui, landscape}); continueRender(handle);}).catch(cancelRender);
  }, [handle]);
  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context && assets) drawFrame(context, frame, assets);
  }, [frame, assets]);
  return <canvas ref={canvas} width={meta.width} height={meta.height} style={{width: "100%", height: "100%"}}/>;
}
function Root() {return <Composition id={meta.id} component={Film} durationInFrames={meta.seconds * meta.fps} fps={meta.fps} width={meta.width} height={meta.height}/>;}
registerRoot(Root);
