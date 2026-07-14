'use client';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AudioDebugEvent {
    timestamp: number;
    level: LogLevel;
    category: string;
    message: string;
    data?: unknown;
    stack?: string;
}

class AudioDebugLogger {
    private events: AudioDebugEvent[] = [];
    private maxEvents = 1000;
    private enabled = false;

    constructor() {
        this.enabled = process.env.NODE_ENV === 'development';
    }

    private log(level: LogLevel, category: string, message: string, data?: unknown): void {
        if (!this.enabled) return;

        const event: AudioDebugEvent = {
            timestamp: Date.now(),
            level,
            category,
            message,
            data: data ? JSON.parse(JSON.stringify(data)) : undefined,
            stack: level === 'error' ? new Error().stack : undefined,
        };

        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events.shift();
        }
        if (level === 'error') {
            const ts = new Date(event.timestamp).toISOString().split('T')[1]?.slice(0, -1);
            const prefix = `[${ts}] - ${category}`;
            if (event.stack || data) {
                console.error(`${prefix}: ${message}`, { data, stack: event.stack });
            } else {
                console.error(`${prefix}: ${message}`);
            }
        }
    }

    debug(category: string, message: string, data?: unknown): void {
        this.log('debug', category, message, data);
    }

    info(category: string, message: string, data?: unknown): void {
        this.log('info', category, message, data);
    }

    warn(category: string, message: string, data?: unknown): void {
        this.log('warn', category, message, data);
    }

    error(category: string, message: string, data?: unknown): void {
        this.log('error', category, message, data);
    }

    getEvents(): AudioDebugEvent[] {
        return [...this.events];
    }

    getEventsByCategory(category: string): AudioDebugEvent[] {
        return this.events.filter(event => event.category === category);
    }

    getEventsByLevel(level: LogLevel): AudioDebugEvent[] {
        return this.events.filter(event => event.level === level);
    }

    clear(): void {
        this.events = [];
    }

    time(category: string, label: string): () => void {
        if (!this.enabled) return () => { };

        const start = performance.now();
        this.debug(category, `Started: ${label}`);

        return () => {
            const duration = performance.now() - start;
            this.info(category, `Completed: ${label}`, {
                duration: `${duration.toFixed(2)}ms`,
                durationMs: duration
            });
        };
    }

    logAudioContextState(context: AudioContext | null): void {
        if (!context) {
            this.warn('AudioContext', 'Audio context is null');
            return;
        }

        this.debug('AudioContext', 'Current state', {
            state: context.state,
            sampleRate: context.sampleRate,
            currentTime: context.currentTime.toFixed(3),
            baseLatency: context.baseLatency,
            outputLatency: context.outputLatency,
        });
    }

    logMediaElementState(element: HTMLAudioElement | null): void {
        if (!element) {
            this.warn('MediaElement', 'Media element is null');
            return;
        }

        const buffered = [];
        for (let i = 0; i < element.buffered.length; i++) {
            buffered.push({
                start: element.buffered.start(i).toFixed(2),
                end: element.buffered.end(i).toFixed(2),
            });
        }

        this.debug('MediaElement', 'Current state', {
            src: element.src ? element.src.substring(element.src.lastIndexOf('/') + 1) : 'none',
            readyState: this.getReadyStateText(element.readyState),
            networkState: this.getNetworkStateText(element.networkState),
            currentTime: Number(element.currentTime ?? 0).toFixed(3),
            duration: Number(element.duration ?? 0).toFixed(3),
            paused: element.paused,
            ended: element.ended,
            muted: element.muted,
            volume: Number(element.volume ?? 1).toFixed(2),
            playbackRate: element.playbackRate ?? 1,
            buffered,
            error: element.error ? {
                code: element.error.code,
                message: element.error.message,
            } : null,
        });
    }

    private getReadyStateText(state: number): string {
        switch (state) {
            case HTMLMediaElement.HAVE_NOTHING: return 'HAVE_NOTHING';
            case HTMLMediaElement.HAVE_METADATA: return 'HAVE_METADATA';
            case HTMLMediaElement.HAVE_CURRENT_DATA: return 'HAVE_CURRENT_DATA';
            case HTMLMediaElement.HAVE_FUTURE_DATA: return 'HAVE_FUTURE_DATA';
            case HTMLMediaElement.HAVE_ENOUGH_DATA: return 'HAVE_ENOUGH_DATA';
            default: return `UNKNOWN(${state})`;
        }
    }

    private getNetworkStateText(state: number): string {
        switch (state) {
            case HTMLMediaElement.NETWORK_EMPTY: return 'NETWORK_EMPTY';
            case HTMLMediaElement.NETWORK_IDLE: return 'NETWORK_IDLE';
            case HTMLMediaElement.NETWORK_LOADING: return 'NETWORK_LOADING';
            case HTMLMediaElement.NETWORK_NO_SOURCE: return 'NETWORK_NO_SOURCE';
            default: return `UNKNOWN(${state})`;
        }
    }
}

let debugLogger: AudioDebugLogger | null = null;

export function getAudioDebugLogger(): AudioDebugLogger {
    if (!debugLogger) {
        debugLogger = new AudioDebugLogger();
    }
    return debugLogger;
}

declare global {
    interface Window {
        __audioDebugLogger?: AudioDebugLogger;
    }
}

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    window.__audioDebugLogger = getAudioDebugLogger();
}
