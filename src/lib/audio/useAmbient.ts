'use client';

import { useEffect, useMemo, useState } from 'react';
import { AmbientState, getAmbientMixer } from './ambient';

export function useAmbient() {
    const mixer = useMemo(() => getAmbientMixer(), []);
    const [state, setState] = useState<AmbientState>(() => mixer.getState());

    useEffect(() => {
        const handleChange = () => setState(mixer.getState());
        mixer.addEventListener('change', handleChange);
        // Re-sync in case another consumer changed layers between render and subscribe.
        handleChange();
        return () => mixer.removeEventListener('change', handleChange);
    }, [mixer]);

    const activeCount = Object.values(state).filter((layer) => layer.enabled).length;

    return { mixer, state, activeCount };
}
