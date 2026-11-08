import { useEffect, useState } from 'react'
import {
  PRESET_PALETTES,
  loadSavedPalette,
  parseCoolorsUrl,
  saveAndApplyPalette,
  type ThemePalette,
} from '../../core/theme'

/**
 * Interactive Color Palette Switcher.
 *
 * Lets the user switch between curated warm coastal blue palettes or paste any
 * `https://coolors.co/palette/...` URL / tweak the 5 swatches live.
 */
export default function PaletteSwitcher() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<ThemePalette>(() => loadSavedPalette())
  const [coolorsInput, setCoolorsInput] = useState(
    active.coolorsUrl ?? 'https://coolors.co/palette/bee9e8-62b6cb-1b4965-cae9ff-5fa8d3',
  )
  const [customError, setCustomError] = useState<string | null>(null)

  useEffect(() => {
    const onThemeChange = (e: Event) => {
      const detail = (e as CustomEvent<ThemePalette>).detail
      if (detail) setActive(detail)
    }
    window.addEventListener('idc-theme-changed', onThemeChange)
    return () => window.removeEventListener('idc-theme-changed', onThemeChange)
  }, [])

  const selectPalette = (palette: ThemePalette) => {
    setActive(palette)
    if (palette.coolorsUrl) setCoolorsInput(palette.coolorsUrl)
    setCustomError(null)
    saveAndApplyPalette(palette)
  }

  const handleApplyCoolorsUrl = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseCoolorsUrl(coolorsInput)
    if (!parsed) {
      setCustomError('Paste a Coolors URL or 5 hex codes (e.g. bee9e8-62b6cb-1b4965-cae9ff-5fa8d3)')
      return
    }
    const customPalette: ThemePalette = {
      id: 'custom-coolors',
      name: 'Custom Coolors Palette',
      subtitle: parsed.join(' · '),
      colors: parsed,
      coolorsUrl: coolorsInput.trim(),
    }
    selectPalette(customPalette)
  }

  const handleColorInputChange = (index: number, newHex: string) => {
    const nextColors = [...active.colors] as [string, string, string, string, string]
    nextColors[index] = newHex.toUpperCase()
    const slug = nextColors.map((c) => c.replace('#', '').toLowerCase()).join('-')
    const customPalette: ThemePalette = {
      id: 'custom-coolors',
      name: 'Custom Palette',
      subtitle: nextColors.join(' · '),
      colors: nextColors,
      coolorsUrl: `https://coolors.co/palette/${slug}`,
    }
    selectPalette(customPalette)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Customize Color Palette"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-white/90 px-3 text-xs font-semibold text-foreground shadow-xs backdrop-blur-xs transition hover:border-primary/40 hover:bg-white"
      >
        <span className="flex items-center -space-x-1" aria-hidden="true">
          {active.colors.map((hex, idx) => (
            <span
              key={`${hex}-${idx}`}
              className="size-3.5 rounded-full border border-white shadow-2xs"
              style={{ backgroundColor: hex }}
            />
          ))}
        </span>
        <span className="hidden sm:inline">Palette</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Theme Palette Studio"
            className="
              absolute right-0 top-11 z-50 w-80 rounded-2xl border border-border
              bg-white p-4 shadow-xl sm:w-96
            "
          >
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-foreground">Warm Palette Studio</h3>
                <p className="text-[11px] text-muted-foreground">
                  Switch palettes or paste any Coolors URL live
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Close
              </button>
            </div>

            {/* Active 5 color pickers */}
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Active 5 Swatches (click to tweak)</span>
                <span className="font-mono text-[10px]">{active.name}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {active.colors.map((hex, idx) => (
                  <label
                    key={idx}
                    className="group flex cursor-pointer flex-col items-center rounded-xl border border-border p-1.5 transition hover:border-primary"
                  >
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => handleColorInputChange(idx, e.target.value)}
                      className="sr-only"
                    />
                    <span
                      className="h-7 w-full rounded-lg border border-black/5 shadow-inner"
                      style={{ backgroundColor: hex }}
                    />
                    <span className="mt-1 font-mono text-[10px] font-semibold text-foreground">
                      {hex}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Preset palettes */}
            <div className="mt-3.5 space-y-1.5">
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Presets
              </p>
              {PRESET_PALETTES.map((preset) => {
                const isSelected = active.id === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectPalette(preset)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                      isSelected
                        ? 'border-primary bg-secondary/45 shadow-2xs'
                        : 'border-border bg-white hover:bg-muted/60'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-foreground">{preset.name}</p>
                      <p className="line-clamp-1 text-[10px] text-muted-foreground">
                        {preset.subtitle}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pl-2">
                      {preset.colors.map((c, i) => (
                        <span
                          key={i}
                          className="size-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Paste Coolors URL */}
            <form onSubmit={handleApplyCoolorsUrl} className="mt-3.5 border-t border-border pt-3">
              <label className="block text-[11px] font-semibold text-foreground">
                Paste Coolors URL or 5 Hex Codes
              </label>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  type="text"
                  value={coolorsInput}
                  onChange={(e) => setCoolorsInput(e.target.value)}
                  placeholder="https://coolors.co/palette/bee9e8-62b6cb-..."
                  className="h-8 flex-1 rounded-lg border border-input bg-muted/40 px-2.5 font-mono text-[11px] text-foreground focus:border-primary focus:bg-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-95"
                >
                  Apply
                </button>
              </div>
              {customError && (
                <p className="mt-1 text-[11px] text-destructive">{customError}</p>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  )
}
