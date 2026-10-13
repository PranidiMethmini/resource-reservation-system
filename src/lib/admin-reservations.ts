import { organizeReservations, reservationState, type Reservation, type ReservationFilter } from "@/lib/reservations";

export type AdminReservation = Reservation & { createdAt: string; user: { name: string; email: string } };
export type AdminSort = "upcoming" | "newest" | "oldest";
export function filterAdminReservations(records: AdminReservation[], filter: ReservationFilter, search: string, resourceId: string, sort: AdminSort, now: number): AdminReservation[] {
  const allowed = new Set(organizeReservations(records, filter, "", now).map((item) => item.id));
  const query = search.trim().toLowerCase();
  const filtered = records.filter((item) => allowed.has(item.id) && (!resourceId || item.resourceId === resourceId) && (!query || [item.resource.name, item.user.name, item.user.email].some((value) => value.toLowerCase().includes(query))));
  const priority = { Upcoming: 0, Ongoing: 1, Completed: 2, Cancelled: 3 };
  return filtered.sort((a, b) => {
    if (sort === "upcoming") {
      const group = priority[reservationState(a, now)] - priority[reservationState(b, now)];
      if (group) return group;
      if (reservationState(a, now) === "Upcoming") return new Date(a.startTime).getTime() - new Date(b.startTime).getTime() || a.id.localeCompare(b.id, "en");
    }
    const difference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return (sort === "oldest" ? difference : -difference) || a.id.localeCompare(b.id, "en");
  });
}
