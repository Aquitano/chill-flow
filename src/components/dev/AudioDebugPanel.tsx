'use client';

import { AudioDebugEvent, getAudioDebugLogger, LogLevel } from '@/lib/audio/debug';
import { getAudioEngine } from '@/lib/audio/engine';
import { useEffect, useState } from 'react';

interface AudioDebugPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AudioDebugPanel({ isOpen, onClose }: AudioDebugPanelProps) {
    const [debugEvents, setDebugEvents] = useState<AudioDebugEvent[]>([]);
    const [engineState, setEngineState] = useState<Record<string, unknown> | null>(null);
    const [selectedLevel, setSelectedLevel] = useState<LogLevel | 'all'>('all');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [autoRefresh, setAutoRefresh] = useState(true);

    useEffect(() => {
        if (!isOpen) return;

        const updateState = () => {
            const engine = getAudioEngine();
            const logger = getAudioDebugLogger();

            setEngineState(
                (engine as unknown as { getDebugState?: () => Record<string, unknown> }).getDebugState?.() || null,
            );
            setDebugEvents(logger.getEvents());
        };

        updateState();

        if (autoRefresh) {
            const interval = setInterval(updateState, 1000);
            return () => clearInterval(interval);
        }
    }, [isOpen, autoRefresh]);

    if (!isOpen) return null;

    const filteredEvents = debugEvents.filter((event) => {
        const levelMatch = selectedLevel === 'all' || event.level === selectedLevel;
        const categoryMatch = selectedCategory === 'all' || event.category === selectedCategory;
        return levelMatch && categoryMatch;
    });

    const categories = Array.from(new Set(debugEvents.map((e) => e.category)));

    const getLevelColor = (level: LogLevel) => {
        switch (level) {
            case 'debug':
                return 'text-gray-500';
            case 'info':
                return 'text-blue-600';
            case 'warn':
                return 'text-yellow-600';
            case 'error':
                return 'text-red-600';
            default:
                return 'text-gray-900';
        }
    };

    const clearLogs = () => {
        getAudioDebugLogger().clear();
        setDebugEvents([]);
    };

    return (
        <div className="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
            <div className="flex h-5/6 w-11/12 flex-col rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b p-4">
                    <h2 className="text-xl font-bold">🎵 Audio Engine Debug Panel</h2>
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-sm">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                            />
                            Auto-refresh
                        </label>
                        <button
                            onClick={clearLogs}
                            className="rounded bg-gray-500 px-3 py-1 text-sm text-white hover:bg-gray-600"
                        >
                            Clear Logs
                        </button>
                        <button
                            onClick={onClose}
                            className="rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    <div className="w-1/3 overflow-y-auto border-r p-4">
                        <h3 className="mb-2 font-bold">Engine State</h3>
                        {engineState ? (
                            <div className="space-y-2 text-sm">
                                {Object.entries(engineState).map(([key, value]) => (
                                    <div key={key} className="flex justify-between">
                                        <span className="font-medium">{key}:</span>
                                        <span
                                            className={`${
                                                typeof value === 'boolean'
                                                    ? value
                                                        ? 'text-green-600'
                                                        : 'text-red-600'
                                                    : 'text-gray-700'
                                            }`}
                                        >
                                            {typeof value === 'number'
                                                ? key.includes('Time') || key.includes('duration')
                                                    ? `${value.toFixed(2)}s`
                                                    : value.toFixed(3)
                                                : String(value ?? 'N/A')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">No state available</p>
                        )}
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                        <div className="mb-4 flex items-center gap-4">
                            <h3 className="font-bold">Debug Logs ({filteredEvents.length})</h3>

                            <select
                                value={selectedLevel}
                                onChange={(e) => setSelectedLevel(e.target.value as LogLevel | 'all')}
                                className="rounded border px-2 py-1 text-sm"
                            >
                                <option value="all">All Levels</option>
                                <option value="debug">Debug</option>
                                <option value="info">Info</option>
                                <option value="warn">Warn</option>
                                <option value="error">Error</option>
                            </select>

                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="rounded border px-2 py-1 text-sm"
                            >
                                <option value="all">All Categories</option>
                                {categories.map((category) => (
                                    <option key={category} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex-1 overflow-y-auto rounded bg-gray-50 p-2 font-mono text-xs">
                            {filteredEvents.length === 0 ? (
                                <p className="text-gray-500">No debug events to display</p>
                            ) : (
                                filteredEvents
                                    .slice(-500)
                                    .reverse()
                                    .map((event, index) => (
                                        <div
                                            key={`${event.timestamp}-${index}`}
                                            className="mb-2 rounded border bg-white p-2"
                                        >
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className={`font-bold ${getLevelColor(event.level)}`}>
                                                    [{event.level.toUpperCase()}] {event.category}
                                                </span>
                                                <span className="text-gray-500">
                                                    {new Date(event.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            <div className="mb-1 text-gray-800">{event.message}</div>
                                            {event.data !== undefined && (
                                                <details className="text-gray-600">
                                                    <summary className="cursor-pointer text-xs">Data</summary>
                                                    <pre className="mt-1 overflow-x-auto text-xs">
                                                        {JSON.stringify(event.data, null, 2)}
                                                    </pre>
                                                </details>
                                            )}
                                            {event.stack && (
                                                <details className="text-gray-600">
                                                    <summary className="cursor-pointer text-xs">Stack Trace</summary>
                                                    <pre className="mt-1 overflow-x-auto text-xs">{event.stack}</pre>
                                                </details>
                                            )}
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function AudioDebugTrigger() {
    const [isOpen, setIsOpen] = useState(false);

    if (process.env.NODE_ENV !== 'development') {
        return null;
    }

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="fixed right-4 bottom-4 z-40 rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700"
                title="Open Audio Debug Panel"
            >
                Debug
            </button>
            <AudioDebugPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
