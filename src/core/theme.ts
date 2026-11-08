/**
 * Swappable Warm Coastal Color Palette System.
 *
 * Default palette requested by user:
 * https://coolors.co/palette/bee9e8-62b6cb-1b4965-cae9ff-5fa8d3
 *   • #BEE9E8 — Seafoam Mint
 *   • #62B6CB — Coastal Teal
 *   • #1B4965 — Deep Harbor Navy
 *   • #CAE9FF — Soft Sky Blue
 *   • #5FA8D3 — Cerulean Blue
 *
 * Updates CSS custom properties on `:root` at runtime and persists the
 * active selection in `localStorage` so the user can switch or paste any
 * Coolors URL live from the UI.
 */

export interface ThemePalette {
  id: string
  name: string
  subtitle: string
  /** 5 hex colors (with leading `#`) */
  colors: [string, string, string, string, string]
  coolorsUrl?: string
}

const STORAGE_KEY = 'idc_debate_theme_palette_v1'

export const PRESET_PALETTES: ThemePalette[] = [
  {
    id: 'coastal-breeze',
    name: 'Coastal Breeze',
    subtitle: 'Seafoam, Soft Sky & Deep Harbor (#BEE9E8 · #62B6CB · #1B4965 · #CAE9FF · #5FA8D3)',
    colors: ['#BEE9E8', '#62B6CB', '#1B4965', '#CAE9FF', '#5FA8D3'],
    coolorsUrl: 'https://coolors.co/palette/bee9e8-62b6cb-1b4965-cae9ff-5fa8d3',
  },
  {
    id: 'warm-harbor',
    name: 'Warm Harbor Sand',
    subtitle: 'Sunlit Linen, Coastal Teal & Deep Harbor',
    colors: ['#F4E8C1', '#62B6CB', '#1B4965', '#CAE9FF', '#5FA8D3'],
    coolorsUrl: 'https://coolors.co/palette/f4e8c1-62b6cb-1b4965-cae9ff-5fa8d3',
  },
  {
    id: 'aegean-morning',
    name: 'Aegean Morning',
    subtitle: 'Soft Sea Glass, Cerulean & Maritime Navy',
    colors: ['#D8F3DC', '#457B9D', '#1D3557', '#E0FBFC', '#62B6CB'],
    coolorsUrl: 'https://coolors.co/palette/d8f3dc-457b9d-1d3557-e0fbfc-62b6cb',
  },
  {
    id: 'sunset-cove',
    name: 'Sunset Cove',
    subtitle: 'Warm Sand, Sage Mist & Twilight Slate',
    colors: ['#F2CC8F', '#81B29A', '#2B3A55', '#F4F1DE', '#5FA8D3'],
    coolorsUrl: 'https://coolors.co/palette/f2cc8f-81b29a-2b3a55-f4f1de-5fa8d3',
  },
]

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim()
  const num = parseInt(clean, 16)
  if (Number.isNaN(num) || clean.length !== 6) {
    return { r: 27, g: 73, b: 101 }
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function mixHex(hexA: string, hexB: string, weightA: number): string {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  const w = Math.max(0, Math.min(1, weightA))
  const r = Math.round(a.r * w + b.r * (1 - w))
  const g = Math.round(a.g * w + b.g * (1 - w))
  const bl = Math.round(a.b * w + b.b * (1 - w))
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Parses a Coolors URL (e.g. `https://coolors.co/palette/bee9e8-62b6cb-1b4965-cae9ff-5fa8d3`)
 * or any string containing 5 six-digit hex values into a normalized 5-color tuple.
 */
export function parseCoolorsUrl(
  input: string,
): [string, string, string, string, string] | null {
  if (!input) return null
  const matches = input.match(/[0-9a-fA-F]{6}/g)
  if (!matches || matches.length < 5) return null
  const top5 = matches.slice(0, 5).map((h) => `#${h.toUpperCase()}`) as [
    string,
    string,
    string,
    string,
    string,
  ]
  return top5
}

/**
 * Applies a 5-color ThemePalette to `:root` CSS variables so Tailwind utility
 * classes (`bg-primary`, `bg-palette-mint`, `bg-palette-sky`, etc.) update
 * immediately across the entire app.
 */
export function applyThemePalette(palette: ThemePalette): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const [c1, c2, c3, c4, c5] = palette.colors

  // Sort copy by luminance so even custom Coolors URLs always get a dark primary
  // and light sky/mint surfaces while preserving the 5 palette slots.
  const sortedByLum = [...palette.colors].sort(
    (a, b) => relativeLuminance(a) - relativeLuminance(b),
  )
  const darkest = relativeLuminance(c3) < 0.38 ? c3 : sortedByLum[0]
  const lightest = relativeLuminance(c4) > 0.72 ? c4 : sortedByLum[sortedByLum.length - 1]
  const secondLightest =
    relativeLuminance(c1) > 0.68 ? c1 : sortedByLum[sortedByLum.length - 2]

  root.style.setProperty('--palette-1', c1)
  root.style.setProperty('--palette-2', c2)
  root.style.setProperty('--palette-3', darkest)
  root.style.setProperty('--palette-4', lightest)
  root.style.setProperty('--palette-5', c5)

  const pageBg = mixHex(lightest, '#FFFFFF', 0.22)
  const mutedBg = mixHex(lightest, '#FFFFFF', 0.48)
  const borderCol = mixHex(c5, '#FFFFFF', 0.34)
  const inputCol = mixHex(c5, '#FFFFFF', 0.44)
  const fgCol = mixHex(darkest, '#0A1926', 0.75)
  const mutedFg = mixHex(darkest, '#6488A0', 0.55)

  root.style.setProperty('--theme-background', pageBg)
  root.style.setProperty('--theme-foreground', fgCol)
  root.style.setProperty('--theme-card', '#FFFFFF')
  root.style.setProperty('--theme-card-foreground', fgCol)
  root.style.setProperty('--theme-muted', mutedBg)
  root.style.setProperty('--theme-muted-foreground', mutedFg)
  root.style.setProperty('--theme-primary', darkest)
  root.style.setProperty('--theme-primary-foreground', '#FFFFFF')
  root.style.setProperty('--theme-secondary', lightest)
  root.style.setProperty('--theme-secondary-foreground', darkest)
  root.style.setProperty('--theme-accent', secondLightest)
  root.style.setProperty('--theme-accent-foreground', fgCol)
  root.style.setProperty('--theme-border', borderCol)
  root.style.setProperty('--theme-input', inputCol)
  root.style.setProperty('--theme-ring', c5)
  root.style.setProperty('--theme-status-debate', c5)
  root.style.setProperty('--theme-status-initial', c2)
}

export function loadSavedPalette(): ThemePalette {
  if (typeof window === 'undefined') return PRESET_PALETTES[0]
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return PRESET_PALETTES[0]
    const parsed = JSON.parse(raw) as ThemePalette
    if (parsed && Array.isArray(parsed.colors) && parsed.colors.length === 5) {
      return parsed
    }
  } catch {
    // ignore storage errors
  }
  return PRESET_PALETTES[0]
}

export function saveAndApplyPalette(palette: ThemePalette): void {
  applyThemePalette(palette)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(palette))
      window.dispatchEvent(new CustomEvent('idc-theme-changed', { detail: palette }))
    } catch {
      // ignore storage errors
    }
  }
}

export function initTheme(): void {
  const palette = loadSavedPalette()
  applyThemePalette(palette)
}
