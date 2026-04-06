import { j } from '@/server/jstack';
import { HTTPException } from 'hono/http-exception';

type RateLimitOptions = {
    /**
     * A unique identifier for the rate limit rule, e.g. "preferences:update".
     */
    key: string;

    /**
     * The maximum number of requests allowed within the window before throttling.
     */
    limit: number;

    /**
     * The length of the rate limit window in milliseconds.
     */
    windowMs: number;
};

type RateLimitEntry = {
    /**
     * The number of requests seen in the current window.
     */
    count: number;

    /**
     * The timestamp when the current window expires and the bucket can be reset.
     */
    resetAt: number;
};

const MAX_BUCKETS = 5000;
const rateLimitBuckets = new Map<string, RateLimitEntry>();

function getClientAddress(forwardedFor: string | undefined) {
    return forwardedFor?.split(',')[0]?.trim() ?? 'anonymous';
}

export function consumeRateLimit(identifier: string, options: RateLimitOptions, now = Date.now()) {
    const key = `${options.key}:${identifier}`;
    const existingEntry = rateLimitBuckets.get(key);

    if (!existingEntry || existingEntry.resetAt <= now) {
        const nextEntry = {
            count: 1,
            resetAt: now + options.windowMs,
        };
        rateLimitBuckets.set(key, nextEntry);

        if (rateLimitBuckets.size > MAX_BUCKETS) {
            for (const [bucketKey, bucket] of rateLimitBuckets) {
                if (bucket.resetAt <= now) {
                    rateLimitBuckets.delete(bucketKey);
                }
            }
        }

        return nextEntry;
    }

    if (existingEntry.count >= options.limit) {
        throw new HTTPException(429, {
            message: 'Too many requests. Please retry later.',
        });
    }

    existingEntry.count += 1;
    return existingEntry;
}


export function createRateLimitMiddleware(options: RateLimitOptions) {
    return j.middleware(async ({ c, next }) => {
        const identifier = getClientAddress(c.req.header('x-forwarded-for'));
        const result = consumeRateLimit(identifier, options);

        c.header('X-RateLimit-Limit', String(options.limit));
        c.header('X-RateLimit-Remaining', String(Math.max(0, options.limit - result.count)));
        c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

        return next();
    });
}
