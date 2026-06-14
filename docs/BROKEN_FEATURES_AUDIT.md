# ChillFlow — Broken Features Audit & Value Plan

> Generated from a multi-agent audit (7 subsystem finders + adversarial verification).
> 40 findings confirmed, 2 refuted. Build, lint, and the unit tests all pass — every
> issue below is a **runtime / feature-completeness** problem, not a compile error.

> **Progress:** Tier 0.1, 0.2, 0.4 **DONE**. Tier 1 (1.1, 1.2, 1.3) **DONE**. Tier 2
> 2.1, 2.2, 2.4, 2.5, 2.7, 2.8, 2.10, 2.11 **DONE** (see "Implemented — session 2" below).
> Remaining: Tier 0.3 (real audio), Tier 2 2.3 (rate limiter), 2.6 (signed-out TaskInput),
> 2.9 (background fallback), 2.12 (ThumbsDown semantics).
> NOTE: 1.1 added preference columns — run `bun run db:push` (or `db:migrate`,
> `drizzle/0002_mysterious_rachel_grey.sql`) before the new persistence works at runtime.

## Implemented — session 2

- **1.1 — Preferences round-trip.** Added `timerMode` / `timerPreset` / `customMinutes` /
  `pomodoroSettings` columns (+ migration `0002`), wired the model/validation/repository, and
  made the store the single source of truth for volume (engine no longer clobbers the per-account
  value). AppShell hydrates these **once** and auto-persists with an 800ms debounce; the baseline
  only advances on a successful save, so a failed save retries on the next change.
- **1.2 — Feedback.** Added `sonner`; a global `MutationCache` toasts every failed mutation
  (deduped). Task create/update/delete are optimistic with rollback; add-task input clears only
  `onSuccess` and the submit is disabled while pending.
- **1.3 — Notifications.** `src/lib/notifications.ts` (gesture-only permission, quiet degrade);
  fires on focus-countdown completion and Pomodoro phase changes, gated by `showNotifications` +
  granted permission.
- **2.1** per-mode quote selection; **2.2** `Origin: null` → clean 403 (with tests); **2.4**
  honest landing-preview copy; **2.5** real `/account` settings (Clerk sign-out + working prefs);
  **2.7** player scrubber/seek/time; **2.8** tasks empty state; **2.10** timer/tasks no longer
  overlap on narrow viewports; **2.11** aria-labels across icon-only controls.
- Verified: `bun run lint`, `bun run test` (35 passing), `bun run build` all green. A 6-dimension
  adversarial review ran over the diff; its 4 confirmed findings (persist-baseline-before-success,
  notify-before-prefs-loaded, a missing landing aria-label, a dead Tailwind class) were fixed.

## Implemented in this session

- **0.1 / 0.2 — Audio bridge fixed.** Inverted the store↔engine sync: the Zustand store's
  `isPlaying` is now the single source of truth and a store→engine effect drives
  `play()`/`pause()`/track-load (`PlayerControls.tsx`). Starting the focus timer now plays
  audio; Skip/Next resume playback; Repeat applies `engine.setLoop`; tracks auto-advance on
  `ended`. Added `setLoop` to the engine and `setIsPlaying` to the store. Added aria-labels to
  the player transport controls.
- **0.4 — Session recording fixed.** Extracted a pure, unit-tested lifecycle reducer
  (`src/lib/focus-session.ts`, 13 tests) and rewired `TimerPanel.tsx` to use it. Pomodoro focus
  blocks and ∞ focus now record real focus time; pause/resume accumulates without creating
  duplicate sessions; elapsed is measured from wall-clock (capped at planned); explicit
  reset/mode-switch cancels (doesn't count); a `pagehide` handler best-effort-flushes on close.
- Verified: `bun run lint`, `bun run test` (30 passing), and `bun run build` all green.

Remaining gaps from Tier 0.4 still open: per-Pomodoro-**cycle** counting (we count each focus
block as a session, which gives correct focused minutes) and a guaranteed (non-best-effort)
flush on hard tab-close.

## How to read this

Findings are deduplicated across subsystems and grouped by **value tier**, not by file.
Tier 0 breaks the core loop and should be fixed first; each lower tier adds retention or polish.
File references are `file:line` from the audit.

---

## Tier 0 — The core loop is broken (fix first)

These four items mean a signed-in user cannot actually complete the advertised loop
("start a session → audio plays reliably → focus time is recorded").

### 0.1 — Audio never plays from the focus flow (inverted store↔engine bridge) — **BROKEN**

The Zustand store's `isPlaying` intent is disconnected from the audio engine.

- `startTimer` sets `isPlaying: true` (`src/store/app-store.ts:298-304`) and the countdown runs.
- But the only store↔engine reconciliation effect runs **engine → store**:
  `if (isPlayingStore !== audio.isPlaying) togglePlay()` (`src/components/app/PlayerControls.tsx:49-53`)
  — it flips the **store** boolean back to match the silent engine, cancelling the play intent.
- `engine.play()` is called from exactly one place: the manual player Play button
  (`handleTogglePlay`, `src/components/app/PlayerControls.tsx:64-79`). No `useAppStore.subscribe`
  bridge exists.

**Impact:** Pressing Play on the timer starts the clock but plays no audio. The user must
separately hit the player's Play button. The store's playback intent is inert for every path
except that one button.

**Fix:** Make the store the source of truth. Replace the backwards sync effect with a single
store-driven effect that, on `isPlaying`/`currentTrack` transitions, loads the track if needed
and calls `engine.play()` / `engine.pause()`. Route the player button through `togglePlay()` so
all paths converge on that one bridge. (User-gesture/AutoPlay note: the timer/player click is a
gesture, so resuming the AudioContext in the same tick is fine.)

### 0.2 — Skip / select track stops playback, tracks never auto-advance, Repeat is dead — **BROKEN**

Same root cause as 0.1 plus missing `ended` wiring.

- `nextTrack`/`previousTrack` only swap `currentTrack` (`src/store/app-store.ts:213-253`); the
  effect at `PlayerControls.tsx:55-62` calls `loadMainTrack` (which pauses the element via
  `el.load()`, `src/lib/audio/engine.ts:333-334`) but never calls `play()` again.
- `repeatEnabled` toggles + turns the icon green but is **never read** by the engine; `el.loop`
  stays `false` and nothing replays.
- The engine's `ended` event (`engine.ts:120-124`) is not consumed by any component, so when a
  track finishes, playback just stops — no loop, no auto-advance.

**Impact:** Changing tracks while playing goes silent; the "ChillFlow Radio" stops after one
~6-minute track; Repeat does nothing.

**Fix:** With the 0.1 bridge in place, (a) resume `play()` after a track-change load if we were
playing, (b) apply `repeatEnabled` to `engine.loop`/replay, (c) wire `ended` → repeat ? replay :
`nextTrack()` + play.

### 0.3 — Real audio catalog (replace SoundHelix demo MP3s + add failure fallback) — **BROKEN/INCOMPLETE**

- Catalog is hardcoded SoundHelix demo songs (`src/server/repositories/app-repository.ts:8-36`).
- Engine sets `el.crossOrigin = 'anonymous'` and routes through `createMediaElementSource`
  (`engine.ts:113,149`); if the host blocks CORS / is down / codec route fails, the user clicks
  Play and gets **silence with no error UI**. No load-failure fallback exists (engine dispatches
  `error`, but `useAudioEngine` only logs it — `useAudioEngine.ts:60-63`).
- The DB `tracks` table is never read or written — dead schema.

**Fix:** Host owned audio on Cloudflare R2 (per `MVP_READINESS_PLAN.md` Phase 3), move metadata
to a checked-in typed catalog, verify CORS + range requests, and surface a real "couldn't load
audio — retry" toast/inline state from the engine `error` event.

### 0.4 — Pomodoro & infinite focus time is never recorded; pause/refresh lose partial time — **BROKEN**

Focus-time accounting only fires in one narrow path.

- Session **start** is guarded to `timerMode === 'focus' && selectedPreset !== '∞' && timerSeconds >= 60`
  (`src/components/app/TimerPanel.tsx:87-110`) → **Pomodoro records nothing** (0 minutes / 0 streak
  / 0 cycles forever) and **∞ focus mode records nothing**.
- Session **complete** only fires when the timer hits exactly `0:00`
  (`TimerPanel.tsx:112-122`), and writes `elapsedSeconds: plannedDuration` — so pausing at 24/25
  min then resetting/switching loses all 24 minutes.
- A captured wall-clock start (`activeSessionStartedAtRef`, `TimerPanel.tsx:105`) is **dead code** —
  never used to compute elapsed.
- Closing/refreshing mid-session discards the block (later canceled with `elapsedSeconds=0`).

**Fix:** Record sessions for Pomodoro focus blocks and ∞ mode; compute `elapsedSeconds` from the
wall-clock start; flush/complete on pause and on `visibilitychange`/`beforeunload`
(`navigator.sendBeacon`). Aligns with `MVP_READINESS_PLAN.md` Phase 2 + Decision 4.

---

## Tier 1 — Persistence & feedback (so the value sticks)

### 1.1 — Core preferences don't round-trip — **INCOMPLETE**

The AppShell auto-persist effect (`src/components/app/AppShell.tsx:107-126`) only sends
`defaultMode`, `selectedBackgroundId`, `selectedTrackId`, `likedTrackIds`. Therefore:

- **Volume** persists only to browser `localStorage` via the engine (`engine.ts:440`); the DB
  `volume` column is written by nobody and never applied → resets to 50 on a new device.
- **Timer default** (preset/custom minutes) is never persisted → always back to 25m
  (`app-store.ts:154,156`).
- **Pomodoro settings** (focus/break/long-break/cadence) are local-only → reset every reload.
- `autoPlay`, `transitionSpeed`, `theme`, `showNotifications` are stored & validated but
  **inert** — never applied at runtime and not editable.
- `customModes` is permanently `[]` (`app-repository.ts:99`, `mapPreferences`).

**Fix:** Add schema columns for volume/timerDefault/pomodoroSettings; extend the persist payload
and hydration; **debounce** the persist (see 2.3); apply hydrated volume to the engine. Surface
the editable ones (volume/theme/autoplay/notifications) in a real settings UI (see 2.5).

### 1.2 — All mutation failures are silent — **BROKEN**

No mutation in `use-app-data.ts` has an `onError`; there is no toast/inline error/rollback
anywhere. Task add/complete/delete, preference save, and session start/complete all swallow 401 /
403 (untrusted origin) / 422 / 429 / offline failures. The add-task form also clears the input
**before** the create resolves (`CenterContent.tsx:66-73`), so a failed task silently vanishes,
and rapid clicks can duplicate-create (button stays enabled).

**Fix:** Add a toast system (or inline errors) + optimistic updates with rollback for task
toggle/delete; clear the add-task input only `onSuccess`; disable submit while pending.

### 1.3 — Timer-completion notifications unimplemented — **INCOMPLETE**

`showNotifications` exists in the model but nothing requests/shows a browser `Notification`, plays
a sound, or even has a UI toggle. A timer finishing in a background tab is completely silent.

**Fix:** Opt-in `Notification` permission + notify on focus-timer completion and Pomodoro phase
change, gated by `showNotifications`; add the toggle in settings.

---

## Tier 2 — Correctness & polish

| # | Finding | Sev | Ref |
|---|---------|-----|-----|
| 2.1 | **Mode-aware quotes never match** — `quote.tags.includes(currentMode.toLowerCase())` ("deepwork"/"learnflow"…) never matches the quote tags, so it always falls back to `quotes[0]`; the same quote shows in every mode. | BROKEN | `AppShell.tsx:103` |
| 2.2 | **`Origin: null` crashes the CORS check** — unguarded `new URL()` throws → 500 instead of a clean 403. | BROKEN | `src/server/security/origin.ts` |
| 2.3 | **Rate limiter is a serverless no-op + shared dev bucket** — in-memory per-instance; in dev all clients share one "anonymous" bucket, and AppShell's auto-persist (fires on every mode/track/background/like change) can trip the 60/min limit. | INCOMPLETE | `src/server/security/rate-limit.ts`, `AppShell.tsx:107-126` |
| 2.4 | **Landing selectors are non-functional mockups** — preset/intensity/volume/duration/background/play on the landing page carry **no** state into `/app`; the workspace always starts from defaults. | INCOMPLETE | `src/features/landing/*` |
| 2.5 | **`/account` is a dev env-status placeholder** — shows Clerk/Postgres env config, not account actions (no sign-out, profile, or preference toggles). Turn it into the real settings page. | POLISH | `src/app/account/page.tsx` |
| 2.6 | **Signed-out TaskInput Enter dead-ends** — pressing Enter while signed out hits the protected API and silently bounces `/app → /` with no sign-in prompt. | BROKEN | `src/features/landing/task-input.tsx` |
| 2.7 | **No playback progress UI** — currentTime/duration/buffered are tracked but never shown; no scrubber/seek/time display. | INCOMPLETE | `PlayerControls.tsx` |
| 2.8 | **No empty state for tasks** — empty list renders a blank area; `defaultTasks` seed is dead code, so new users see nothing. | POLISH | `CenterContent.tsx:110-160`, `app-repository.ts:38-42` |
| 2.9 | **Background images: no fallback/loading** — remote Unsplash URLs; if blocked/offline the user sees a black screen with no indication. | POLISH | `AppShell.tsx:156-163`, `src/lib/backgrounds.ts` |
| 2.10 | **Timer & Tasks panels overlap** on narrow/`<sm` viewports in LearnFlow/TaskDrive (both anchored `top-24`). | POLISH | `CenterContent.tsx:53`, `TimerPanel.tsx:195` |
| 2.11 | **Icon-only controls lack accessible names** — play/pause/skip/repeat/mute, menu toggle, per-task complete/delete are unlabeled for screen readers. | POLISH | `PlayerControls.tsx`, `CenterContent.tsx`, `AppHeader.tsx:89` |
| 2.12 | **ThumbsDown icon is wired to `nextTrack`** — communicates a "dislike" feature that doesn't exist. | POLISH | `PlayerControls.tsx:113-115` |

---

## Recommended execution order

1. **Tier 0.1 + 0.2 together** — invert the store↔engine bridge and wire `ended`/repeat/auto-advance.
   One focused change in `PlayerControls.tsx` (+ small store touch) revives play, skip, repeat,
   and continuous playback. *Highest value-per-effort in the codebase.*
2. **Tier 0.4** — fix session recording (Pomodoro/∞/pause/refresh, wall-clock elapsed) so the
   "minutes focused / streak" stats become true. Add the tests Phase 2 still lists as open.
3. **Tier 0.3** — swap in real R2-hosted audio + load-failure fallback UI.
4. **Tier 1.2** — toasts + optimistic task updates (makes everything else feel reliable).
5. **Tier 1.1 + 1.3 + 2.5** — extend persisted preferences, build the real settings/account page,
   add timer notifications.
6. **Tier 2** correctness (2.1, 2.2, 2.3, 2.6) then polish (progress bar, empty states, responsive
   overlap, a11y, landing).

## Refuted (not real issues)

- "Preference validation silently drops unknown fields" — verified harmless; no data corruption.
- "No empty state when track catalog is empty" — catalog is a non-empty checked-in constant.
