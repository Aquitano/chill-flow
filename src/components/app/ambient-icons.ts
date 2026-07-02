import { Bird, CloudLightning, CloudRain, Coffee, Flame, Moon, Waves, Wind, type LucideIcon } from 'lucide-react';

/** Icon per ambient sound category (see ambient_sounds.category). */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
    rain: CloudRain,
    storm: CloudLightning,
    wind: Wind,
    fire: Flame,
    birds: Bird,
    water: Waves,
    people: Coffee,
    night: Moon,
};

export function ambientCategoryIcon(category: string): LucideIcon {
    return CATEGORY_ICONS[category] ?? Waves;
}
