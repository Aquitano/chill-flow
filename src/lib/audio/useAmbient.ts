'use client';

import { AmbientSound } from '@/models/app';
import { useEffect, useMemo, useState } from 'react';
import { AmbientBoard, getAmbientMixer } from './ambient';

export function useAmbient() {
    const mixer = useMemo(() => getAmbientMixer(), []);
    const [board, setBoard] = useState<AmbientBoard>(() => mixer.getBoard());
    const [sounds, setSounds] = useState<AmbientSound[]>(() => mixer.getSounds());
    const [powered, setPowered] = useState(() => mixer.isPowered());

    useEffect(() => {
        const handleChange = () => {
            setBoard(mixer.getBoard());
            setSounds(mixer.getSounds());
            setPowered(mixer.isPowered());
        };
        mixer.addEventListener('change', handleChange);
        // Re-sync in case another consumer changed the board between render and subscribe.
        handleChange();
        return () => mixer.removeEventListener('change', handleChange);
    }, [mixer]);

    const activeCount = powered ? board.filter((slot) => slot && !slot.muted).length : 0;

    return { mixer, board, sounds, powered, activeCount };
}
