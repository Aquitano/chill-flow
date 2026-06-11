# ChillFlow MVP Readiness Plan

## Goal

Ship a focused MVP where a signed-in user can open ChillFlow, play real focus audio, run a reliable focus timer, manage tasks, save core preferences, and see basic focus progress.

## Current State

ChillFlow already has a useful product skeleton:

- Next.js App Router app with a landing page and authenticated workspace route.
- Clerk integration for auth-aware landing header, protected `/app`, and protected API procedures.
- JStack/Hono API with routers for tracks, tasks, preferences, and sessions.
- Drizzle/Postgres schema and initial migration for tasks, preferences, sessions, tracks, and saved presets.
- Workspace UI with modes, task panel, timer, Pomodoro controls, track picker, backgrounds, quotes, player controls, and progress summary.
- Client audio engine using `HTMLAudioElement` and Web Audio gain control.
- Static catalogs for tracks, backgrounds, and quotes.
- Validation, rate-limit, origin, and audio tests.
- ESLint currently passes.

## MVP Definition

The MVP is not a full productivity platform. It should prove the core loop:

1. User signs in.
2. User starts a focus session.
3. Audio plays reliably.
4. User tracks a small set of tasks.
5. Focus session completion is recorded accurately.
6. User returns later and sees saved preferences and basic progress.

Anything outside that loop is either deferred or hidden until it is real.

Primary UX target: desktop-first. Mobile and narrow viewports should be usable and free of major layout breakage, but MVP polish should prioritize desktop and tablet-sized focus sessions.

## Non-MVP Scope

Defer these until after MVP unless a decision explicitly promotes them:

- Advanced analytics beyond total sessions, total minutes, and streak.
- Social features, sharing, teams, or public profiles.
- Marketplace/library-scale music catalog.
- Custom user-uploaded audio.
- Complex task management such as projects, due dates, recurring tasks, labels, or drag/drop boards.
- Deep theme customization.
- Native mobile app.
- Paid billing.

## Phase 1: Fix Product Routing and Environment Behavior

Status: done.

### Problems

- `/account` is linked and used as a redirect target, but no account page exists.
- App behavior is inconsistent when Clerk or database configuration is missing.
- README mentions demo mode, but `/app` cannot run in demo mode.

### Work

- [x] Add `src/app/account/page.tsx` with a minimal account/setup page, or remove `/account` links and redirects.
- [x] Require Clerk and database configuration for the MVP workspace.
- [x] Remove demo-mode claims from README and route copy.
- [x] Treat missing Clerk or database env vars as setup errors, not as a supported app state.
- [x] Add clear setup instructions for Clerk and database configuration.

### Acceptance Criteria

- [x] No route in the app points to a missing page.
- [x] A new developer can understand required env vars from `.env.example` and README.
- [x] Missing Clerk/database config is handled by a clear setup page and documented as unsupported for the deployable MVP.

## Phase 2: Fix Focus Session Lifecycle

Status: in progress. Finite focus countdown sessions now use planned versus elapsed duration, pause/resume keeps one active session, reset cancels the active session, new starts cancel older active rows, and completed focus countdowns persist elapsed focus time. Pomodoro-specific lifecycle analytics remain open.

### Problems

- Completed sessions can be recorded with `durationSeconds: 0` when the timer reaches zero.
- Paused or abandoned sessions can leave active rows in the database.
- Pomodoro focus blocks are not clearly persisted as focus sessions.
- Session duration currently mixes planned duration and actual elapsed duration.

### Work

- [x] Define session fields semantically:
  - `plannedDurationSeconds`
  - `elapsedSeconds`
  - `status`: `active`, `completed`, `canceled`
- [x] Update schema and repository methods accordingly.
- [x] Track active session start time in the client.
- [x] Complete focus sessions with actual elapsed duration.
- [x] Cancel or expire abandoned active sessions.
- Count Pomodoro analytics with two separate concepts:
  - focused minutes count focus blocks only
  - completed Pomodoro sessions count a full focus-plus-break cycle
- Persist enough Pomodoro lifecycle state to know whether a focus-plus-break cycle was completed.
- [ ] Add tests for start, pause, cancel, complete, and summary calculations.

### Acceptance Criteria

- A 25-minute completed session adds 25 minutes to summary.
- Pausing does not create duplicate sessions.
- Canceling does not count as completed focus time.
- Refreshing mid-session does not corrupt analytics.
- Pomodoro focus minutes and completed Pomodoro cycles are counted consistently.

## Phase 3: Replace Demo Audio With MVP Audio Catalog

### Problems

- Track catalog is hardcoded in `app-repository.ts`.
- Current URLs are SoundHelix demo MP3 files.
- Database `tracks` table exists but is not used by the product.
- Audio scripts mention R2 upload/transcoding, but the app is not wired to a production catalog.

### Work

- Use hosted audio files for the MVP catalog, preferably object storage.
- Serve MVP audio assets through public R2 URLs.
- Keep audio source configuration testable:
  - production points at hosted object storage URLs
  - automated tests use stable fixture URLs or mocked catalog data
  - local development can use either hosted dev assets or a small local fixture catalog
- Store production track metadata in a checked-in typed catalog file.
- Do not build an admin workflow for MVP.
- Do not rely on the `tracks` database table for MVP track reads; either leave it dormant for later or remove it in a cleanup migration.
- Update `tracksRouter.list` to read from the checked-in catalog source.
- Add fallback UI for audio load failures.
- Add at least 5-10 usable tracks or loops for MVP.

### Acceptance Criteria

- No third-party sample tracks remain in production.
- Track metadata has title, artist/source, duration, category, tags, and playable URL.
- Audio playback succeeds on Chrome, Safari, Firefox, and mobile Safari for the chosen codec strategy.
- User sees an actionable message if playback fails.
- Public R2 audio URLs support browser playback and range requests.

## Phase 4: Finish Core Persistence

### Problems

- Preferences only partially persist.
- Saved presets table exists but no end-to-end preset UI/API exists.
- Pomodoro settings, volume, repeat, and timer defaults are local-only or inconsistently stored.

### Work

- Persist MVP preferences:
  - default mode
  - selected track
  - selected background
  - liked tracks
  - volume
  - timer default
  - Pomodoro settings
- Defer named saved presets for MVP.
- Persist the user's current workspace state automatically instead.
- Remove or hide UI claims for unsupported settings.
- Add repository and API tests for preference updates.

### Acceptance Criteria

- User returns after sign-out/sign-in and core workspace state is restored.
- Invalid preference values are rejected.
- The UI does not advertise saved presets unless they work.

## Phase 5: Tighten Workspace UX

### Problems

- Workspace panels are likely weak on small screens.
- Empty, loading, mutation failure, and audio failure states are minimal.
- Some controls do not expose clear state or feedback.
- Notification preference exists, but timer notifications are not implemented.
- Landing page exists and should stay structurally intact, but needs deploy-ready copy and route polish.

### Work

- Add empty states for tasks, tracks, and sessions.
- Surface mutation failures with inline messages or toasts.
- Keep task management simple:
  - task text
  - priority
  - complete
  - delete
- Make workspace layout responsive enough for narrow viewports:
  - task panel
  - timer panel
  - feature menu
  - player controls
- Add accessible labels/tooltips for icon-only controls.
- Ensure timer and playback controls remain usable at small viewport widths.
- Add minimal opt-in browser notifications for:
  - focus timer completion
  - Pomodoro phase changes
- Keep notifications behind the existing `showNotifications` preference.
- Keep the existing landing page structure.
- Polish landing page only where needed for deployment readiness:
  - truthful MVP copy
  - working auth calls to action
  - no broken `/account` or app links
  - minor visual cleanup if obvious

### Acceptance Criteria

- Core loop is polished on desktop and usable without major layout breakage on narrower viewport widths.
- Failed API mutations do not silently disappear.
- Icon-only controls have accessible names.
- No major UI overlap in the workspace.
- Timer notifications work when permission is granted and fail quietly when unavailable.
- Landing page is accurate, polished enough for launch, and does not claim unsupported features.

## Phase 6: Production Hardening

### Problems

- `bun run test` currently fails before tests run due to a Vitest dependency resolution issue.
- Sentry is wired but production validation and lightweight metrics are not documented.
- Database migrations and deployment steps are not fully captured.
- Deployment target is Vercel with an externally hosted Postgres database.
- Audio object storage target is Cloudflare R2.
- Self-hosted Postgres needs basic backup and restore documentation.

### Work

- Repair dependency install so `bun run test` executes.
- Keep CI setup out of scope for MVP unless Vercel/GitHub integration requires it.
- Maintain local pre-deploy scripts for lint, test, build, and migration verification.
- Run `bun run build` and fix production build issues.
- Confirm Sentry config works only when DSN is configured.
- Keep Sentry optional but supported.
- Add small, useful observability events/metrics without building a full analytics platform:
  - app/API errors
  - audio playback failures
  - focus session started/completed
  - timer notification failures if relevant
- Document deployment steps for:
  - Vercel app hosting
  - self-hosted Postgres reachable by domain
  - Cloudflare R2 audio storage
- Document a simple Postgres backup and restore workflow.
- Add a simple smoke-test checklist.

### Acceptance Criteria

- `bun run lint` passes.
- `bun run test` passes.
- `bun run build` passes.
- Vercel deployment build passes.
- Fresh setup from README works.
- Production deployment has documented env vars and migration steps.
- Vercel can connect to the self-hosted Postgres database securely.
- Database URL stays server-only and is never exposed through client env vars, rendered pages, logs, or API responses.
- Cloudflare R2 audio storage is documented with local/test workflow.
- Sentry is useful when configured and harmless when omitted.
- Basic Postgres backup and restore steps are documented and have been tested once.

## Recommended MVP Cut

Ship with:

- Required auth and database.
- Minimal `/account` page for account/setup/settings.
- Small owned audio catalog.
- Task create/complete/delete with lightweight priority.
- Focus timer and Pomodoro timer.
- Accurate completed-session analytics.
- Persisted core workspace preferences.
- Basic responsive workspace.

Do not ship with:

- Demo-mode workspace unless explicitly chosen.
- Named saved presets.
- Advanced analytics.
- User-uploaded audio.
- Public music library scale.

## Decision Log

### Decision 1: Demo Mode

Status: resolved.

Decision: do not support demo mode for MVP. Require Clerk and database for `/app`, and make missing setup clear on `/account` and in README.

Rationale: demo mode adds a second data path for tasks, sessions, preferences, and analytics. That makes the core session lifecycle harder to validate. A real MVP should prove the signed-in persistence loop.

### Decision 2: Audio Catalog Source

Status: resolved.

Decision: use audio files hosted in storage for the production MVP, preferably object storage. Keep local and automated testing possible through fixture catalog data or configurable storage URLs.

Rationale: third-party sample audio cannot represent the product, and audio reliability is part of the core promise.

### Decision 2a: Track Metadata Source

Status: resolved.

Decision: keep track metadata in a checked-in typed catalog file for MVP. Do not build an admin workflow.

Rationale: a checked-in catalog is simpler to review, test, and deploy while the catalog is small. Admin tooling is not needed until catalog updates become frequent or non-developers need to manage tracks.

### Decision 3: Saved Presets

Status: resolved.

Decision: defer named presets. Persist the user's current workspace preferences instead.

Rationale: presets are useful, but not required to prove the first focus loop.

### Decision 4: Pomodoro Analytics

Status: resolved.

Decision: count focused minutes from Pomodoro focus blocks only. Also count completed Pomodoro sessions when the full focus-plus-break cycle is completed.

Rationale: users expect focused minutes to reflect productive time, but Pomodoro users also need progress feedback for completed cycles.

### Decision 5: Timer Notifications

Status: resolved.

Decision: include minimal browser notifications for timer completion and Pomodoro phase changes, controlled by the existing `showNotifications` preference.

Rationale: timer notifications are part of the focus loop, but a broader notification system is not needed for MVP.

### Decision 6: Responsive Target

Status: resolved.

Decision: build desktop-first for MVP, with enough responsive behavior that mobile and narrow viewports are usable and do not visibly break.

Rationale: the main focus/task/audio workflow is most likely used during laptop or desktop work sessions. Mobile support matters, but it should not consume MVP scope beyond baseline usability.

### Decision 7: Task Scope

Status: resolved.

Decision: keep task management simple, but use the existing `priority` field. MVP tasks support text, priority, completion, and deletion.

Rationale: priority is already in the schema and validation, so exposing it lightly is reasonable. More complex task features such as projects, due dates, labels, recurring tasks, and drag/drop ordering remain out of scope.

### Decision 8: Landing Page Scope

Status: resolved.

Decision: keep the current landing page structure. Make it deploy-ready with light polish, accurate copy, and working routes, but do not redesign it for MVP.

Rationale: the authenticated workspace is the product. The landing page only needs to explain the MVP truthfully and get users into auth/app flows without broken links or unsupported claims.

### Decision 9: Deployment Target

Status: partially resolved.

Decision: deploy the Next.js app to Vercel. Use direct backend-only access from Vercel to a self-hosted Postgres database available through a domain. Use Cloudflare R2 for MVP audio object storage.

Rationale: Vercel matches the current Next.js app shape. Self-hosted Postgres is acceptable if the database is securely reachable from Vercel, the connection string remains server-only, and migrations can run reliably. Cloudflare R2 keeps audio hosting simple for MVP, has a useful free tier for a small catalog, avoids egress fees, and remains S3-compatible enough to migrate later if needed.

### Decision 10: Audio Storage Provider

Status: resolved.

Decision: use Cloudflare R2 for MVP audio file storage.

Rationale: R2 is managed, S3-compatible, and low-friction for a small public audio catalog. It avoids adding MinIO/self-hosted storage operations before the product loop is proven.

### Decision 11: Audio Asset Access

Status: resolved.

Decision: use public R2 URLs for MVP audio assets. Defer private buckets, signed URLs, and proxy delivery.

Rationale: MVP audio assets are product content, not user-private files. Public URLs keep playback simple and reduce risk around browser media loading, range requests, CORS, and token expiry.

### Decision 12: Database Connectivity

Status: resolved.

Decision: Vercel connects directly to the self-hosted Postgres domain for MVP. The database connection string must stay backend-only and must not be exposed through `NEXT_PUBLIC_` env vars, client code, rendered output, logs, or API responses.

Rationale: direct connection is acceptable for MVP if expected traffic is low and the database is secured. A pooler can be added later if connection pressure becomes a problem.

### Decision 13: Observability

Status: resolved.

Decision: keep Sentry and add only lightweight metrics/events for errors, audio failures, and focus session lifecycle. Sentry should be optional for deployment and must not block app startup when unconfigured.

Rationale: early MVP needs enough observability to debug production issues, especially audio and session tracking. A broader analytics system is unnecessary before usage patterns are real.

### Decision 14: Database Backups

Status: resolved.

Decision: include simple backup and restore documentation for the self-hosted Postgres database.

Rationale: because the database is self-hosted, deploy readiness needs a basic recovery path. For MVP this can be a short documented `pg_dump`/restore workflow that has been tested once.

### Decision 15: CI

Status: resolved.

Decision: do not add a dedicated CI pipeline for MVP. Rely on Vercel deployment checks plus local pre-deploy lint, test, and build commands.

Rationale: Vercel will run deployment checks, and adding CI is not necessary before the deploy path is otherwise stable. The repo should still keep clear local verification commands.

## Execution Order

1. Resolve remaining product decisions in the decision log.
2. Fix `/account` and env behavior.
3. Fix session lifecycle and analytics correctness.
4. Replace demo audio catalog.
5. Finish preference persistence.
6. Tighten responsive UX and failure states.
7. Repair tests and validate build.
8. Update README and deployment checklist.

## Agent Handoff

Start implementation from this document. The product decisions below are already resolved and should not be reopened unless new technical constraints appear:

- Clerk and database are required for the deployable MVP.
- No demo-mode workspace for MVP.
- Deploy the Next.js app to Vercel.
- Connect Vercel directly to the self-hosted Postgres database through a backend-only `DATABASE_URL`.
- Never expose database credentials through `NEXT_PUBLIC_` env vars, client bundles, rendered output, logs, or API responses.
- Use Cloudflare R2 for MVP audio storage.
- Serve MVP audio through public R2 URLs.
- Keep track metadata in a checked-in typed catalog file.
- Do not build an admin workflow for tracks.
- Defer named saved presets.
- Persist current workspace preferences automatically.
- Count Pomodoro focused minutes from focus blocks only.
- Count completed Pomodoro sessions when a full focus-plus-break cycle completes.
- Add minimal browser notifications for timer completion and Pomodoro phase changes.
- Build desktop-first, with responsive baseline support for narrow viewports.
- Keep tasks simple, but include the existing priority field.
- Keep the current landing page structure and apply only deploy-readiness polish.
- Keep Sentry optional but supported, with lightweight events only.
- Document a simple Postgres backup/restore workflow.
- Do not add dedicated CI for MVP.
- Tests must run and pass locally before MVP is considered ready.

Recommended implementation sequence for the next agent:

1. Create or fix the `/account` route and update README/env behavior.
2. Repair the current test dependency issue so `bun run test` can execute before deeper changes.
3. Fix the focus session and Pomodoro lifecycle with tests.
4. Move track metadata out of `app-repository.ts` into a checked-in typed catalog that points to public R2 URLs.
5. Expand persisted preferences for volume, timer defaults, Pomodoro settings, and task priority UI.
6. Add minimal notification behavior, error states, and desktop-first responsive polish.
7. Add Sentry events where useful and document Vercel, Postgres, R2, and backup/restore setup.
8. Run `bun run lint`, `bun run test`, `bun run build`, and a Vercel deployment build.

## MVP Exit Checklist

- [x] No broken internal routes.
- [x] Authenticated user can open `/app`.
- [ ] User can play at least one production-ready track.
- [x] User can start, pause, complete, and reset a focus session.
- [x] Completed focus time is recorded accurately.
- [ ] Pomodoro focused minutes and completed cycles are counted intentionally.
- [x] User can create, complete, and delete tasks.
- [x] User can set simple task priority.
- [ ] Core preferences persist across sessions.
- [ ] Workspace is polished on desktop and usable on narrow viewports.
- [ ] Empty and error states are visible.
- [ ] Minimal timer notifications work when enabled and permitted.
- [x] Landing page links and claims are deploy-ready.
- [ ] Sentry works when configured and the app works when it is omitted.
- [x] `bun run lint` passes.
- [x] `bun run test` passes.
- [x] `bun run build` passes.
- [ ] Vercel deployment build passes.
- [ ] README documents setup and deployment. Setup is documented; deployment remains open.
- [ ] Simple Postgres backup and restore workflow is documented.
