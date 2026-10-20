# chill

A terminal player for focused work. It plays lo-fi from your own R2 bucket or from YouTube, layers ambient sound underneath, and runs a focus timer that keeps track of the time you actually spent focusing. It ships as one binary for macOS and Windows.

## Install

Install the Rust toolchain from [rustup.rs](https://rustup.rs), plus the tools chill drives:

| Tool | What chill uses it for | macOS | Windows |
| --- | --- | --- | --- |
| ffmpeg | decoding every stream | `brew install ffmpeg` | `winget install Gyan.FFmpeg` |
| yt-dlp and deno | resolving YouTube links | `brew install yt-dlp deno` | `winget install yt-dlp.yt-dlp DenoLand.Deno` |

Then:

```bash
cargo install --git https://github.com/Aquitano/chill-flow
```

On Windows the Rust toolchain also needs the Visual Studio C++ build tools. After a winget install, open a new terminal so the tools are on `PATH`. `chill doctor` checks that all three are found and prints where chill keeps its config, library, and cache. YouTube changes often enough that an old yt-dlp stops working, so chill mentions it at startup once your yt-dlp is more than 60 days old; update it with `brew upgrade yt-dlp` or `winget upgrade yt-dlp.yt-dlp`.

## Use

`chill` opens with your last scene loaded and paused. Space starts the music, the ambience, and the timer together.

```bash
chill                                   # resume where you left off
chill https://youtu.be/…                # play a video, playlist, or live stream
chill "rainy study"                     # load a saved scene
chill doctor                            # check ffmpeg, yt-dlp, and deno
```

Paste a YouTube link anywhere in the app to add it to the library and play it. Everything responds to the mouse: click rows and buttons, drag the sliders, scroll the lists. Press `?` for every key, or `ctrl+p` to search all commands.

| Key | Does |
| --- | --- |
| `space` | play or pause everything |
| `n` / `p` | next / previous |
| `f` | like what's playing |
| `<` / `>` | turn the music or the ambience up against the other |
| `t` / `T` | start or pause the timer / reset it |
| `o` | open a YouTube link |
| `c` | settings |
| `tab` | move between library, queue, and ambience |
| `enter` / `a` | play the selection / add it to the queue |

The library has five tabs. Tracks come from the catalog. Liked holds what you liked. YouTube holds every link you opened. Sounds holds the ambience mixes, which play on their own without music. Scenes holds saved setups of source, ambience, balance, and timer.

The slider between music and ambience at the top of the Ambience panel turns one down against the other, for a loud stream or quiet rain, without touching the volume. A soundscape has no music, so the balance leaves it alone.

Focus stats count every minute a focus block ran, including blocks you stopped early. Breaks never count. The header shows today's total and a seven-day sparkline; press `i` for the chart.

## Catalog

`catalog.json` lists the R2 tracks, the ambient sounds, and the built-in mixes. chill reads it from `catalog_url`, keeps the last copy it fetched for offline starts, and falls back to the copy compiled into the binary from this repository. File names resolve against the folder the catalog sits in.

To add a track, upload the MP3 (and optionally a cover image) to the bucket, add an entry to `catalog.json`, and upload the catalog next to it:

```json
{ "id": "night-drive-01", "title": "Night Drive", "artist": "…", "file": "night-drive.mp3", "cover": "cover-night-drive.png", "durationSec": 184, "tags": ["focus"] }
```

## Configuration

Press `c` for settings: timer lengths, auto-start, the chime, notifications, and reduced motion. Changes save to `config.toml` right away, keeping anything else you wrote in it. The file is optional and lives in `~/.config/chill/` on macOS and `%APPDATA%\chill\` on Windows. These are the defaults:

```toml
catalog_url = "https://chill-data.aquitano.me/catalog.json"
reduce_motion = false   # true turns off transitions and the visualizer
chime = true            # a soft bell when a focus block or break ends
notifications = true    # an OS notification at the same moments

[pomodoro]
focus_minutes = 25
break_minutes = 5
long_break_minutes = 15
long_break_every = 4
auto_start_breaks = true
auto_start_focus = true
```

The library, likes, scenes, mixes, focus history, and the resume point live in `chill.db`. That file sits in `~/.local/share/chill/` on macOS and `%APPDATA%\chill\` on Windows. Cached ambient loops and the catalog go to `~/.cache/chill/` or `%LOCALAPPDATA%\chill\`.

## Development

```bash
cargo run
cargo test
cargo clippy --all-targets -- -D warnings
```

On Linux the build needs `libasound2-dev`. CI runs the checks on Linux, macOS, and Windows.

## Ambient recordings

| Sound | Source | License |
| --- | --- | --- |
| Rain, Rain on roof, Thunder, Fire | USC Cinema / Sunset Editorial Collection | CC0 1.0 |
| Wind | Tvabutzku1234 | CC0 1.0 |
| Birds | ezwa | Public domain |
| Stream | Juandev | Public domain |
| Waves | Dsw4 | Public domain |
| Café | Stephan (pdsounds.org) | Public domain |
| Crickets | Serg Childed | CC BY-SA 4.0 (the trimmed loop is an adaptation and stays BY-SA) |
