export type Reservation = {
  id: string;
  resourceId: string;
  startTime: string;
  endTime: string;
  status: "CONFIRMED" | "CANCELLED";
  resource: { name: string; type: string; location: string };
};
export type ReservationFilter = "all" | "upcoming" | "past" | "cancelled";
export type ReservationState = "Upcoming" | "Ongoing" | "Completed" | "Cancelled";

export function reservationState(reservation: Reservation, now: number): ReservationState {
  if (reservation.status === "CANCELLED") return "Cancelled";
  if (new Date(reservation.endTime).getTime() <= now) return "Completed";
  if (new Date(reservation.startTime).getTime() <= now) return "Ongoing";
  return "Upcoming";
}
export function canCancelReservation(reservation: Reservation, now: number): boolean {
  return reservation.status === "CONFIRMED" && new Date(reservation.startTime).getTime() > now;
}

export function organizeReservations(reservations: Reservation[], filter: ReservationFilter, search: string, now: number): Reservation[] {
  const query = search.trim().toLowerCase();
  const filtered = reservations.filter((reservation) => {
    const state = reservationState(reservation, now);
    const matchesFilter = filter === "all" || (filter === "upcoming" && state === "Upcoming") || (filter === "past" && state === "Completed") || (filter === "cancelled" && state === "Cancelled");
    return matchesFilter && (!query || [reservation.resource.name, reservation.resource.location].some((value) => value.toLowerCase().includes(query)));
  });
  const priority = { Ongoing: 0, Upcoming: 1, Completed: 2, Cancelled: 3 };
  return filtered.sort((a, b) => {
    const aState = reservationState(a, now);
    const bState = reservationState(b, now);
    const group = priority[aState] - priority[bState];
    if (group) return group;
    const difference = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    return (aState === "Completed" || aState === "Cancelled" ? -difference : difference) || a.id.localeCompare(b.id, "en");
  });
}
