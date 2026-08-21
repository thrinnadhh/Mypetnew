-- P3 staging fixtures: public catalog and canonical M3 inventory. Run after 01.
-- Existing stock is never reset. A newly seeded listing receives one deterministic system opening
-- movement, and the balance projection is updated in the same PostgreSQL transaction.
BEGIN;

INSERT INTO mypet.catalog_listing(id,organization_id,outlet_id,barcode_type,normalized_barcode,name,listing_kind,commerce_mode,mrp_paise,selling_price_paise,category,brand,description,pet_type,life_stage,pack_label,sku,active) VALUES
(md5('mypet:p3:listing:dog-food')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,'INTERNAL','P3-DOG-FOOD-2KG','Staging Adult Dog Food 2 kg','PRODUCT','COMMERCE',99900,89900,'dog-food','MyPet Test','Persistent staging product fixture.','DOG','ADULT','2 kg','P3-DOG-FOOD-2KG',true),
(md5('mypet:p3:listing:dog-treats')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,'INTERNAL','P3-DOG-TREATS-200G','Staging Dog Training Treats 200 g','PRODUCT','COMMERCE',29900,24900,'treats','MyPet Test','Persistent staging cart fixture.','DOG','ALL','200 g','P3-DOG-TREATS-200G',true),
(md5('mypet:p3:listing:cat-litter')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,'INTERNAL','P3-CAT-LITTER-5KG','Staging Cat Litter 5 kg','PRODUCT','COMMERCE',59900,49900,'cat-litter','MyPet Test','Persistent staging cat-product fixture.','CAT','ALL','5 kg','P3-CAT-LITTER-5KG',true),
(md5('mypet:p3:listing:puppy-shampoo')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,'INTERNAL','P3-PUPPY-SHAMPOO','Staging Puppy Shampoo 200 ml','PRODUCT','COMMERCE',39900,34900,'grooming-supplies','MyPet Test','Persistent staging product-detail fixture.','DOG','PUPPY','200 ml','P3-PUPPY-SHAMPOO',true),
(md5('mypet:p3:listing:medicine')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,'INTERNAL','P3-MEDICINE-VIEW','Staging Medicine Catalogue Item','MEDICINE','VIEW_ONLY',45000,45000,'medicine','MyPet Test','View-only medicine fixture.','DOG','ALL','1 pack','P3-MEDICINE-VIEW',true)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,listing_kind=excluded.listing_kind,commerce_mode=excluded.commerce_mode,mrp_paise=excluded.mrp_paise,selling_price_paise=excluded.selling_price_paise,category=excluded.category,brand=excluded.brand,description=excluded.description,pet_type=excluded.pet_type,life_stage=excluded.life_stage,pack_label=excluded.pack_label,sku=excluded.sku,active=true,updated_at=now();

INSERT INTO mypet.inventory_balance(listing_id,organization_id,outlet_id,on_hand,reserved,version) VALUES
(md5('mypet:p3:listing:dog-food')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,0,0,0),
(md5('mypet:p3:listing:dog-treats')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,0,0,0),
(md5('mypet:p3:listing:cat-litter')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,0,0,0),
(md5('mypet:p3:listing:puppy-shampoo')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,0,0,0),
(md5('mypet:p3:listing:medicine')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,0,0,0)
ON CONFLICT(listing_id) DO NOTHING;

WITH targets(listing_id,target_on_hand) AS (VALUES
    (md5('mypet:p3:listing:dog-food')::uuid,30),
    (md5('mypet:p3:listing:dog-treats')::uuid,50),
    (md5('mypet:p3:listing:cat-litter')::uuid,25),
    (md5('mypet:p3:listing:puppy-shampoo')::uuid,20),
    (md5('mypet:p3:listing:medicine')::uuid,0)
), opening AS (
    SELECT l.organization_id,l.outlet_id,t.listing_id,t.target_on_hand
    FROM targets t
    JOIN mypet.catalog_listing l ON l.id=t.listing_id
    WHERE t.target_on_hand <> 0
      AND NOT EXISTS (SELECT 1 FROM mypet.inventory_movement m WHERE m.listing_id=t.listing_id)
), inserted AS (
    INSERT INTO mypet.inventory_movement(
        id,organization_id,listing_id,outlet_id,reason,quantity_delta,resulting_on_hand,
        resulting_reserved,source_type,source_reference,actor_id,idempotency_key,trace_id,
        operation_scope,request_fingerprint,occurred_at
    )
    SELECT
        md5('mypet:p3:opening:'||listing_id::text)::uuid,
        organization_id,listing_id,outlet_id,'OPENING_BALANCE',target_on_hand,target_on_hand,0,
        'SEED','P3_INITIAL_STOCK','00000000-0000-0000-0000-000000000000'::uuid,
        'p3-opening:'||listing_id::text,'p3-seed','inventory-opening-balance',
        md5('p3-opening:'||listing_id::text||':'||target_on_hand::text)||md5('m3:'||listing_id::text),now()
    FROM opening
    RETURNING listing_id,resulting_on_hand
)
UPDATE mypet.inventory_balance b
SET on_hand=i.resulting_on_hand,reserved=0,version=b.version+1,updated_at=now()
FROM inserted i
WHERE b.listing_id=i.listing_id;

COMMIT;
