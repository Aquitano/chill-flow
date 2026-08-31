import { ImageResponse } from 'next/og';

export const alt = 'ChillFlow — lo-fi beats and focus timers for deep work';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Rendered at build time; the palette mirrors globals.css (night ground, ember accent)
// and the ring is the timer dial three quarters through a block.
export default function OpenGraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 96px',
                    backgroundColor: '#0e0c08',
                    backgroundImage: 'radial-gradient(circle at 78% 45%, #221d13 0%, #0e0c08 60%)',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 640 }}>
                    <div style={{ fontSize: 96, fontWeight: 600, color: '#ebe7df' }}>ChillFlow</div>
                    <div style={{ marginTop: 24, fontSize: 36, lineHeight: 1.4, color: '#c4bfb4' }}>
                        Curated lo-fi beats, ambient sound, and focus timers for deep work.
                    </div>
                </div>
                <svg width="300" height="300" viewBox="0 0 512 512">
                    <circle
                        cx="256"
                        cy="256"
                        r="150"
                        fill="none"
                        stroke="#e7b876"
                        strokeWidth="28"
                        strokeLinecap="round"
                        strokeDasharray="706 236"
                        transform="rotate(-90 256 256)"
                    />
                    <circle cx="256" cy="256" r="44" fill="#e7b876" />
                </svg>
            </div>
        ),
        size,
    );
}
