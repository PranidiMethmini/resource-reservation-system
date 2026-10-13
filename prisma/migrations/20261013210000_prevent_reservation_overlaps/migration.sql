-- Booking timestamps are TIMESTAMP(3) WITHOUT TIME ZONE, so use tsrange.
-- Apply only after approval and a fresh check of existing confirmed overlaps.
-- PostgreSQL validates existing rows when adding the constraint; conflicts
-- abort this transaction without deleting or changing any reservation data.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "public"."Reservation"
ADD CONSTRAINT "Reservation_confirmed_no_overlap"
EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("startTime", "endTime", '[)') WITH &&
)
WHERE ("status" = 'CONFIRMED');

COMMIT;
