'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LandingNavBar } from './LandingNavBar'
import { HeroSection } from './HeroSection'
import { FeaturesGrid } from './FeaturesGrid'
import { HowItWorks } from './HowItWorks'
import { PricingCards } from './PricingCards'
import { ComparisonTable } from './ComparisonTable'
import { BenefitsSection } from './BenefitsSection'
import { CTASection } from './CTASection'
import { Footer } from './Footer'

export function HomePageClient() {
  const router = useRouter()

  const handleStartStreaming = useCallback(() => {
    router.push('/login')
  }, [router])

  return (
    <div className="min-h-screen">
      <LandingNavBar onStartStreaming={handleStartStreaming} />
      <HeroSection onStartStreaming={handleStartStreaming} />
      <FeaturesGrid />
      <HowItWorks />
      <PricingCards onStartStreaming={handleStartStreaming} />
      <ComparisonTable />
      <BenefitsSection />
      <CTASection onStartStreaming={handleStartStreaming} />
      <Footer />
    </div>
  )
}
