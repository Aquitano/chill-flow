import Link from 'next/link';

export function Footer() {
    const links = [
        {
            title: 'Product',
            items: [
                { label: 'Workspace', href: '/app' },
                { label: 'Soundscapes', href: '/soundscapes' },
                { label: 'Account', href: '/account' },
            ],
        },
        {
            title: 'Explore',
            items: [
                { label: 'Inside the room', href: '/#inside' },
                { label: 'Hear the room', href: '/#listen' },
                { label: 'Modes', href: '/#modes' },
            ],
        },
        {
            title: 'Elsewhere',
            items: [{ label: 'GitHub', href: 'https://github.com/aquitano/chill-flow' }],
        },
    ];

    return (
        <footer className="relative z-10 mt-32">
            <div className="absolute inset-x-0 h-px bg-linear-to-r from-transparent via-white/15 to-transparent" />
            <div className="mx-auto max-w-6xl px-6 py-14">
                <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <div className="text-lg font-semibold tracking-tight text-ink">ChillFlow</div>
                        <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-dim">
                            A calm room for deep work — lo-fi sound, a focus timer, and your tasks, saved between
                            sessions.
                        </p>
                    </div>
                    {links.map((section) => (
                        <div key={section.title}>
                            <h3 className="text-sm font-medium text-ink-mid">{section.title}</h3>
                            <ul className="mt-4 space-y-2.5">
                                {section.items.map((item) => (
                                    <li key={item.label}>
                                        <Link
                                            href={item.href}
                                            className="text-sm text-ink-dim transition-colors hover:text-ink"
                                        >
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <p className="mt-14 text-sm text-ink-dim">© 2026 ChillFlow. Built for focused work.</p>
            </div>
        </footer>
    );
}
