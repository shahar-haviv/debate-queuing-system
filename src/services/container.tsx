/**
 * The composition root.
 *
 * `ServicesProvider` supplies the `DatabaseService` the whole tree uses. With no
 * provider, `useServices()` builds the Supabase adapter lazily, which keeps the
 * app's entry point small and lets tests wrap only the part they care about:
 *
 *   <ServicesProvider service={fakeDatabase}>...</ServicesProvider>
 *
 * That is the swap point the DIP requirement asks for - Firebase or a local
 * mock only needs to implement `DatabaseService`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { DatabaseService } from './database'
import { createSupabaseDatabase } from './supabaseDatabase'
import { getSupabaseClient } from './supabase'

const ServicesContext = createContext<DatabaseService | null>(null)

let fallback: DatabaseService | null = null

/** The lazily-built production container. */
export function getServices(): DatabaseService {
  if (!fallback) fallback = createSupabaseDatabase(() => getSupabaseClient())
  return fallback
}

/** Test seam: forget the lazily-built container. */
export function resetServices(): void {
  fallback = null
}

export function ServicesProvider({
  service,
  children,
}: {
  service?: DatabaseService
  children: ReactNode
}) {
  const value = useMemo(() => service ?? getServices(), [service])
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

/** The injected database. Never a raw Supabase client. */
export function useServices(): DatabaseService {
  return useContext(ServicesContext) ?? getServices()
}
