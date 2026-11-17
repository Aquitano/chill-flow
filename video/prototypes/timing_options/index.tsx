import { Composition, registerRoot } from "remotion";
import { TimingFilm } from "./Film";
import { variants } from "./motion";

function Root() {
  return <>{variants.map(variant => <Composition key={variant.id} id={variant.id} component={TimingFilm}
    defaultProps={{ variant: variant.id }} width={1920} height={1080} fps={30} durationInFrames={variant.seconds * 30} />)}</>;
}
registerRoot(Root);
