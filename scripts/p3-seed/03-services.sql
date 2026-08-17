-- P3 staging fixtures: grooming/veterinary offerings and rolling future slots. Run after 01.
BEGIN;
INSERT INTO mypet.service_offering(id,organization_id,outlet_id,capability,name,description,duration_minutes,price_paise,active) VALUES
(md5('mypet:p3:service:groom-bath')::uuid,md5('mypet:p3:groomer-org')::uuid,md5('mypet:p3:groomer-outlet')::uuid,'GROOMING','Bath & Brush','Staging grooming fixture.',45,49900,true),
(md5('mypet:p3:service:groom-full')::uuid,md5('mypet:p3:groomer-org')::uuid,md5('mypet:p3:groomer-outlet')::uuid,'GROOMING','Full Grooming','Staging grooming fixture.',90,89900,true),
(md5('mypet:p3:service:vet-general')::uuid,md5('mypet:p3:vet-org')::uuid,md5('mypet:p3:vet-outlet')::uuid,'VETERINARY','General Consultation','Staging veterinary fixture.',30,50000,true),
(md5('mypet:p3:service:vet-vaccine')::uuid,md5('mypet:p3:vet-org')::uuid,md5('mypet:p3:vet-outlet')::uuid,'VETERINARY','Vaccination Consultation','Staging veterinary fixture.',30,65000,true)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,duration_minutes=excluded.duration_minutes,price_paise=excluded.price_paise,active=true,updated_at=now();
WITH t AS (SELECT
((date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata')+interval '1 day 10 hours') AT TIME ZONE 'Asia/Kolkata') a,
((date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata')+interval '1 day 12 hours') AT TIME ZONE 'Asia/Kolkata') b,
((date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata')+interval '2 days 10 hours') AT TIME ZONE 'Asia/Kolkata') c,
((date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata')+interval '2 days 15 hours') AT TIME ZONE 'Asia/Kolkata') d)
INSERT INTO mypet.service_slot(id,service_id,starts_at,ends_at,active)
SELECT * FROM (
SELECT md5('mypet:p3:slot:groom-bath-1')::uuid,md5('mypet:p3:service:groom-bath')::uuid,a,a+interval '45 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:groom-bath-2')::uuid,md5('mypet:p3:service:groom-bath')::uuid,c,c+interval '45 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:groom-full-1')::uuid,md5('mypet:p3:service:groom-full')::uuid,b,b+interval '90 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:groom-full-2')::uuid,md5('mypet:p3:service:groom-full')::uuid,d,d+interval '90 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:vet-general-1')::uuid,md5('mypet:p3:service:vet-general')::uuid,a,a+interval '30 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:vet-general-2')::uuid,md5('mypet:p3:service:vet-general')::uuid,c,c+interval '30 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:vet-vaccine-1')::uuid,md5('mypet:p3:service:vet-vaccine')::uuid,b,b+interval '30 minutes',true FROM t UNION ALL
SELECT md5('mypet:p3:slot:vet-vaccine-2')::uuid,md5('mypet:p3:service:vet-vaccine')::uuid,d,d+interval '30 minutes',true FROM t) s(id,service_id,starts_at,ends_at,active)
ON CONFLICT(id) DO UPDATE SET service_id=excluded.service_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=true;
COMMIT;
