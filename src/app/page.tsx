'use client';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { ClosingSection } from '@/features/landing/closing';
import { Hero } from '@/features/landing/hero';
import { ListenSection } from '@/features/landing/listen';
import { LoopSection } from '@/features/landing/loop';
import { ModesSection } from '@/features/landing/modes';
import { StatementSection } from '@/features/landing/statement';

export default function Home() {
    return (
        <div className="bg-main relative min-h-screen overflow-x-clip font-sans">
            <Header />
            <Hero />
            <LoopSection />
            <StatementSection />
            <ListenSection />
            <ModesSection />
            <ClosingSection />
            <Footer />
        </div>
    );
}
