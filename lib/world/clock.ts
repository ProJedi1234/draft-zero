import { MINUTES_PER_DAY } from "@/lib/services/world.schema"

export function worldDay(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_DAY) + 1
}

export function worldClockLabel(minutes: number): string {
  const bucket = ["night", "morning", "afternoon", "evening"][
    Math.floor((minutes % MINUTES_PER_DAY) / 360)
  ]
  return `Day ${worldDay(minutes)} · ${bucket}`
}

export function clockTime(minutes: number): string {
  return (
    `${Math.floor((minutes % MINUTES_PER_DAY) / 60)}`.padStart(2, "0") +
    ":" +
    `${minutes % 60}`.padStart(2, "0")
  )
}

export function absoluteMinutes(day: number, time: string): number | null {
  if (
    !Number.isSafeInteger(day) ||
    day < 1 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return null
  const [hours, minutes] = time.split(":").map(Number)
  const absolute = (day - 1) * MINUTES_PER_DAY + hours * 60 + minutes
  return Number.isSafeInteger(absolute) ? absolute : null
}
