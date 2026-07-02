# Product

## Register

product

## Users

People doing focused knowledge work — students, developers, writers, anyone who reaches for lo-fi or ambient sound to settle into deep work. They arrive wanting to *start*, not to configure. Context is a laptop or desktop work session, often for a stretch of time, frequently returning day to day. They want their setup (sound, timer, tasks, background) to be there waiting when they come back.

The job to be done: enter and hold a flow state. Pick a soundscape, run a reliable focus or Pomodoro timer, keep a short list of tasks in view, and see honest progress over time — all without the tool itself becoming a distraction.

## Product Purpose

ChillFlow combines lo-fi beats and ambient sound with a focus timer and lightweight task management into one calm workspace. It exists to make starting deep work frictionless and to make focus sustainable across sessions.

The core loop the product must prove: sign in → start a focus session → audio plays reliably → track a small set of tasks → session completion is recorded accurately → return later to saved preferences and basic progress. Success is a user who opens ChillFlow by reflex when it's time to concentrate, and trusts that their sound, timer, and progress are exactly where they left them.

The authenticated `/app` workspace is the product. The marketing landing (`/`) exists to explain the product truthfully and funnel visitors into auth — it is a means to the workspace, not the destination.

## Brand Personality

Calm, focused, atmospheric.

Voice is quiet and grounded — a good studio, not a hype machine. The interface sets a mood (dark, warm-tinted, soft-glowing, grainy) that supports concentration, then gets out of the way. Emotional goal: a settled, unhurried readiness to work. Never loud, never demanding attention for itself; the sound and the task are the point, the UI is the room they happen in.

## Anti-references

- **Neon synthwave / gamer lo-fi.** No purple-pink gradients, glitch effects, or retro-anime motifs. That is the saturated cliche of the lo-fi genre and reads as costume, not calm.
- **Busy SaaS dashboard.** No dense KPI cards, crowded sidebars, notification badges, or chart walls. Density is the enemy of focus.
- **Generic startup landing.** No hero-metric templates, no uppercase tracked eyebrow kickers above every section, no grid of identical icon-heading-text feature cards.

Related trap to steer clear of even though it wasn't the primary concern: gamified habit-tracker energy (streak confetti, badges, mascots, dopamine loops). Progress should feel honest and quiet, not like a game nagging for engagement.

## Design Principles

- **The work is the star, not the UI.** Every surface should recede in favor of the sound and the task. When a choice is between more interface and more calm, choose calm.
- **Atmosphere is functional, not decoration.** Dark mood, grain, soft glow, and motion earn their place by helping users drop into focus. They must never cost legibility, contrast, or performance to do it.
- **Only show what's real.** Never advertise a feature that doesn't work yet (no fake presets, no vanity analytics). A truthful, smaller surface beats an impressive, hollow one — this runs through the whole MVP.
- **Desktop-first, unbroken everywhere.** The focus loop is tuned for a laptop work session; narrow viewports must stay usable and free of layout breakage even when they aren't the priority.
- **Feedback is visible but quiet.** Timer state, playback, preference saves, and failures are always surfaced (inline or as gentle toasts) and never jarring, alarmist, or silent.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Body text holds ≥4.5:1 contrast and large text ≥3:1 — a real discipline against the dark, warm-tinted palette, where muted grays on near-black are the easy failure. Honor `prefers-reduced-motion` on every animation (the app leans heavily on Framer Motion for entrances, background crossfades, and player transitions); reduced-motion users get a crossfade or instant state instead of movement. Icon-only controls (player, timer, task actions) carry accessible names. Keep the experience fully keyboard-operable.
