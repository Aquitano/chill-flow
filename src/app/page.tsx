'use client';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { FeaturesSection } from '@/features/landing/features';
import { Hero } from '@/features/landing/hero';
import { StepsSection } from '@/features/landing/steps';
import { motion } from 'framer-motion';

export default function Home() {
    return (
        <div className="bg-main relative min-h-screen overflow-hidden font-sans">
            <Header />
            <Hero />

            {/* Animated gradient background element */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.5, delay: 0.5 }}
                className="pointer-events-none fixed inset-0"
                style={{
                    background: 'radial-gradient(circle at top, rgba(255,255,255,0.1), transparent 50%)',
                }}
            />

            {/* Animated divider */}
            <motion.div
                initial={{ opacity: 0, scaleX: 0 }}
                whileInView={{ opacity: 1, scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1 }}
                className="relative z-10 my-25 h-px w-full"
            >
                <div className="absolute inset-x-0 h-px bg-linear-to-r from-transparent via-white/20 to-transparent" />
            </motion.div>

            <FeaturesSection />

            <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="relative z-10 my-16 flex justify-center"
            >
                <div className="h-12 w-px bg-linear-to-b from-transparent via-white/20 to-transparent" />
            </motion.div>

            <StepsSection />

            <Footer />
        </div>
    );
}
