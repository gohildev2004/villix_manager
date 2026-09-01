export const activePayoutPeriod = {
  start: "2026-08-24",
  end: "2026-08-30",
  label: "Aug 24 – Aug 30",
  batchLabel: "VLX-2026-W35",
};

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type PayoutWeekday = typeof weekdays[number];

export function isPayoutWeekday(value: unknown): value is PayoutWeekday {
  return typeof value === "string" && weekdays.includes(value as PayoutWeekday);
}

export function scheduledPayoutDate(periodEnd: string, weekday: PayoutWeekday = "Monday") {
  const date = new Date(`${periodEnd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("The payout period end date is invalid.");
  const target = weekdays.indexOf(weekday);
  const daysAhead = ((target - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

export function displayPayoutDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
