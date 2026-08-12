# Customer App — Stitch Reference Coverage

This document maps the uploaded Stitch Customer reference screens to the restored `apps/customer-app` implementation on branch `restore/customer-app-from-mypet`.

The old `thrinnadhh/MyPet` Customer app is the implementation baseline. Stitch is used only where the Customer frontend lacks the corresponding surface; it is not used to create duplicate routes.

| Stitch reference | Customer implementation | Status |
|---|---|---|
| `pawsapp_home_hospitals_grooming_added` | `src/screens/home-screen.tsx` | Existing — home includes commerce, grooming, hospitals/care and guides |
| `food_nutrition_pawsapp_catalog` | `src/app/category/[id].tsx`, `src/app/commerce/[slug].tsx`, `CategoryTemplate.tsx` | Existing |
| `toys_enrichment_simple_catalog` | shared commerce/category routes and route catalog | Existing |
| `treats_chews_simple_catalog` | shared commerce/category routes and route catalog | Existing |
| `travel_apparel_simple_catalog` | shared commerce/category routes and route catalog | Existing |
| `waste_management_simple_catalog` | shared commerce/category routes and route catalog | Existing |
| `furniture_sleep_simple_catalog` | shared commerce/category routes and route catalog | Existing |
| `grooming_services_pawsapp_catalog` | `src/app/grooming/index.tsx` | Existing |
| `grooming_profile_paws_bubbles_spa_availability` | `src/app/groomer/[id].tsx`, provider composition/profile components | Existing |
| `shop_profile_the_posh_paws_loyalty_categories` | `src/app/shop/[id].tsx`, commerce provider profile component | Existing |
| `hospital_profile_city_pet_hospital_availability` | `src/app/hospital/[id].tsx`, care provider profile component | Existing |
| `user_profile_pet_management` | `src/screens/profile-screen.tsx` + `src/services/customer-pets.ts` | **Gap filled from Stitch reference on this branch** |
| `your_orders_bookings` | `src/screens/orders-screen.tsx`, appointments routes/screens | Existing |
| `medical_reports_history_entry` | `src/app/health/reports.tsx` | Existing |
| `payment_secure_checkout` | `src/app/checkout/index.tsx` and appointment payment route | Existing |
| `guide_coat_skin_health` | guide routes/content | Existing |
| `guide_puppy_nutrition_0_2_mo` | guide routes/content | Existing |
| `guide_puppy_growth_2_12_mo` | guide routes/content | Existing |

## Stitch gap implemented

The original Customer Profile route managed account details, delivery address/contact, language and sign-out, but did not render the existing Customer pet service. The uploaded `user_profile_pet_management` reference shows a dedicated **My Pets** area with pet cards and an **Add Pet** action.

The restored branch now adds that missing surface to the Profile screen while preserving the existing Profile flow:

- fetches saved pets through `fetchCustomerPets`
- creates pets through `createCustomerPet`
- renders responsive pet cards using the shared design system
- provides Dog / Cat / Other species selection
- supports optional breed and date of birth
- includes loading, empty, offline and error states
- reports API failures instead of simulating success
- adds English, Hindi and Telugu labels
- adds a source-layout contract test for the pet-management integration

## Integration boundary

This branch is a **Customer frontend transplant**, not a backend migration. The restored Customer app originated against the old MyPet service topology. Some services and cross-repository tests therefore reference contracts or backend files that do not exist in the current MyPetNew Kotlin/Spring modular monolith.

In particular, the restored `customer-pets.ts` currently expects `/api/v1/pets`. MyPetNew must add or remap that contract in a later backend compatibility pass before live pet persistence can be certified. No fake Customer-side success is introduced here.

## Visual scope

The Stitch files are design references. Existing Customer routes are retained where functionality already exists. This mapping confirms functional/screen-family coverage; it does **not** claim that every existing route is pixel-identical to the Stitch screenshot.
