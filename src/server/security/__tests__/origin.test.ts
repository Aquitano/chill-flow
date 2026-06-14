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

    it('treats an opaque `null` origin as untrusted instead of throwing', () => {
        expect(() =>
            isTrustedOrigin('null', 'https://chill-flow.app/api/tasks/create', new Set()),
        ).not.toThrow();
        expect(isTrustedOrigin('null', 'https://chill-flow.app/api/tasks/create', new Set())).toBe(false);
    });

    it('rejects other unparseable origins without throwing', () => {
        expect(isTrustedOrigin('not a url', 'https://chill-flow.app/api/tasks/create', new Set())).toBe(false);
    });

    it('skips unparseable allowlist entries instead of throwing', () => {
        const allowedOrigins = parseAllowedOrigins('null, , https://example.com, garbage');

        expect(allowedOrigins.has('https://example.com')).toBe(true);
        expect(allowedOrigins.has('null')).toBe(false);
    });
});
