export const bookingTimeZone = "Asia/Colombo";

export function colomboDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: bookingTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Modern Sri Lanka time is UTC+05:30, without daylight-saving transitions.
// Explicit offsets prevent the browser's timezone from changing the booking.
export function parseBookingTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const result = new Date(`${date}T${time}:00+05:30`);
  if (Number.isNaN(result.getTime()) || colomboDate(result) !== date) return null;
  return result;
}

export function validateBooking(date: string, startTime: string, endTime: string, now = new Date()):
  { ok: true; start: Date; end: Date; durationMinutes: number } | { ok: false; field: "date" | "startTime" | "endTime"; message: string } {
  if (!date) return { ok: false, field: "date", message: "Choose a reservation date." };
  if (!startTime) return { ok: false, field: "startTime", message: "Choose a start time." };
  if (!endTime) return { ok: false, field: "endTime", message: "Choose an end time." };
  const start = parseBookingTime(date, startTime);
  const end = parseBookingTime(date, endTime);
  if (!start || !end) return { ok: false, field: "date", message: "Choose a valid date and time." };
  if (end <= start) return { ok: false, field: "endTime", message: "End time must be after start time on the same date." };
  if (start <= now) return { ok: false, field: "startTime", message: "Choose a future start time in Sri Lanka time." };
  return { ok: true, start, end, durationMinutes: (end.getTime() - start.getTime()) / 60000 };
}

export function formatBookingDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: bookingTimeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
}
export function formatBookingTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: bookingTimeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} hr` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" ");
}
