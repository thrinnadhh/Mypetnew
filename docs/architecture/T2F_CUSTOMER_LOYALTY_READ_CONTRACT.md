# T2F Customer Loyalty Read Projection

T2F migrates active Sprint-1 Customer loyalty presentation away from restored MyPet `/api/v1/loyalty/*` runtime routes and onto the canonical MyPetNew merchant-scoped read endpoint.

## Canonical boundary

- Authenticated Customer read: `GET /api/v1/customer/loyalty/{organizationId}`.
- Spring authentication is authoritative; the Customer identity is never supplied by the client.
- Response truth is limited to `organizationId`, `availableStars`, and issued `rewards` count.
- Loyalty remains scoped to the merchant organization. Stars from different organizations are never aggregated into a global balance.
- The Customer store profile resolves the public outlet to its canonical `organizationId`, then requests that merchant's Customer-owned balance.

## Sprint-1 UI behavior

- The store loyalty card renders the server-provided available-star balance against the locked 10-star cycle.
- The card may display the number of server-issued rewards but does not invent reward codes, amounts, expiry state, eligibility, or redemption state absent from the canonical response.
- The restored welcome-star claim action is removed from the active loyalty card because MyPetNew exposes no canonical Sprint-1 Customer mutation for that action.
- The global wallet screen does not call legacy loyalty wallet/progress endpoints. It explains that Sprint-1 loyalty is merchant-specific and directs the Customer to a store context for canonical balance reads.
- Online-payment promotions and legacy global loyalty wallet behavior are not activated by T2F.

## Deferred compatibility

Legacy helpers in `services/loyalty.ts` may remain temporarily for deferred/non-Sprint-1 surfaces and test inventory, but active Sprint-1 store loyalty and wallet UI must not invoke `fetchLoyaltyProgress`, `claimWelcomeStar`, or `fetchCustomerWallet`.

T2F does not change loyalty award semantics, POS award transaction boundaries, reward issuance rules, recurring orders, grooming/vet loyalty, online payment, or redemption/stacking behavior. Those require their own authoritative contracts.
