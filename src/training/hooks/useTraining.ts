import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  computeAllMemberStats,
  computeChairJuniorMatrix,
} from '../domain/pairingEngine'
import {
  subscribeTrainingStore,
  trainingService,
  type TrainingStoreData,
} from '../services/trainingStorage'

export function useTraining() {
  const [store, setStore] = useState<TrainingStoreData>(() => trainingService.getStore())

  const refresh = useCallback(() => {
    setStore(trainingService.getStore())
  }, [])

  useEffect(() => {
    return subscribeTrainingStore(() => {
      setStore(trainingService.getStore())
    })
  }, [])

  const memberById = useMemo(
    () => new Map(store.members.map((m) => [m.id, m])),
    [store.members],
  )

  const activeMember = useMemo(
    () =>
      memberById.get(store.activePersonaId) ??
      store.members.find((m) => m.email === 'idc.debate@gmail.com') ??
      store.members[0],
    [memberById, store.activePersonaId, store.members],
  )

  const memberStats = useMemo(
    () => computeAllMemberStats(store.members, store.results),
    [store.members, store.results],
  )

  const chairJuniorMatrix = useMemo(
    () => computeChairJuniorMatrix(store.members, store.results),
    [store.members, store.results],
  )

  const isManagerOrAdmin =
    activeMember?.permissions === 'Admin' || activeMember?.permissions === 'Manager'

  return {
    store,
    members: store.members,
    sessions: store.sessions,
    registrations: store.registrations,
    results: store.results,
    motions: store.motions,
    announcements: store.announcements,
    memberById,
    activeMember,
    isManagerOrAdmin,
    memberStats,
    chairJuniorMatrix,
    refresh,
    actions: trainingService,
  }
}
