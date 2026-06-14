import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { consumeRateLimit } from '../rate-limit';

// The middleware keys buckets on the authenticated userId, so the identifier here is one.
describe('rate limiting', () => {
    it('permits requests up to the configured limit', () => {
        const options = { key: 'tasks:create:test-allow', limit: 2, windowMs: 1000 };

        expect(consumeRateLimit('user_alice', options, 1).count).toBe(1);
        expect(consumeRateLimit('user_alice', options, 2).count).toBe(2);
    });

    it('blocks requests after the configured limit', () => {
        const options = { key: 'tasks:create:test-block', limit: 1, windowMs: 1000 };

        consumeRateLimit('user_alice', options, 1);

        expect(() => consumeRateLimit('user_alice', options, 2)).toThrow(HTTPException);
    });

    it('tracks each userId in its own bucket', () => {
        const options = { key: 'tasks:create:test-isolation', limit: 1, windowMs: 1000 };

        consumeRateLimit('user_alice', options, 1);

        expect(() => consumeRateLimit('user_alice', options, 1)).toThrow(HTTPException);
        expect(consumeRateLimit('user_bob', options, 1).count).toBe(1);
    });

    it('resets the counter after the time window elapses', () => {
        const options = { key: 'tasks:create:test-reset', limit: 1, windowMs: 1000 };

        consumeRateLimit('user_alice', options, 1);

        expect(() => consumeRateLimit('user_alice', options, 500)).toThrow(HTTPException);

        expect(consumeRateLimit('user_alice', options, 1002).count).toBe(1);
    });
});
