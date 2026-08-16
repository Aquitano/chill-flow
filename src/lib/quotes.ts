import { Quote } from '@/models/app';

export const quotes: Quote[] = [
    {
        id: 'wells',
        text: 'Our true nationality is humankind.',
        author: 'H. G. Wells',
        tags: ['humanity', 'unity'],
    },
    {
        id: 'leonard',
        text: 'When it gets quiet, work gets loud.',
        author: 'Tom Leonard',
        tags: ['focus', 'quiet'],
    },
    {
        id: 'russell',
        text: 'To be able to concentrate for a considerable time is essential to difficult achievement.',
        author: 'Bertrand Russell',
        tags: ['concentration', 'achievement'],
    },
];

/** Tags each focus mode prefers, so the on-screen quote feels relevant to the mode. */
const MODE_QUOTE_TAGS: Record<string, string[]> = {
    DeepWork: ['focus', 'quiet'],
    LearnFlow: ['concentration', 'achievement', 'focus'],
    TaskDrive: ['focus', 'achievement', 'momentum'],
    CreativeSpark: ['creative', 'humanity', 'unity'],
};

/**
 * Pick a quote for the given mode. Prefers a quote whose tags overlap the mode's
 * preferred tags; otherwise falls back to a deterministic-by-mode choice so each mode
 * still shows a stable, varied quote instead of always quotes[0].
 */
export function selectQuoteForMode(availableQuotes: Quote[], mode: string): Quote | null {
    if (availableQuotes.length === 0) {
        return null;
    }

    const preferredTags = MODE_QUOTE_TAGS[mode] ?? [];
    const match = availableQuotes.find((quote) => quote.tags.some((tag) => preferredTags.includes(tag)));
    if (match) {
        return match;
    }

    let hash = 0;
    for (let index = 0; index < mode.length; index += 1) {
        hash = (hash * 31 + mode.charCodeAt(index)) >>> 0;
    }
    return availableQuotes[hash % availableQuotes.length] ?? availableQuotes[0] ?? null;
}
