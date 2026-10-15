/**
 * Shape and serialization for the account data export, kept apart from the repository so
 * both can be tested without a database.
 *
 * The row shapes are declared here rather than reused from the API models: those carry only
 * what the workspace renders, while an export owes the user the columns behind it too —
 * when a task was created, when a block was abandoned.
 */

import type { UserPreferences } from '@/models/app';

export const EXPORT_FORMATS = ['json', 'csv'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string | null): value is ExportFormat {
    return value !== null && (EXPORT_FORMATS as readonly string[]).includes(value);
}

export interface ExportedTask {
    id: string;
    text: string;
    priority: string;
    isCompleted: boolean;
    dueAt: string | null;
    dueHasTime: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ExportedSession {
    id: string;
    mode: string;
    timerKind: string;
    status: string;
    plannedDurationSeconds: number;
    elapsedSeconds: number;
    trackId: string | null;
    taskId: string | null;
    /** Denormalized so a row explains itself; null once the task it named is deleted. */
    taskText: string | null;
    startedAt: string;
    completedAt: string | null;
    canceledAt: string | null;
    cycleCompletedAt: string | null;
}

export interface ExportedAmbientMix {
    id: string;
    name: string;
    levels: Record<string, number>;
    createdAt: string;
}

export interface ExportedPreset {
    id: string;
    name: string;
    trackId: string | null;
    backgroundId: string | null;
    mode: string;
    ambientLevels: Record<string, number> | null;
    timerMode: 'focus' | 'pomodoro' | null;
    timerPreset: string | null;
    customMinutes: string | null;
    pomodoroSettings: {
        focusMinutes: number;
        breakMinutes: number;
        longBreakMinutes: number;
        sessionsBeforeLongBreak: number;
        autoStartBreaks: boolean;
        autoStartFocus: boolean;
    } | null;
    createdAt: string;
}

export interface UserDataExport {
    exportedAt: string;
    /** Bumped only on a breaking change to the shape below. */
    schemaVersion: number;
    tasks: ExportedTask[];
    focusSessions: ExportedSession[];
    preferences: UserPreferences | null;
    ambientMixes: ExportedAmbientMix[];
    savedPresets: ExportedPreset[];
}

export const EXPORT_SCHEMA_VERSION = 1;

export function exportFileName(format: ExportFormat, exportedAt: Date): string {
    const day = exportedAt.toISOString().slice(0, 10);
    return format === 'csv' ? `chillflow-sessions-${day}.csv` : `chillflow-export-${day}.json`;
}

const SESSION_CSV_COLUMNS: { header: string; value: (session: ExportedSession) => string | number | null }[] = [
    { header: 'id', value: (session) => session.id },
    { header: 'mode', value: (session) => session.mode },
    { header: 'timerKind', value: (session) => session.timerKind },
    { header: 'status', value: (session) => session.status },
    { header: 'plannedDurationSeconds', value: (session) => session.plannedDurationSeconds },
    { header: 'elapsedSeconds', value: (session) => session.elapsedSeconds },
    { header: 'taskId', value: (session) => session.taskId },
    { header: 'taskText', value: (session) => session.taskText },
    { header: 'trackId', value: (session) => session.trackId },
    { header: 'startedAt', value: (session) => session.startedAt },
    { header: 'completedAt', value: (session) => session.completedAt },
    { header: 'canceledAt', value: (session) => session.canceledAt },
    { header: 'cycleCompletedAt', value: (session) => session.cycleCompletedAt },
];

/**
 * A leading =, +, - or @ makes a spreadsheet read the cell as a formula rather than text, so
 * a task named "=1+1" becomes executable in whoever's hands the file ends up in. The
 * apostrophe is the conventional defusing prefix and spreadsheets strip it on display.
 */
function defuseFormula(text: string): string {
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value: string | number | null): string {
    if (value === null) return '';
    if (typeof value === 'number') return String(value);

    const text = defuseFormula(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CRLF and a trailing newline, which is what RFC 4180 readers and Excel both expect. */
export function sessionsToCsv(sessions: ExportedSession[]): string {
    const rows = [
        SESSION_CSV_COLUMNS.map((column) => column.header),
        ...sessions.map((session) => SESSION_CSV_COLUMNS.map((column) => csvCell(column.value(session)))),
    ];

    return rows.map((cells) => cells.join(',')).join('\r\n') + '\r\n';
}
