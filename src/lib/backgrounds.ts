import { Background } from '@/models/app';

export const backgroundCatalog: Background[] = [
    {
        id: 'rain-window',
        type: 'image',
        url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80',
        thumbnailUrl:
            'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=80',
        tags: ['rain', 'window', 'focus'],
        name: 'Rain Window',
    },
    {
        id: 'forest-night',
        type: 'image',
        url: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1600&q=80',
        thumbnailUrl:
            'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=400&q=80',
        tags: ['forest', 'night', 'calm'],
        name: 'Forest Night',
    },
    {
        id: 'ocean-dawn',
        type: 'image',
        url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80',
        thumbnailUrl:
            'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80',
        tags: ['ocean', 'dawn', 'breathe'],
        name: 'Ocean Dawn',
    },
];
