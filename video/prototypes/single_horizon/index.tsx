import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {cancelRender, Composition, continueRender, delayRender, registerRoot, staticFile, useCurrentFrame} from 'remotion';
import {drawFrame, fontFaces, meta, type PrototypeAssets} from './motion';

function Film() {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender('Loading local screenshots and font'));
  const [assets, setAssets] = useState<PrototypeAssets>();
  useEffect(() => {
    let active = true;
    const loadImage = async (file: string) => {
      const image = new Image();
      image.src = staticFile(file);
      await image.decode();
      return image;
    };
    Promise.all([
      loadImage('assets/ui.png'),
      loadImage('assets/landscape.png'),
      ...fontFaces.map(async font => {
        const face = new FontFace(font.family, `url(${staticFile(font.file.replace('public/', ''))})`, {weight: '700'});
        document.fonts.add(await face.load());
      }),
    ]).then(([ui, landscape]) => {
      if (active) {setAssets({ui, landscape}); continueRender(handle);}
    }).catch(cancelRender);
    return () => {active = false;};
  }, [handle]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx && assets) drawFrame(ctx, frame, assets);
  }, [frame, assets]);
  return <canvas ref={canvas} width={meta.width} height={meta.height} style={{width: '100%', height: '100%'}} />;
}
registerRoot(() => <Composition id={meta.id} component={Film} width={meta.width} height={meta.height} fps={meta.fps} durationInFrames={meta.seconds * meta.fps} />);
