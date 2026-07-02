'use client';

import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';

type Particle = {
    x: number;
    y: number;
    radius: number;
    speed: number;
    drift: number;
    phase: number;
};

/**
 * Slow-drifting warm dust motes — the air of the room. Pure canvas, ~40 particles,
 * paused on hidden tabs. Renders nothing at all under reduced motion.
 */
export function EmberDust({ density = 36, className = '' }: { density?: number; className?: string }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const prefersReduced = useReducedMotion();

    useEffect(() => {
        if (prefersReduced) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        let width = 0;
        let height = 0;
        let raf = 0;
        let particles: Particle[] = [];

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const seed = () => {
            particles = Array.from({ length: density }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: 0.6 + Math.random() * 1.4,
                speed: 0.06 + Math.random() * 0.16,
                drift: (Math.random() - 0.5) * 0.12,
                phase: Math.random() * Math.PI * 2,
            }));
        };

        const tick = (time: number) => {
            ctx.clearRect(0, 0, width, height);
            for (const particle of particles) {
                particle.y -= particle.speed;
                particle.x += particle.drift + Math.sin(time / 4000 + particle.phase) * 0.08;
                if (particle.y < -4) {
                    particle.y = height + 4;
                    particle.x = Math.random() * width;
                }
                const flicker = 0.35 + 0.3 * Math.sin(time / 900 + particle.phase * 3);
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                ctx.fillStyle = `oklch(0.81 0.1 75 / ${Math.max(0.06, flicker * 0.4)})`;
                ctx.fill();
            }
            raf = requestAnimationFrame(tick);
        };

        const handleVisibility = () => {
            cancelAnimationFrame(raf);
            if (!document.hidden) raf = requestAnimationFrame(tick);
        };

        resize();
        seed();
        raf = requestAnimationFrame(tick);
        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [density, prefersReduced]);

    if (prefersReduced) return null;

    return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}
