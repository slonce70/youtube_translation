'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// SIGNAL palette: keep the globe within the single electric-indigo family
// (brand indigo + info blue + light indigo) instead of the old red/cyan/teal.
const ACCENT = 0x5b6cff
const CYAN = 0x58a6ff
const TEAL = 0xa6b0ff

export function Hero3DGlobe() {
  const mountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      return
    }

    const width = mount.clientWidth || 1
    const height = mount.clientHeight || 1
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    camera.position.set(0, 0.4, 8)

    const root = new THREE.Group()
    scene.add(root)

    const globeGroup = new THREE.Group()
    root.add(globeGroup)

    const sphereGeo = new THREE.SphereGeometry(2.2, 48, 32)
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.06 })
    globeGroup.add(new THREE.Mesh(sphereGeo, sphereMat))

    const meridianMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.32 })
    for (let m = 0; m < 8; m++) {
      const pts: THREE.Vector3[] = []
      const phi = (m / 8) * Math.PI
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2
        pts.push(
          new THREE.Vector3(
            2.21 * Math.sin(t) * Math.cos(phi),
            2.21 * Math.cos(t),
            2.21 * Math.sin(t) * Math.sin(phi)
          )
        )
      }
      globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), meridianMat))
    }
    for (let lat = -2; lat <= 2; lat++) {
      const pts: THREE.Vector3[] = []
      const y = lat * 0.7
      const r = Math.sqrt(Math.max(0, 2.21 * 2.21 - y * y))
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2
        pts.push(new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t)))
      }
      globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), meridianMat))
    }

    const coreMat = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
    })
    globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 32, 32), coreMat))
    const core2Mat = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    })
    const core2 = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 32), core2Mat)
    globeGroup.add(core2)

    const orbitGroup = new THREE.Group()
    root.add(orbitGroup)
    const makeRing = (radius: number, tilt: number, color: number, opacity = 0.6) => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2
        pts.push(new THREE.Vector3(radius * Math.cos(t), 0, radius * Math.sin(t)))
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity })
      )
      line.rotation.x = tilt
      return line
    }
    orbitGroup.add(makeRing(2.9, 0.4, ACCENT, 0.5))
    orbitGroup.add(makeRing(3.3, -0.3, CYAN, 0.4))
    orbitGroup.add(makeRing(3.7, 0.2, 0xffffff, 0.15))

    type Sat = { mesh: THREE.Mesh; radius: number; tilt: number; speed: number; phase: number }
    const satellites: Sat[] = []
    const makeSatellite = (radius: number, tilt: number, color: number, speed: number, phase: number) => {
      const sat = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 12, 12),
        new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending })
      )
      orbitGroup.add(sat)
      satellites.push({ mesh: sat, radius, tilt, speed, phase })
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending })
      )
      sat.add(halo)
    }
    makeSatellite(2.9, 0.4, ACCENT, 0.5, 0)
    makeSatellite(2.9, 0.4, 0xffffff, 0.5, Math.PI)
    makeSatellite(3.3, -0.3, CYAN, -0.35, 1)
    makeSatellite(3.7, 0.2, TEAL, 0.25, 2)

    const STREAM = 1500
    const sPos = new Float32Array(STREAM * 3)
    const sCol = new Float32Array(STREAM * 3)
    const sPhase = new Float32Array(STREAM)
    const sSpeed = new Float32Array(STREAM)
    const sRadius = new Float32Array(STREAM)
    const sTilt = new Float32Array(STREAM)
    const cAccent = new THREE.Color(ACCENT)
    const cCyan = new THREE.Color(CYAN)
    const cTeal = new THREE.Color(TEAL)
    const cWhite = new THREE.Color(0xffffff)
    for (let i = 0; i < STREAM; i++) {
      sPhase[i] = Math.random() * Math.PI * 2
      sSpeed[i] = 0.2 + Math.random() * 0.8
      const k = Math.random()
      if (k < 0.3) {
        sRadius[i] = 2.9 + (Math.random() - 0.5) * 0.06
        sTilt[i] = 0.4
      } else if (k < 0.55) {
        sRadius[i] = 3.3 + (Math.random() - 0.5) * 0.06
        sTilt[i] = -0.3
      } else if (k < 0.75) {
        sRadius[i] = 3.7 + (Math.random() - 0.5) * 0.06
        sTilt[i] = 0.2
      } else {
        sRadius[i] = 2.4 + Math.random() * 1.6
        sTilt[i] = (Math.random() - 0.5) * 1.5
      }
      const t = Math.random()
      const c = t < 0.45 ? cAccent : t < 0.75 ? cCyan : t < 0.9 ? cTeal : cWhite
      sCol[i * 3] = c.r
      sCol[i * 3 + 1] = c.g
      sCol[i * 3 + 2] = c.b
    }
    const streamGeo = new THREE.BufferGeometry()
    streamGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
    streamGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3))
    const streamMat = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const streamPoints = new THREE.Points(streamGeo, streamMat)
    root.add(streamPoints)

    const dustCount = 1200
    const dPos = new Float32Array(dustCount * 3)
    const dCol = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustCount; i++) {
      const r = 5 + Math.random() * 8
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      dPos[i * 3] = r * Math.sin(ph) * Math.cos(th)
      dPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.6
      dPos[i * 3 + 2] = r * Math.cos(ph) - 2
      const t = Math.random()
      const c = t < 0.7 ? cWhite : t < 0.9 ? cAccent : cCyan
      dCol[i * 3] = c.r
      dCol[i * 3 + 1] = c.g
      dCol[i * 3 + 2] = c.b
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3))
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3))
    const dustMat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.025,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
    })
    const dust = new THREE.Points(dustGeo, dustMat)
    scene.add(dust)

    type Shoot = {
      line: THREE.Line
      mat: THREE.LineBasicMaterial
      geo: THREE.BufferGeometry
      startTime: number
      active: boolean
      from: THREE.Vector3
      dir: THREE.Vector3
    }
    const stars: Shoot[] = []
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
      const mat = new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? ACCENT : CYAN,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      })
      const line = new THREE.Line(geo, mat)
      scene.add(line)
      stars.push({ line, mat, geo, startTime: -10 - i * 2, active: false, from: new THREE.Vector3(), dir: new THREE.Vector3() })
    }

    let targetRX = 0.2
    let targetRY = 0
    let scrollY = 0

    const onMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      targetRY = x * 0.8
      targetRX = 0.2 + y * 0.5
    }
    const onScroll = () => {
      scrollY = window.scrollY * 0.0015
    }
    const onResize = () => {
      const w = mount.clientWidth || 1
      const h = mount.clientHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }

    if (!reduceMotion) {
      window.addEventListener('mousemove', onMove)
      window.addEventListener('scroll', onScroll, { passive: true })
    }
    window.addEventListener('resize', onResize)

    const startMs = performance.now()
    let prevMs = startMs
    let raf = 0

    const tick = () => {
      const nowMs = performance.now()
      const dt = (nowMs - prevMs) / 1000
      const t = (nowMs - startMs) / 1000
      prevMs = nowMs
      const pos = streamGeo.attributes.position.array as Float32Array
      for (let i = 0; i < STREAM; i++) {
        sPhase[i] += dt * sSpeed[i] * 0.4
        const u = sPhase[i]
        const r = sRadius[i]
        const tilt = sTilt[i]
        const cosT = Math.cos(tilt)
        const sinT = Math.sin(tilt)
        const x = r * Math.cos(u)
        const z = r * Math.sin(u)
        pos[i * 3] = x
        pos[i * 3 + 1] = -z * sinT
        pos[i * 3 + 2] = z * cosT
      }
      streamGeo.attributes.position.needsUpdate = true

      satellites.forEach((s) => {
        s.phase += dt * s.speed
        const cosT = Math.cos(s.tilt)
        const sinT = Math.sin(s.tilt)
        const x = s.radius * Math.cos(s.phase)
        const z = s.radius * Math.sin(s.phase)
        s.mesh.position.set(x, -z * sinT, z * cosT)
      })

      stars.forEach((ss) => {
        const age = t - ss.startTime
        if (!ss.active && age > 4 + Math.random() * 6) {
          ss.active = true
          ss.startTime = t
          ss.from.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, -3 + Math.random() * 2)
          ss.dir.set(Math.random() * 4 + 2, (Math.random() - 0.5) * 2, Math.random() * 2)
        }
        if (ss.active) {
          const a = t - ss.startTime
          const life = 1.2
          if (a > life) {
            ss.active = false
            ss.mat.opacity = 0
          } else {
            const head = ss.from.clone().add(ss.dir.clone().multiplyScalar(a / life))
            const tail = ss.from.clone().add(ss.dir.clone().multiplyScalar(Math.max(0, a / life - 0.15)))
            const arr = ss.geo.attributes.position.array as Float32Array
            arr[0] = head.x
            arr[1] = head.y
            arr[2] = head.z
            arr[3] = tail.x
            arr[4] = tail.y
            arr[5] = tail.z
            ss.geo.attributes.position.needsUpdate = true
            ss.mat.opacity = 1 - a / life
          }
        }
      })

      root.rotation.x += (targetRX - root.rotation.x) * 0.04
      root.rotation.y += (targetRY - root.rotation.y) * 0.04
      globeGroup.rotation.y = t * 0.15
      orbitGroup.rotation.y = t * 0.08
      orbitGroup.rotation.x = Math.sin(t * 0.3) * 0.1

      camera.position.y = 0.4 - scrollY * 2
      camera.position.z = 8 + scrollY * 3

      core2Mat.opacity = 0.35 + Math.sin(t * 1.5) * 0.1
      coreMat.opacity = 0.06 + Math.sin(t * 0.8) * 0.03
      dust.rotation.y = t * 0.015

      renderer.render(scene, camera)
      if (!reduceMotion) {
        raf = requestAnimationFrame(tick)
      }
    }

    if (reduceMotion) {
      // single static frame
      renderer.render(scene, camera)
    } else {
      tick()
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
          obj.geometry?.dispose?.()
          const mat = obj.material as THREE.Material | THREE.Material[]
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose?.()
        }
      })
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="stream-v3-globe-canvas" aria-hidden="true" />
}
