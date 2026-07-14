# Audio engine debugging

Development builds include an audio debug logger and panel for inspecting engine state and playback events. The logger is disabled in production, the panel is not mounted, and browser globals are not exposed.

## Debug panel

`src/components/providers.tsx` mounts `AudioDebugTrigger` automatically in development. Use its fixed bottom-right button to inspect current engine state, filter recorded events by level or category, view event data and error stacks, or clear the log.

The engine records initialization, track loading, playback, seeking, volume changes, gain ramps, media events, and contextual errors. It also exposes current playback and buffering state; it does not continuously monitor buffer health or detect stalls.

## Browser console access

Development builds expose these helpers on `window`:

```javascript
window.__audioEngine
window.__audioDebugLogger
window.__audioDebugHelpers.getEngineState()
window.__audioDebugHelpers.logAudioContext()
window.__audioDebugHelpers.logMediaElement()
window.__audioDebugHelpers.clearDebugLog()
window.__audioDebugHelpers.getDebugEvents()
```

Only error-level logger events are printed automatically to the browser console. Inspect other levels through the panel or logger API.

## Logger API

```typescript
import { getAudioDebugLogger } from '@/lib/audio/debug';

const logger = getAudioDebugLogger();

logger.debug('MyComponent', 'Debug message', { data: 'value' });
logger.info('MyComponent', 'Info message');
logger.warn('MyComponent', 'Warning message');
logger.error('MyComponent', 'Error message', error);

const endTimer = logger.time('MyComponent', 'Operation name');
// Run the operation.
endTimer();

const events = logger.getEvents();
const errors = logger.getEventsByLevel('error');
const playbackEvents = logger.getEventsByCategory('Playback');
logger.clear();
```

The logger serializes attached data, captures error stacks, and keeps at most 1,000 events in memory.

## Troubleshooting

- If playback does not start, inspect errors for `NotAllowedError`, verify that playback followed a user gesture, and check the audio context and media element state.
- If a track does not load, inspect `TrackLoader` and `MediaElement` events and verify the requested URL, CORS response headers, and network status.
- If playback quality is poor, inspect loading and media events together with the sampled buffered percentage in engine state.
