import { useEffect, useRef, useState } from "react"
import { useStore } from "@/lib/store"

/**
 * A smooth two-part pointer (dot + trailing ring) that replaces the native
 * cursor when the "customCursor" setting is enabled. Disabled on touch devices.
 */
export function CustomCursor() {
  const enabled = useStore((s) => s.settings.customCursor)
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const [interactive, setInteractive] = useState(false)
  const [down, setDown] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled) return
    // skip on touch/coarse pointers
    if (window.matchMedia("(pointer: coarse)").matches) return

    document.body.classList.add("vy-custom-cursor")

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const ring = { x: target.x, y: target.y }
    let raf = 0

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX
      target.y = e.clientY
      setVisible(true)
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
      }
      const el = e.target as HTMLElement | null
      const hot = !!el?.closest('button, a, input, textarea, [role="button"], label, [data-cursor="interactive"]')
      setInteractive(hot)
    }
    const onDown = () => setDown(true)
    const onUp = () => setDown(false)
    const onLeave = () => setVisible(false)

    const tick = () => {
      ring.x += (target.x - ring.x) * 0.18
      ring.y += (target.y - ring.y) * 0.18
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mousedown", onDown)
    window.addEventListener("mouseup", onUp)
    document.addEventListener("mouseleave", onLeave)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("mouseup", onUp)
      document.removeEventListener("mouseleave", onLeave)
      document.body.classList.remove("vy-custom-cursor")
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div aria-hidden className="vy-cursor-layer" style={{ opacity: visible ? 1 : 0 }}>
      <div
        ref={ringRef}
        className="vy-cursor-ring"
        style={{
          width: interactive ? 46 : 30,
          height: interactive ? 46 : 30,
          borderColor: "var(--vy-accent)",
          transform: "translate3d(-100px,-100px,0)",
          scale: down ? "0.8" : "1",
          background: interactive ? "color-mix(in oklab, var(--vy-accent) 14%, transparent)" : "transparent",
        }}
      />
      <div
        ref={dotRef}
        className="vy-cursor-dot"
        style={{ background: "var(--vy-accent)", transform: "translate3d(-100px,-100px,0)", scale: down ? "1.6" : "1" }}
      />
    </div>
  )
}
