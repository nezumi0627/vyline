/**
 * NezuCursor — Vyline 専用カスタムポインター
 * settings.customCursor が ON のときネイティブカーソルを隠し、ドット＋リングを描画。
 */

import { useEffect, useRef, useState } from "react"
import { useStore } from "@/lib/store"

export function NezuCursor() {
  const enabled = useStore((s) => s.settings.customCursor)
  const accent = useStore((s) => s.theme.accent)
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const [interactive, setInteractive] = useState(false)
  const [down, setDown] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled) {
      document.documentElement.classList.remove("nezu-cursor-on")
      document.body.classList.remove("vy-custom-cursor", "nezu-cursor-on")
      return
    }
    if (window.matchMedia("(pointer: coarse)").matches) return

    document.documentElement.classList.add("nezu-cursor-on")
    document.body.classList.add("vy-custom-cursor", "nezu-cursor-on")

    const target = { x: -100, y: -100 }
    const ring = { x: -100, y: -100 }
    let raf = 0

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX
      target.y = e.clientY
      setVisible(true)
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`
      }
      const el = e.target as HTMLElement | null
      const hot = !!el?.closest(
        'button, a, input, textarea, select, [role="button"], label, summary, [data-cursor="interactive"]',
      )
      setInteractive(hot)
    }
    const onDown = () => setDown(true)
    const onUp = () => setDown(false)
    const onLeave = () => setVisible(false)
    const onEnter = () => setVisible(true)

    const tick = () => {
      ring.x += (target.x - ring.x) * 0.22
      ring.y += (target.y - ring.y) * 0.22
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0) translate(-50%, -50%)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("mousedown", onDown)
    window.addEventListener("mouseup", onUp)
    document.addEventListener("mouseleave", onLeave)
    document.addEventListener("mouseenter", onEnter)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("mouseup", onUp)
      document.removeEventListener("mouseleave", onLeave)
      document.removeEventListener("mouseenter", onEnter)
      document.documentElement.classList.remove("nezu-cursor-on")
      document.body.classList.remove("vy-custom-cursor", "nezu-cursor-on")
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      aria-hidden
      className="nezu-cursor-layer"
      style={{ opacity: visible ? 1 : 0, pointerEvents: "none" }}
    >
      <div
        ref={ringRef}
        className="nezu-cursor-ring"
        style={{
          width: interactive ? 44 : 28,
          height: interactive ? 44 : 28,
          borderColor: accent,
          background: interactive
            ? `color-mix(in oklab, ${accent} 16%, transparent)`
            : "transparent",
          transform: "translate3d(-100px,-100px,0) translate(-50%,-50%)",
          scale: down ? "0.82" : "1",
        }}
      />
      <div
        ref={dotRef}
        className="nezu-cursor-dot"
        style={{
          background: accent,
          transform: "translate3d(-100px,-100px,0) translate(-50%,-50%)",
          scale: down ? "1.55" : "1",
        }}
      />
    </div>
  )
}

/** @deprecated use NezuCursor */
export const CustomCursor = NezuCursor
