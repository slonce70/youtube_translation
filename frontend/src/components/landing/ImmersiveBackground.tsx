'use client'

import { useEffect, useMemo, useRef } from 'react'

type Meteor = {
  id: number
  left: number
  top: number
  height: number
  duration: number
  delay: number
}

export function ImmersiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const meteors = useMemo<Meteor[]>(
    () =>
      Array.from({ length: 8 }, (_, index) => ({
        id: index,
        left: 8 + ((index * 17) % 84),
        top: -18 - ((index * 11) % 30),
        height: 120 + ((index * 37) % 180),
        duration: 6 + ((index * 3.1) % 8),
        delay: -((index * 2.4) % 14),
      })),
    []
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const root = document.documentElement
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let rafId = 0
    let scrollTimer: number | undefined
    let isScrolling = false
    let width = 0
    let height = 0
    let lastFrameTime = 0
    let mouseX = window.innerWidth * 0.56
    let mouseY = window.innerHeight * 0.26
    let beamBars: Array<{ x: number; width: number; phase: number; amp: number; speed: number }> = []
    let auroras: Array<{
      x: number
      y: number
      radius: number
      hue: string
      speed: number
      phase: number
    }> = []

    const setSpotlight = (x: number, y: number) => {
      root.style.setProperty('--stream-v3-mx', `${x}px`)
      root.style.setProperty('--stream-v3-my', `${y}px`)
    }

    const resize = () => {
      const dprCap = window.innerWidth >= 1440 ? 1.1 : 1
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
      width = window.innerWidth
      height = window.innerHeight

      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      auroras = Array.from({ length: 5 }, (_, index) => ({
        x: width * (0.08 + Math.random() * 0.84),
        y: height * (0.12 + Math.random() * 0.58),
        radius: 180 + Math.random() * 220,
        hue: index % 2 === 0 ? '255, 71, 87' : '94, 231, 255',
        speed: 0.12 + Math.random() * 0.16,
        phase: Math.random() * Math.PI * 2,
      }))

      const step = width >= 1280 ? 18 : 22
      beamBars = []
      for (let x = 0; x < width + step; x += step) {
        beamBars.push({
          x,
          width: width >= 1280 ? 7 : 6,
          phase: Math.random() * Math.PI * 2,
          amp: 0.45 + Math.random() * 0.7,
          speed: 0.75 + Math.random() * 0.9,
        })
      }
    }

    const drawAuroras = (time: number) => {
      auroras.forEach((blob, index) => {
        const driftX = Math.sin(time * blob.speed + blob.phase) * 28
        const driftY = Math.cos(time * blob.speed * 0.82 + blob.phase) * 18
        const gradient = context.createRadialGradient(
          blob.x + driftX,
          blob.y + driftY,
          0,
          blob.x + driftX,
          blob.y + driftY,
          blob.radius
        )
        gradient.addColorStop(0, `rgba(${blob.hue}, ${0.16 + index * 0.012})`)
        gradient.addColorStop(1, `rgba(${blob.hue}, 0)`)
        context.fillStyle = gradient
        context.beginPath()
        context.arc(blob.x + driftX, blob.y + driftY, blob.radius, 0, Math.PI * 2)
        context.fill()
      })
    }

    const drawBeams = () => {
      for (let i = 0; i < 6; i += 1) {
        const startX = width * (0.12 + i * 0.15)
        const gradient = context.createLinearGradient(startX, 0, startX - 260, height)
        gradient.addColorStop(0, 'rgba(255,255,255,0.02)')
        gradient.addColorStop(
          0.5,
          i % 2 === 0 ? 'rgba(255,71,87,0.06)' : 'rgba(94,231,255,0.05)'
        )
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        context.strokeStyle = gradient
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(startX, -40)
        context.lineTo(startX - 280, height + 60)
        context.stroke()
      }
    }

    const drawRings = (time: number) => {
      const centerX = width * 0.74 + (mouseX - width * 0.5) * 0.05
      const centerY = height * 0.36 + (mouseY - height * 0.3) * 0.04
      for (let i = 0; i < 4; i += 1) {
        const cycle = (time * 36 + i * 44) % 220
        const radius = 60 + cycle * 2.35
        const alpha = Math.max(0, 0.2 - cycle / 1120)
        context.strokeStyle = `rgba(${
          i % 2 === 0 ? '255,71,87' : '94,231,255'
        }, ${alpha})`
        context.lineWidth = 1.4
        context.beginPath()
        context.arc(centerX, centerY, radius, 0, Math.PI * 2)
        context.stroke()
      }
    }

    const drawEqualizer = (time: number, simplified: boolean) => {
      const baseline = height - 84
      const limit = simplified ? Math.ceil(beamBars.length * 0.45) : beamBars.length

      for (let index = 0; index < limit; index += 1) {
        const bar = beamBars[index]
        const v1 = Math.sin(time * bar.speed + bar.phase)
        const v2 = Math.sin(time * 0.52 + index * 0.08)
        const v3 = Math.cos(time * 0.18 + index * 0.03)
        const strength = Math.abs(v1 * 0.56 + v2 * 0.28 + v3 * 0.16)
        const heightValue = 8 + strength * height * (simplified ? 0.14 : 0.22) * bar.amp
        const gradient = context.createLinearGradient(
          bar.x,
          baseline - heightValue,
          bar.x,
          baseline + heightValue * 0.28
        )
        gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
        gradient.addColorStop(0.35, 'rgba(255,71,87,0.55)')
        gradient.addColorStop(1, 'rgba(94,231,255,0.04)')
        context.fillStyle = gradient
        context.fillRect(bar.x, baseline - heightValue, bar.width, heightValue)
      }
    }

    const onMouseMove = (event: MouseEvent) => {
      mouseX = event.clientX
      mouseY = event.clientY
      setSpotlight(mouseX, mouseY)
    }

    const onScroll = () => {
      isScrolling = true
      if (scrollTimer !== undefined) {
        window.clearTimeout(scrollTimer)
      }
      scrollTimer = window.setTimeout(() => {
        isScrolling = false
      }, 140)
    }

    const frame = (now: number) => {
      rafId = window.requestAnimationFrame(frame)

      if (document.visibilityState !== 'visible') {
        return
      }

      const minFrameGap = reducedMotion ? 1000 / 18 : 1000 / 28
      if (now - lastFrameTime < minFrameGap) {
        return
      }
      lastFrameTime = now

      const time = now * 0.001
      context.clearRect(0, 0, width, height)
      drawAuroras(time)
      drawBeams()
      if (!isScrolling) {
        drawRings(time)
      }
      drawEqualizer(time, isScrolling)
    }

    setSpotlight(mouseX, mouseY)
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    rafId = window.requestAnimationFrame(frame)

    return () => {
      window.cancelAnimationFrame(rafId)
      if (scrollTimer !== undefined) {
        window.clearTimeout(scrollTimer)
      }
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="stream-v3-canvas"
        aria-hidden="true"
      />
      <div className="stream-v3-grid" aria-hidden="true" />
      <div className="stream-v3-noise" aria-hidden="true" />
      <div className="stream-v3-scan" aria-hidden="true" />
      <div className="stream-v3-spotlight" aria-hidden="true" />

      <div className="stream-v3-meteor-layer" aria-hidden="true">
        {meteors.map((meteor) => (
          <span
            key={meteor.id}
            className="stream-v3-meteor"
            style={{
              left: `${meteor.left}%`,
              top: `${meteor.top}%`,
              height: `${meteor.height}px`,
              animationDuration: `${meteor.duration}s`,
              animationDelay: `${meteor.delay}s`,
            }}
          />
        ))}
      </div>
    </>
  )
}
