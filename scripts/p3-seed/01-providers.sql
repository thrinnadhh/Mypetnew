-- P3 staging fixtures: providers and serviceability. Run before 02/03.
BEGIN;
INSERT INTO mypet.identity_account(id,mobile_e164,role,status) VALUES
(md5('mypet:p3:store-owner')::uuid,'+919100009001','MERCHANT','ACTIVE'),
(md5('mypet:p3:groomer-owner')::uuid,'+919100009002','MERCHANT','ACTIVE'),
(md5('mypet:p3:vet-owner')::uuid,'+919100009003','MERCHANT','ACTIVE')
ON CONFLICT(id) DO UPDATE SET role='MERCHANT',status='ACTIVE',updated_at=now();
INSERT INTO mypet.merchant_organization(id,name,status,owner_actor_id,loyalty_rule_version) VALUES
(md5('mypet:p3:store-org')::uuid,'MyPet Staging Pet Store','ACTIVE',md5('mypet:p3:store-owner')::uuid,'p3-e2e-v1'),
(md5('mypet:p3:groomer-org')::uuid,'MyPet Staging Grooming','ACTIVE',md5('mypet:p3:groomer-owner')::uuid,'p3-e2e-v1'),
(md5('mypet:p3:vet-org')::uuid,'MyPet Staging Vet Care','ACTIVE',md5('mypet:p3:vet-owner')::uuid,'p3-e2e-v1')
ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='ACTIVE',owner_actor_id=excluded.owner_actor_id,loyalty_rule_version='p3-e2e-v1';
INSERT INTO mypet.provider_outlet(id,organization_id,name,status,pickup_enabled,dispatch_latitude,dispatch_longitude) VALUES
(md5('mypet:p3:store-outlet')::uuid,md5('mypet:p3:store-org')::uuid,'MyPet Staging Pet Store','ACTIVE',true,13.6288,79.4192),
(md5('mypet:p3:groomer-outlet')::uuid,md5('mypet:p3:groomer-org')::uuid,'MyPet Staging Grooming','ACTIVE',false,13.6310,79.4210),
(md5('mypet:p3:vet-outlet')::uuid,md5('mypet:p3:vet-org')::uuid,'MyPet Staging Vet Care','ACTIVE',false,13.6260,79.4160)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='ACTIVE',pickup_enabled=excluded.pickup_enabled,dispatch_latitude=excluded.dispatch_latitude,dispatch_longitude=excluded.dispatch_longitude,updated_at=now();
INSERT INTO mypet.merchant_staff(account_id,organization_id,outlet_id,permission,active) VALUES
(md5('mypet:p3:store-owner')::uuid,md5('mypet:p3:store-org')::uuid,md5('mypet:p3:store-outlet')::uuid,'OWNER',true),
(md5('mypet:p3:groomer-owner')::uuid,md5('mypet:p3:groomer-org')::uuid,md5('mypet:p3:groomer-outlet')::uuid,'OWNER',true),
(md5('mypet:p3:vet-owner')::uuid,md5('mypet:p3:vet-org')::uuid,md5('mypet:p3:vet-outlet')::uuid,'OWNER',true)
ON CONFLICT(account_id,outlet_id,permission) DO UPDATE SET organization_id=excluded.organization_id,active=true;
INSERT INTO mypet.outlet_capability(outlet_id,capability,verified) VALUES
(md5('mypet:p3:store-outlet')::uuid,'PRODUCT_STORE',true),(md5('mypet:p3:store-outlet')::uuid,'MEDICINE_CATALOG_VIEW_ONLY',true),
(md5('mypet:p3:groomer-outlet')::uuid,'GROOMING',true),(md5('mypet:p3:vet-outlet')::uuid,'VETERINARY_CLINIC',true)
ON CONFLICT(outlet_id,capability) DO UPDATE SET verified=true;
INSERT INTO mypet.outlet_service_pincode(outlet_id,pincode,active)
SELECT o,p,true FROM (VALUES
(md5('mypet:p3:store-outlet')::uuid,'517501'),(md5('mypet:p3:store-outlet')::uuid,'517502'),(md5('mypet:p3:store-outlet')::uuid,'517507'),
(md5('mypet:p3:groomer-outlet')::uuid,'517501'),(md5('mypet:p3:groomer-outlet')::uuid,'517502'),(md5('mypet:p3:groomer-outlet')::uuid,'517507'),
(md5('mypet:p3:vet-outlet')::uuid,'517501'),(md5('mypet:p3:vet-outlet')::uuid,'517502'),(md5('mypet:p3:vet-outlet')::uuid,'517507')) v(o,p)
ON CONFLICT(outlet_id,pincode) DO UPDATE SET active=true;
COMMIT;
