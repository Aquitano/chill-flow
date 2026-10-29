import { Composition } from "remotion";
import { WalkthroughFilm } from "./WalkthroughFilm";
import { FILM } from "./walkthrough";

export function Root() {
  return <Composition id="AppWalkthrough" component={WalkthroughFilm} width={FILM.width} height={FILM.height}
    fps={FILM.fps} durationInFrames={FILM.seconds * FILM.fps} />;
}
