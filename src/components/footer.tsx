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
                { label: 'Features', href: '/#features' },
                { label: 'How It Works', href: '/#how-it-works' },
                { label: 'README', href: 'https://github.com/aquitano/chill-flow' },
            ],
        },
        {
            title: 'Status',
            items: [
                { label: 'Auth Required', href: '/account' },
                { label: 'Task Persistence', href: '/app' },
                { label: 'Track Catalog', href: '/soundscapes' },
            ],
        },
    ];

    return (
        <footer className="relative z-10 mt-32">
            <div className="absolute inset-x-0 h-px bg-linear-to-r from-transparent via-white/20 to-transparent" />
            <div className="mx-auto max-w-7xl px-8 py-12">
                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <div className="text-xl font-bold">ChillFlow</div>
                        <p className="mt-4 text-sm text-neutral-400">
                            A real focus workspace with music, timer blocks, task tracking, and persistent preferences.
                        </p>
                    </div>
                    {links.map((section) => (
                        <div key={section.title}>
                            <h3 className="font-semibold">{section.title}</h3>
                            <ul className="mt-4 space-y-2">
                                {section.items.map((item) => (
                                    <li key={item.label}>
                                        <Link
                                            href={item.href}
                                            className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                                        >
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <div className="mt-3 pt-8 text-center text-sm text-neutral-400">
                    <div className="inset-x-0 mb-4 h-px bg-linear-to-r from-transparent via-white/20 to-transparent" />
                    <p>© 2026 ChillFlow. Built for focused work.</p>
                </div>
            </div>
        </footer>
    );
}
