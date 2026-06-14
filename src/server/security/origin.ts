const DEFAULT_PORTS = {
    'http:': '80',
    'https:': '443',
} as const;

/**
 * Normalize an origin/URL to `scheme://host[:port]`, or return null when the input is
 * not a parseable absolute URL. Browsers send a literal `Origin: null` for opaque
 * origins (sandboxed iframes, some redirects, `file://`); previously `new URL('null')`
 * threw and the unguarded throw surfaced as a 500 instead of a clean 403.
 */
function normalizeOrigin(origin: string): string | null {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return null;
    }

    const defaultPort = DEFAULT_PORTS[url.protocol as keyof typeof DEFAULT_PORTS];
    const normalizedPort = url.port && url.port !== defaultPort ? `:${url.port}` : '';

    return `${url.protocol}//${url.hostname}${normalizedPort}`.toLowerCase();
}

export function parseAllowedOrigins(rawOrigins: string | undefined) {
    if (!rawOrigins) {
        return new Set<string>();
    }

    return new Set(
        rawOrigins
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
            .map((origin) => normalizeOrigin(origin))
            .filter((origin): origin is string => origin !== null),
    );
}

export function isTrustedOrigin(origin: string, requestUrl: string, allowedOrigins: ReadonlySet<string>) {
    const normalizedOrigin = normalizeOrigin(origin);
    const requestOrigin = normalizeOrigin(requestUrl);

    // An unparseable origin (e.g. `null`) is never trusted — treat it as cross-origin.
    if (!normalizedOrigin || !requestOrigin) {
        return false;
    }

    return normalizedOrigin === requestOrigin || allowedOrigins.has(normalizedOrigin);
}
