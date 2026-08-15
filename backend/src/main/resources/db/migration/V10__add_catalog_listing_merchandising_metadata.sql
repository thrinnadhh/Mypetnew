ALTER TABLE mypet.catalog_listing ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'other';
ALTER TABLE mypet.catalog_listing ADD COLUMN brand VARCHAR(100);
ALTER TABLE mypet.catalog_listing ADD COLUMN description VARCHAR(2000);
ALTER TABLE mypet.catalog_listing ADD COLUMN pet_type VARCHAR(40);
ALTER TABLE mypet.catalog_listing ADD COLUMN life_stage VARCHAR(40);
ALTER TABLE mypet.catalog_listing ADD COLUMN pack_label VARCHAR(80);
ALTER TABLE mypet.catalog_listing ADD COLUMN sku VARCHAR(80);

CREATE TABLE mypet.catalog_listing_image (
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    image_url VARCHAR(2048) NOT NULL,
    PRIMARY KEY (listing_id, position),
    CONSTRAINT uq_catalog_listing_image_url UNIQUE (listing_id, image_url),
    CHECK (position >= 0 AND position < 5)
);
