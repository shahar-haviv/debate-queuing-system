import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

export default function QrModal({ candidate, onClose }) {
  const canvasRef = useRef(null)
  const copyTimerRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!candidate) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [candidate, onClose])

  // Never leave a timer running past unmount.
  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  useEffect(() => {
    clearTimeout(copyTimerRef.current)
    setCopied(false)
  }, [candidate])

  if (!candidate) return null

  const url = `${window.location.origin}/candidate/${candidate.id}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const download = () => {
    const canvas = canvasRef.current?.querySelector('canvas')
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `qr-${candidate.name.replace(/\s+/g, '-') || candidate.id}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-xl">
        <h2 className="text-lg font-bold tracking-tight text-foreground">{candidate.name}</h2>
        {candidate.serial_number && (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Serial #{candidate.serial_number}
          </p>
        )}

        <div ref={canvasRef} className="mx-auto mt-5 inline-flex rounded-lg border border-border bg-card p-4">
          <QRCodeCanvas value={url} size={224} level="M" marginSize={1} />
        </div>

        <p className="mt-4 text-xs text-muted-foreground">Scan to open this candidate&apos;s live status page.</p>
        <p className="mt-2 break-all rounded-md bg-muted px-3 py-2 font-mono text-[10px] text-muted-foreground">
          {url}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
          >
            Download
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  )
}
