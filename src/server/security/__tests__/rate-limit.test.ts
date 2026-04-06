import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { consumeRateLimit } from '../rate-limit';

describe('rate limiting', () => {
    it('permits requests up to the configured limit', () => {
        const options = { key: 'tasks:create:test-allow', limit: 2, windowMs: 1000 };

        expect(consumeRateLimit('127.0.0.1', options, 1).count).toBe(1);
        expect(consumeRateLimit('127.0.0.1', options, 2).count).toBe(2);
    });

    it('blocks requests after the configured limit', () => {
        const options = { key: 'tasks:create:test-block', limit: 1, windowMs: 1000 };

        consumeRateLimit('127.0.0.1', options, 1);

        expect(() => consumeRateLimit('127.0.0.1', options, 2)).toThrow(HTTPException);
    });

    it('resets the counter after the time window elapses', () => {
        const options = { key: 'tasks:create:test-reset', limit: 1, windowMs: 1000 };

        consumeRateLimit('127.0.0.1', options, 1);

        expect(() => consumeRateLimit('127.0.0.1', options, 500)).toThrow(HTTPException);

        expect(consumeRateLimit('127.0.0.1', options, 1002).count).toBe(1);
    });
});
