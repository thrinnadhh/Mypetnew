-- V31 — Supabase function search_path hardening and additive PostGIS foundation.
-- Existing latitude/longitude columns remain authoritative. Generated geography columns
-- are deterministic query projections and cannot diverge from their source coordinates.

ALTER FUNCTION mypet.reject_inventory_movement_mutation()
    SET search_path = pg_catalog;

ALTER FUNCTION mypet.initialize_inventory_balance_for_listing()
    SET search_path = pg_catalog;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- V15 intended dispatch coordinates to be either a complete valid pair or both NULL.
-- PostgreSQL CHECK constraints accept UNKNOWN, so the original expression allowed partial NULL pairs.
-- Live V30 certification found zero partial/invalid rows; tighten the same named invariant forward-only.
ALTER TABLE mypet.provider_outlet
    DROP CONSTRAINT chk_provider_dispatch_coordinates;

ALTER TABLE mypet.provider_outlet
    ADD CONSTRAINT chk_provider_dispatch_coordinates
    CHECK (
        (dispatch_latitude IS NULL AND dispatch_longitude IS NULL)
        OR (
            dispatch_latitude IS NOT NULL
            AND dispatch_longitude IS NOT NULL
            AND dispatch_latitude BETWEEN -90.0 AND 90.0
            AND dispatch_longitude BETWEEN -180.0 AND 180.0
        )
    ) NOT VALID;

ALTER TABLE mypet.provider_outlet
    VALIDATE CONSTRAINT chk_provider_dispatch_coordinates;

ALTER TABLE mypet.service_region
    ADD CONSTRAINT chk_service_region_center_coordinates
    CHECK (
        center_latitude BETWEEN -90.0 AND 90.0
        AND center_longitude BETWEEN -180.0 AND 180.0
    ) NOT VALID;

ALTER TABLE mypet.service_region
    VALIDATE CONSTRAINT chk_service_region_center_coordinates;

ALTER TABLE mypet.provider_outlet
    ADD COLUMN dispatch_geog extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
        CASE
            WHEN dispatch_latitude IS NULL OR dispatch_longitude IS NULL THEN NULL
            ELSE extensions.ST_SetSRID(
                extensions.ST_MakePoint(dispatch_longitude, dispatch_latitude),
                4326
            )::extensions.geography
        END
    ) STORED;

ALTER TABLE mypet.service_region
    ADD COLUMN center_geog extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
        extensions.ST_SetSRID(
            extensions.ST_MakePoint(
                center_longitude::double precision,
                center_latitude::double precision
            ),
            4326
        )::extensions.geography
    ) STORED;

CREATE INDEX idx_provider_outlet_dispatch_geog
    ON mypet.provider_outlet
    USING GIST (dispatch_geog)
    WHERE dispatch_geog IS NOT NULL;

CREATE INDEX idx_service_region_center_geog
    ON mypet.service_region
    USING GIST (center_geog);
