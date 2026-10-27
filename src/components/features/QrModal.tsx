import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import type { Candidate } from '../../core/types'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

type QrCandidate = Pick<Candidate, 'id' | 'name'> & { serial_number?: string | null }

export interface QrModalProps {
  candidate: QrCandidate | null
  onClose: () => void
}

export default function QrModal({ candidate, onClose }: QrModalProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copied, setCopied] = useState(false)

  // Never leave a timer running past unmount.
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    setCopied(false)
  }, [candidate])

  if (!candidate) return null

  const url = `${window.location.origin}/candidate/${candidate.id}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
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
    <Modal open title={candidate.name} onClose={onClose} width="sm">
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
        <Button onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
        <Button variant="primary" onClick={download}>
          Download
        </Button>
      </div>
      <Button variant="ghost" fullWidth className="mt-3" onClick={onClose}>
        Close
      </Button>
    </Modal>
  )
}
