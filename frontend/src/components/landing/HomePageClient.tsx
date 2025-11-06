'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { LandingNavBar } from './LandingNavBar'
import { HeroSection } from './HeroSection'
import { FeaturesGrid } from './FeaturesGrid'
import { HowItWorks } from './HowItWorks'
import { StatsSection } from './StatsSection'
import { PricingCards } from './PricingCards'
import { ComparisonTable } from './ComparisonTable'
import { BenefitsSection } from './BenefitsSection'
import { CTASection } from './CTASection'
import { Footer } from './Footer'

export function HomePageClient() {
  const router = useRouter()

  const handleStartStreaming = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    router.push(data.session ? '/dashboard' : '/login')
  }, [router])

  return (
    <div className="min-h-screen">
      <LandingNavBar onStartStreaming={handleStartStreaming} />
      <HeroSection onStartStreaming={handleStartStreaming} />
      <FeaturesGrid />
      <HowItWorks />
      <StatsSection />
      <PricingCards onStartStreaming={handleStartStreaming} />
      <ComparisonTable />
      <BenefitsSection />
      <CTASection onStartStreaming={handleStartStreaming} />
      <Footer />
    </div>
  )
}
