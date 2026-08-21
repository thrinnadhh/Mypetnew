-- M1: make existing provider owners first-class Merchant staff members.
-- Historical migrations remain immutable; this is a forward-only data repair.

INSERT INTO mypet.merchant_staff (
    account_id,
    organization_id,
    outlet_id,
    permission,
    active
)
SELECT
    organization.owner_actor_id,
    outlet.organization_id,
    outlet.id,
    'OWNER',
    TRUE
FROM mypet.provider_outlet outlet
JOIN mypet.merchant_organization organization
  ON organization.id = outlet.organization_id
JOIN mypet.identity_account account
  ON account.id = organization.owner_actor_id
 AND account.role = 'MERCHANT'
WHERE organization.owner_actor_id IS NOT NULL
ON CONFLICT (account_id, outlet_id, permission)
DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    active = TRUE;
