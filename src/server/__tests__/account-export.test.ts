import { describe, expect, it } from 'vitest';
import { exportFileName, isExportFormat, sessionsToCsv, type ExportedSession } from '../account-export';

function sessionWith(overrides: Partial<ExportedSession> = {}): ExportedSession {
    return {
        id: 'a2b1c0d9-0000-4000-8000-000000000001',
        mode: 'DeepWork',
        timerKind: 'focus',
        status: 'completed',
        plannedDurationSeconds: 1500,
        elapsedSeconds: 1500,
        trackId: 'deep-focus-01',
        taskId: 'a2b1c0d9-0000-4000-8000-000000000002',
        taskText: 'Review notes',
        startedAt: '2026-08-06T09:00:00.000Z',
        completedAt: '2026-08-06T09:25:00.000Z',
        canceledAt: null,
        cycleCompletedAt: null,
        ...overrides,
    };
}

function cellsOf(csv: string, rowIndex: number): string {
    return csv.split('\r\n')[rowIndex] ?? '';
}

describe('isExportFormat', () => {
    it('accepts the supported formats only', () => {
        expect(isExportFormat('json')).toBe(true);
        expect(isExportFormat('csv')).toBe(true);
        expect(isExportFormat('xlsx')).toBe(false);
        expect(isExportFormat(null)).toBe(false);
    });
});

describe('exportFileName', () => {
    it('names the file after the format and the export day', () => {
        const exportedAt = new Date('2026-08-06T14:30:00.000Z');
        expect(exportFileName('json', exportedAt)).toBe('chillflow-export-2026-08-06.json');
        expect(exportFileName('csv', exportedAt)).toBe('chillflow-sessions-2026-08-06.csv');
    });
});

describe('sessionsToCsv', () => {
    it('writes a header even with no sessions', () => {
        const csv = sessionsToCsv([]);
        expect(cellsOf(csv, 0)).toBe(
            'id,mode,timerKind,status,plannedDurationSeconds,elapsedSeconds,taskId,taskText,trackId,startedAt,completedAt,canceledAt,cycleCompletedAt',
        );
        expect(csv.endsWith('\r\n')).toBe(true);
    });

    it('writes one row per session', () => {
        const csv = sessionsToCsv([sessionWith(), sessionWith({ id: 'second' })]);
        expect(csv.trimEnd().split('\r\n')).toHaveLength(3);
    });

    it('leaves a missing timestamp empty rather than writing a placeholder', () => {
        const csv = sessionsToCsv([sessionWith({ status: 'canceled', completedAt: null, taskText: null })]);
        expect(cellsOf(csv, 1)).toContain(',,');
    });

    it('quotes a task name holding a comma, a quote, or a newline', () => {
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: 'Draft, then edit' })]), 1)).toContain(
            '"Draft, then edit"',
        );
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: 'Read "Dune"' })]), 1)).toContain('"Read ""Dune"""');
        expect(sessionsToCsv([sessionWith({ taskText: 'Line one\nLine two' })])).toContain('"Line one\nLine two"');
    });

    it('defuses a task name a spreadsheet would run as a formula', () => {
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: '=1+1' })]), 1)).toContain("'=1+1");
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: '@SUM(A1)' })]), 1)).toContain("'@SUM(A1)");
        // Still defused when the cell also needs quoting for its comma.
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: '=A1,B1' })]), 1)).toContain('"\'=A1,B1"');
    });

    it('leaves an ordinary task name untouched', () => {
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: 'Review notes' })]), 1)).toContain('Review notes');
        expect(cellsOf(sessionsToCsv([sessionWith({ taskText: 'Review notes' })]), 1)).not.toContain("'Review");
    });
});
