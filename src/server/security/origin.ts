const DEFAULT_PORTS = {
    'http:': '80',
    'https:': '443',
} as const;

function normalizeOrigin(origin: string) {
    const url = new URL(origin);
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
            .map((origin) => normalizeOrigin(origin)),
    );
}

export function isTrustedOrigin(origin: string, requestUrl: string, allowedOrigins: ReadonlySet<string>) {
    const normalizedOrigin = normalizeOrigin(origin);
    const requestOrigin = normalizeOrigin(requestUrl);

    return normalizedOrigin === requestOrigin || allowedOrigins.has(normalizedOrigin);
}
