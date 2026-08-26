ALTER TABLE mypet.catalog_media
    ADD COLUMN actor_id UUID REFERENCES mypet.identity_account(id);

-- V27 is already historical. NOT VALID preserves any pre-existing V27 rows while
-- enforcing these invariants for every new/updated row written after this migration.
ALTER TABLE mypet.catalog_media
    ADD CONSTRAINT ck_catalog_media_actor_required
        CHECK (actor_id IS NOT NULL) NOT VALID,
    ADD CONSTRAINT ck_catalog_media_canonical_object_key
        CHECK (
            object_key = 'catalog/' || organization_id::text || '/' || outlet_id::text || '/' || listing_id::text || '/' || id::text
        ) NOT VALID,
    ADD CONSTRAINT ck_catalog_media_managed_public_url
        CHECK (
            public_url ~ '^https://'
            AND RIGHT(public_url, LENGTH(object_key)) = object_key
        ) NOT VALID;

CREATE INDEX idx_catalog_media_actor
    ON mypet.catalog_media (actor_id, outlet_id, listing_id);
