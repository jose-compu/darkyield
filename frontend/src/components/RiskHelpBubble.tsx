import {
  useState,
  useRef,
  useEffect,
  useId,
  useLayoutEffect,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

const RISK_HELP_COPY =
  'Headline score = min(100, max(per-position scores) + concentration + correlation). Each position score starts from the DefiLlama pool heuristic (0–100) and adds +10 per triggered risk rule (+10 more if the measured value exceeds twice the threshold). Open the Risk tab for a full numerical table per pool and every trigger row.'

const LEAVE_DELAY_MS = 200

type RiskHelpBubbleProps = {
  children?: ReactNode
}

/**
 * Hover the label and/or the ? icon to read the panel; click ? to pin it open (click outside or Escape to dismiss).
 */
export function RiskHelpBubble({ children }: RiskHelpBubbleProps) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)
  const tooltipId = useId()
  const show = hovered || pinned
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null)

  const clearHideTimer = () => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const scheduleHideHover = () => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      if (!pinnedRef.current) setHovered(false)
      hideTimerRef.current = null
    }, LEAVE_DELAY_MS)
  }

  const onPointerEnter = () => {
    clearHideTimer()
    setHovered(true)
  }

  const onPointerLeave = () => {
    scheduleHideHover()
  }

  const updateTipPosition = () => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTipPos({
      top: r.bottom + 8,
      left: r.left + r.width / 2,
    })
  }

  useLayoutEffect(() => {
    if (!show) {
      setTipPos(null)
      return
    }
    updateTipPosition()
    window.addEventListener('scroll', updateTipPosition, true)
    window.addEventListener('resize', updateTipPosition)
    return () => {
      window.removeEventListener('scroll', updateTipPosition, true)
      window.removeEventListener('resize', updateTipPosition)
    }
  }, [show])

  useEffect(() => {
    return () => clearHideTimer()
  }, [])

  useEffect(() => {
    if (!pinned) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || tooltipRef.current?.contains(t)) return
      setPinned(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center gap-1"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      {children}
      <button
        type="button"
        className="inline-flex shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-0.5 text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        aria-label="Explain structural risk"
        aria-expanded={show}
        aria-describedby={show ? tooltipId : undefined}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {show &&
        tipPos &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{
              position: 'fixed',
              top: tipPos.top,
              left: tipPos.left,
              transform: 'translateX(-50%)',
              zIndex: 9999,
              width: 'min(20rem, calc(100vw - 2rem))',
            }}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-[var(--color-text)] shadow-lg sm:text-xs"
            onMouseEnter={onPointerEnter}
            onMouseLeave={onPointerLeave}
          >
            {RISK_HELP_COPY}
          </div>,
          document.body
        )}
    </span>
  )
}
