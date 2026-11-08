import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BP_POSITIONS, memberDisplayName } from '../domain/pairingEngine'
import { useTraining } from '../hooks/useTraining'

function formatTimer(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function TrainingProjection() {
  const { sessions, memberById } = useTraining()
  const [searchParams] = useSearchParams()
  const requestedId = searchParams.get('session')

  const session =
    sessions.find((s) => s.id === requestedId) ??
    sessions.find((s) => s.status === 'Check-In' || s.status === 'Draw Published') ??
    sessions[0]

  const [timerMode, setTimerMode] = useState<'prep' | 'speech'>('prep')
  const [secondsLeft, setSecondsLeft] = useState(15 * 60)
  const [running, setRunning] = useState(false)
  const [showMotion, setShowMotion] = useState(true)

  useEffect(() => {
    if (!running) return undefined
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(id)
  }, [running])

  const switchTimer = (mode: 'prep' | 'speech') => {
    setRunning(false)
    setTimerMode(mode)
    setSecondsLeft(mode === 'prep' ? 15 * 60 : 7 * 60 + 15)
  }

  // In a 7:15 speech (435s), POIs are allowed between 1:00 (375s left) and 6:00 (75s left).
  const speechElapsed = 7 * 60 + 15 - secondsLeft
  const poiOpen = timerMode === 'speech' && speechElapsed >= 60 && speechElapsed <= 360

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-8 text-white">
        <p className="text-lg">No training session found.</p>
        <Link to="/training" className="mt-4 rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
          Back to Training Hub
        </Link>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-4">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="rounded bg-blue-500/20 px-2.5 py-0.5 text-xs font-bold text-blue-300">
                IDC DEBATE • PROJECTOR MODE
              </span>
              <span className="text-xs text-slate-400">
                {session.date} • {session.time}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{session.title}</h1>
          </div>

          {/* Built-in Prep & Speech Timer */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/90 px-4 py-2.5">
            <div className="flex rounded-lg bg-slate-900 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => switchTimer('prep')}
                className={`rounded-md px-2.5 py-1 transition ${
                  timerMode === 'prep' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                15:00 Prep
              </button>
              <button
                type="button"
                onClick={() => switchTimer('speech')}
                className={`rounded-md px-2.5 py-1 transition ${
                  timerMode === 'speech' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                07:15 Speech
              </button>
            </div>

            <div className="flex items-center gap-2 px-2">
              <span
                dir="ltr"
                className={`font-mono text-3xl font-extrabold tabular-nums ${
                  secondsLeft <= 60 ? 'text-rose-400' : 'text-white'
                }`}
              >
                {formatTimer(secondsLeft)}
              </span>
              {timerMode === 'speech' && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    poiOpen
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {poiOpen ? 'POIs OPEN (1:00–6:00)' : 'PROTECTED TIME'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRunning((prev) => !prev)}
                className="rounded-md bg-white px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-slate-200"
              >
                {running ? 'Pause' : 'Start'}
              </button>
              <button
                type="button"
                onClick={() => switchTimer(timerMode)}
                className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Reset
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowMotion((prev) => !prev)}
              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              {showMotion ? 'Hide Motion' : 'Show Motion'}
            </button>

            <Link
              to="/training"
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              ← Exit Projector
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 p-6">
        {/* Motion & Info Slide Banner */}
        {showMotion && (session.motion || session.info_slide) && (
          <section className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-slate-900 to-slate-900/60 p-6 shadow-xl">
            {session.info_slide && (
              <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  שקופית מידע (Info Slide)
                </p>
                <p className="mt-1.5 text-base leading-relaxed text-slate-200">{session.info_slide}</p>
              </div>
            )}
            <p className="text-xs font-bold uppercase tracking-wider text-blue-400">מושן האימון (Motion)</p>
            <h2 className="mt-1.5 text-2xl font-extrabold leading-snug text-white md:text-3xl">
              {session.motion || 'טרם הוגדר מושן לאימון זה'}
            </h2>
          </section>
        )}

        {/* Rooms Grid */}
        {session.draw.rooms.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center">
            <p className="text-lg font-semibold text-slate-300">
              טרם פורסמה הגרלת חדרים לאימון זה.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              היכנסו ללשונית Smart BP Room Draw ולחצו על Auto-Fill Rooms.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {session.draw.rooms.map((room) => (
              <div
                key={room.id}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-extrabold text-white">חדר: {room.room_name}</span>
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                      {room.language === 'English' ? 'English Room' : 'חדר עברית'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-lg bg-amber-500/20 px-3 py-1 font-bold text-amber-300">
                      Chair:{' '}
                      {room.Chair.map((id) => memberDisplayName(memberById.get(id))).join(', ') || 'TBD'}
                    </span>
                    {room.Panel.length > 0 && (
                      <span className="rounded-lg bg-purple-500/20 px-3 py-1 font-semibold text-purple-300">
                        Panel: {room.Panel.map((id) => memberDisplayName(memberById.get(id))).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 p-5">
                  {BP_POSITIONS.map((pos) => {
                    const isGov = pos.includes('Government')
                    return (
                      <div
                        key={pos}
                        className={`rounded-xl border p-4 ${
                          isGov
                            ? 'border-blue-500/30 bg-blue-950/20'
                            : 'border-emerald-500/30 bg-emerald-950/20'
                        }`}
                      >
                        <p
                          dir="ltr"
                          className={`text-xs font-bold uppercase tracking-wider ${
                            isGov ? 'text-blue-400' : 'text-emerald-400'
                          }`}
                        >
                          {pos}
                        </p>
                        <ul className="mt-2.5 space-y-1.5">
                          {room[pos].length === 0 ? (
                            <li className="text-sm text-slate-500">—</li>
                          ) : (
                            room[pos].map((memberId) => {
                              const m = memberById.get(memberId)
                              return (
                                <li
                                  key={memberId}
                                  className="flex items-center justify-between rounded-lg bg-slate-950/70 px-3 py-2 text-base font-bold text-white"
                                >
                                  <span>{memberDisplayName(m)}</span>
                                  {m && (
                                    <span className="text-xs font-medium text-slate-400">
                                      {m.rank}
                                    </span>
                                  )}
                                </li>
                              )
                            })
                          )}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
