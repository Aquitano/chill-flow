import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY, parseTaskInput, resolvePriority, stripPriorityTokens } from '../task-parser';

describe('parseTaskInput', () => {
    it('returns trimmed text and no token when nothing is typed', () => {
        const parsed = parseTaskInput('  write the report  ');
        expect(parsed).toEqual({ text: 'write the report', priority: null, token: null });
    });

    it('maps p1-p3 onto high/medium/low', () => {
        expect(parseTaskInput('ship it p1').priority).toBe('high');
        expect(parseTaskInput('ship it p2').priority).toBe('medium');
        expect(parseTaskInput('ship it p3').priority).toBe('low');
    });

    it('treats p4 as "no priority" (null) and clears to the default on resolve', () => {
        const parsed = parseTaskInput('ship it p4');
        expect(parsed.priority).toBeNull();
        expect(parsed.token?.level).toBe(4);
        expect(resolvePriority(parsed, 'high')).toBe(DEFAULT_PRIORITY);
    });

    it('strips the token from the text and collapses the gap', () => {
        expect(parseTaskInput('buy p1 milk').text).toBe('buy milk');
        expect(parseTaskInput('p2 buy milk').text).toBe('buy milk');
        expect(parseTaskInput('buy milk p3').text).toBe('buy milk');
    });

    it('is case-insensitive', () => {
        const parsed = parseTaskInput('ship it P1');
        expect(parsed.priority).toBe('high');
        expect(parsed.token?.raw).toBe('P1');
    });

    it('only matches a standalone token, not text embedded in a word', () => {
        expect(parseTaskInput('step1 of the plan').token).toBeNull();
        expect(parseTaskInput('deploy p12').token).toBeNull();
        expect(parseTaskInput('priority p5 work').token).toBeNull();
    });

    it('uses the last token when several are typed', () => {
        const parsed = parseTaskInput('p1 draft p3 outline');
        expect(parsed.priority).toBe('low');
        expect(parsed.text).toBe('p1 draft outline');
    });

    it('reports the token span against the raw (untrimmed) input', () => {
        const raw = 'buy milk p1';
        const { token } = parseTaskInput(raw);
        expect(token).not.toBeNull();
        expect(raw.slice(token!.start, token!.end)).toBe('p1');
    });

    it('falls back to the manual priority when no token is present', () => {
        const parsed = parseTaskInput('just a task');
        expect(resolvePriority(parsed, 'high')).toBe('high');
    });
});

describe('stripPriorityTokens', () => {
    it('removes every standalone token, not just the last', () => {
        expect(stripPriorityTokens('email p2 boss p1')).toBe('email boss');
        expect(stripPriorityTokens('p1 draft p3 outline')).toBe('draft outline');
    });

    it('leaves text without tokens untouched (trimmed)', () => {
        expect(stripPriorityTokens('  write the report  ')).toBe('write the report');
        expect(stripPriorityTokens('step1 of the plan')).toBe('step1 of the plan');
    });

    it('handles adjacent tokens and collapses the gap', () => {
        expect(stripPriorityTokens('p1 p2 ship it')).toBe('ship it');
        expect(stripPriorityTokens('ship it p4')).toBe('ship it');
    });
});
