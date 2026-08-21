-- M1: make existing provider owners first-class Merchant staff members.
-- Historical migrations remain immutable; this is a forward-only data repair.
-- Existing OWNER rows are never reactivated here; revocation must remain authoritative.

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
  AND NOT EXISTS (
      SELECT 1
      FROM mypet.merchant_staff existing
      WHERE existing.account_id = organization.owner_actor_id
        AND existing.outlet_id = outlet.id
        AND existing.permission = 'OWNER'
  );
