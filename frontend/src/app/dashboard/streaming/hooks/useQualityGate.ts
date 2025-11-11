'use client'

import { useCallback, useMemo, useState } from 'react'

import type { StreamQualityResponse } from '@/lib/types'

export type QualityGateState = {
  streamName?: string | null
  quality: StreamQualityResponse
} | null

export type QualityViolationGroup = {
  assetKey: string
  filename: string | null
  position: number
  issues: Array<{
    violation: StreamQualityResponse['violations'][number]
    details: string[]
  }>
}

export const useQualityGate = () => {
  const [qualityGate, setQualityGate] = useState<QualityGateState>(null)

  const openQualityGate = useCallback((state: NonNullable<QualityGateState>) => {
    setQualityGate(state)
  }, [])

  const closeQualityGate = useCallback(() => {
    setQualityGate(null)
  }, [])

  const groupedViolations = useMemo<QualityViolationGroup[]>(() => {
    if (!qualityGate?.quality?.violations?.length) {
      return []
    }

    const groups = new Map<
      string,
      {
        assetKey: string
        filename: string | null
        position: number
        issues: Map<
          string,
          {
            violation: StreamQualityResponse['violations'][number]
            details: string[]
          }
        >
      }
    >()

    qualityGate.quality.violations.forEach((violation, index) => {
      const assetKey =
        violation.asset_id ??
        violation.filename ??
        (typeof violation.position === 'number'
          ? `position-${violation.position}`
          : `index-${index}`)

      if (!groups.has(assetKey)) {
        groups.set(assetKey, {
          assetKey,
          filename: violation.filename ?? null,
          position: typeof violation.position === 'number' ? violation.position : index,
          issues: new Map(),
        })
      }

      const group = groups.get(assetKey)!
      if (typeof violation.position === 'number' && violation.position < group.position) {
        group.position = violation.position
      }

      const issueKey = violation.code ?? `code-${group.issues.size}`
      const existingIssue = group.issues.get(issueKey)

      if (!existingIssue) {
        group.issues.set(issueKey, {
          violation,
          details: violation.message ? [violation.message] : [],
        })
        return
      }

      const existingHasContext =
        existingIssue.violation.allowed != null || existingIssue.violation.current != null
      const newHasContext = violation.allowed != null || violation.current != null

      if (!existingHasContext && newHasContext) {
        existingIssue.violation = { ...violation }
      }

      if (violation.message && !existingIssue.details.includes(violation.message)) {
        existingIssue.details.push(violation.message)
      }
    })

    return Array.from(groups.values())
      .map(({ issues, ...rest }) => ({
        ...rest,
        issues: Array.from(issues.values()),
      }))
      .sort((a, b) => a.position - b.position)
  }, [qualityGate])

  return {
    qualityGate,
    openQualityGate,
    closeQualityGate,
    groupedViolations,
  }
}
