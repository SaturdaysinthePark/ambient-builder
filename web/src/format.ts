export function ago(iso: string, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function duration(fromIso: string, toIso?: string, now = Date.now()) {
  const ms = (toIso ? new Date(toIso).getTime() : now) - new Date(fromIso).getTime()
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 1) return '<1 min'
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "subscription-tracker" → "Subscription tracker". Repo and folder keep the kebab-case name. */
export const displayName = (name: string) => {
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}
