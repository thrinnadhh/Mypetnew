CREATE TABLE mypet.customer_favourite_listing (
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, listing_id)
);

CREATE INDEX idx_customer_favourite_listing_customer_created
    ON mypet.customer_favourite_listing(customer_id, created_at DESC, listing_id DESC);
