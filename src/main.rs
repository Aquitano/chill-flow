mod audio;

fn main() {
    let _engine = audio::Engine::start(std::env::temp_dir());
}
