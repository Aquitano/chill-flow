# Product

## Users

People doing focused knowledge work, mostly developers, who reach for lo-fi or ambient sound to settle into deep work and already live in a terminal. They want to *start*, not to configure. Context is a laptop or desktop work session, often for a stretch of time, frequently returning day to day. They want their setup (sound, ambience, timer) to be there waiting when they come back.

The job to be done: enter and hold a flow state. Start a soundscape, run a reliable focus or Pomodoro timer, and see honest progress over time, all without the tool itself becoming a distraction or another window to manage.

## Product Purpose

chill combines lo-fi music, ambient sound, and a focus timer in one terminal app. It exists to make starting deep work a keypress or two, with no setup, and to make focus sustainable across sessions. Listening without a timer is just as valid a use.

Playback, timer operation, and panel visibility are independent.

The core loop: typing `chill` loads the last scene, Space starts music and ambience, `t` starts the focus timer, focus blocks are recorded accurately, and next time everything is exactly where it was left. Success is a user who opens chill by reflex when it's time to concentrate.

Music comes from the owner's R2 bucket (listed by `catalog.json`) and from YouTube links, which are saved to the library on first use. Everything else lives in a local SQLite file; there are no accounts and no server.

## Brand Personality

Calm, focused, atmospheric.

Voice is quiet and grounded, a good studio rather than a hype machine. The interface takes its colors from the terminal theme, adds soft motion, then gets out of the way. Emotional goal: a settled, unhurried readiness to work. The sound and the task are the point; the UI is the room they happen in.

## Anti-references

- **Neon synthwave / gamer lo-fi.** No purple-pink gradients, glitch effects, or retro-anime motifs.
- **Busy dashboard density.** No walls of panels, counters, or charts. Density is the enemy of focus.
- **Gamified habit tracking.** No streak confetti, badges, or dopamine loops. Progress should feel honest and quiet.

## Design Principles

- **The work is the star, not the UI.** When a choice is between more interface and more calm, choose calm.
- **Atmosphere is functional, not decoration.** Motion and the visualizer earn their place by helping users drop into focus. They must never cost legibility or idle CPU.
- **Only show what's real.** Never surface a feature that doesn't work. Stats count minutes a focus block actually ran.
- **Wide terminal first, unbroken when narrow.** The layout is tuned for a full-screen terminal; smaller windows drop panels rather than break.
- **Feedback is visible but quiet.** Playback, timer boundaries, and failures always surface as gentle toasts, never silently and never alarmingly.
- **Keyboard and mouse are both first-class.** Every action has a key, and everything visible can be clicked.

## Accessibility & Inclusion

Colors derive from the terminal's own foreground, background, and ANSI palette, so contrast follows the theme the user chose. Muted text must stay readable against both dark and light themes. `reduce_motion = true` in `config.toml` turns every transition into an instant state change and hides the visualizer.
