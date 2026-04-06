import { describe, expect, it } from 'vitest';
import { isTrustedOrigin, parseAllowedOrigins } from '../origin';

describe('origin security', () => {
    it('normalizes configured origins before storing them', () => {
        const allowedOrigins = parseAllowedOrigins('https://example.com:443, http://localhost:3000');

        expect(allowedOrigins.has('https://example.com')).toBe(true);
        expect(allowedOrigins.has('http://localhost:3000')).toBe(true);
    });

    it('rejects cross-origin requests that are not allowlisted', () => {
        expect(
            isTrustedOrigin('https://evil.example', 'https://chill-flow.app/api/tasks/list', new Set(['https://test.example'])),
        ).toBe(false);
    });
});
