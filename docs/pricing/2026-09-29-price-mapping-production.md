# Price catalogue mapping — treatwell-2026-09-28

Generated 2026-09-28T23:49:08.835Z (apply) against database host `production (Neon, eu-west-2)`. Source: Treatwell menu read on 2026-09-28; see prisma/price-catalog/treatwell-2026-09-28.ts.

Prices are the platform-listed amounts shown as “VAT excluded” (owner display policy; nothing added or back-calculated). `—` = no NHS option. Existing rows keep their current listed/bookable state unless retired.

## Menu items (ServiceOffering)

| Key | Name (English) | Category | Action |
|---|---|---|---|
| wash-cut-blow-dry | Wash, Haircut & Blow Dry | Haircuts | CREATE (new menu item) |
| children-haircut | Children's Wash, Haircut & Blow Dry (12 and under) | Haircuts | CREATE (new menu item) |
| full-head-colour | Full Head Colour & Blow Dry | Colouring | CREATE (new menu item) |
| half-head-highlights | Half Head Highlights & Blow Dry | Colouring | CREATE (new menu item) |
| full-head-highlights | Full Head Highlights & Blow Dry | Colouring | CREATE (new menu item) |
| partial-highlights | Partial Highlights & Blow Dry | Colouring | CREATE (new menu item) |
| balayage | Balayage, Haircut & Blow Dry | Colouring | CREATE (new menu item) |
| cold-perm-half-head | Cold Perm – Half Head | Perms | CREATE (new menu item) |
| cold-perm-full-head | Cold Perm – Full Head | Perms | CREATE (new menu item) |
| hair-correction | Hair Correction | Perms | CREATE (new menu item) |
| keratin-treatment | Keratin Treatment | Perms | CREATE (new menu item) |
| paimore-hot-perm | Paimore Hot Perm | Perms | CREATE (new menu item) |
| inkarami-treatment | Dr.Jr. TOKIO Inkarami System Treatment | Treatments | CREATE (new menu item) |
| shampoo-blow-dry | Shampoo & Blow Dry | Styling | CREATE (new menu item) |

## Options (Service rows)

| Action | Existing ID | Current name | Menu item | Length | Type | Current price | New price | Duration | VAT wording (evidence) | Price nature | Listed / bookable after | Appointments | Changes |
|---|---|---|---|---|---|---:|---:|---|---|---|---|---:|---|
| UPDATE | cmns9nwec000lhgg0erqsl66r | Short Over Ears - Wash, Haircut & Blow Dry | wash-cut-blow-dry | SHORT | STANDARD | £37.00 | £37.00 | 55 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → wash-cut-blow-dry; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nvv90000hgg05g3qtkg0 | Short Over Ears - Wash, Haircut & Blow Dry (Student & NHS) | wash-cut-blow-dry | SHORT | NHS | £33.00 | £33.00 | 55 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → wash-cut-blow-dry; length — → SHORT; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwec000nhgg0pc6ty9xa | Long Hair - Wash, Haircut & Blow Dry | wash-cut-blow-dry | LONG | STANDARD | £49.00 | £49.00 | 85 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 1 | link → wash-cut-blow-dry; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwea000hhgg0ccq9s9ej | Long Hair - Wash, Haircut & Blow Dry (Student & NHS) | wash-cut-blow-dry | LONG | NHS | £44.00 | £45.00 | 85 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → wash-cut-blow-dry; length — → LONG; type STANDARD → NHS; price £44.00 → £45.00; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| CREATE | (new) | Extra Long Hair - Wash, Haircut & Blow Dry | wash-cut-blow-dry | EXTRA_LONG | STANDARD | — | £56.00 | 85 min placeholder from Long Hair - Wash, Haircut & Blow Dry (85 min), unconfirmed | VAT excluded (Treatwell item label) | LISTED | yes / no | 0 | new option |
| CREATE | (new) | Extra Long Hair - Wash, Haircut & Blow Dry (NHS) | wash-cut-blow-dry | EXTRA_LONG | NHS | — | £51.00 | 85 min placeholder from Long Hair - Wash, Haircut & Blow Dry (85 min), unconfirmed | VAT excluded (Treatwell item label) | LISTED | yes / no | 0 | new option |
| UPDATE | cmns9nwjk0010hgg0f9bodpek | Children (Up to 12Yr) - Short Over Ears | children-haircut | SHORT | STANDARD | £19.00 | £19.00 | 60 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → children-haircut; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjk0012hgg041qq89a9 | Children (Up to 12Yr) - Long Hair | children-haircut | LONG | STANDARD | £22.00 | £22.00 | 60 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → children-haircut; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| CREATE | (new) | Children (Up to 12Yr) - Extra Long Hair | children-haircut | EXTRA_LONG | STANDARD | — | £28.00 | 60 min placeholder from Children (Up to 12Yr) - Long Hair (60 min), unconfirmed | VAT excluded (Treatwell item label) | LISTED | yes / no | 0 | new option |
| UPDATE | cmns9nwjk0013hgg0d281ze3l | Full Head Colour & Blow Dry - Short Hair | full-head-colour | SHORT | STANDARD | £121.00 | £121.00 | 150 min | VAT excluded (Treatwell item label) | SUBJECT_TO_CONSULTATION | yes / yes | 0 | link → full-head-colour; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; price nature LISTED → SUBJECT_TO_CONSULTATION; price note; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwdz0009hgg0ds4c1ls8 | Full Head Colour & Blow Dry - Short Hair (NHS) | full-head-colour | SHORT | NHS | £109.00 | £109.00 | 150 min | VAT excluded (Treatwell item label) | SUBJECT_TO_CONSULTATION | yes / yes | 0 | link → full-head-colour; length — → SHORT; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; price nature LISTED → SUBJECT_TO_CONSULTATION; price note; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjk0014hgg0aeiz5ybg | Full Head Colour & Blow Dry - Medium Hair | full-head-colour | MEDIUM | STANDARD | £145.00 | £145.00 | 150 min | VAT excluded (Treatwell item label) | SUBJECT_TO_CONSULTATION | yes / yes | 0 | link → full-head-colour; length — → MEDIUM; VAT wording UNSPECIFIED → EXCLUDED; price nature LISTED → SUBJECT_TO_CONSULTATION; price note; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjk0015hgg0b768sohh | Full Head Colour & Blow Dry - Medium Hair (NHS) | full-head-colour | MEDIUM | NHS | £131.00 | £131.00 | 150 min | VAT excluded (Treatwell item label) | SUBJECT_TO_CONSULTATION | yes / yes | 0 | link → full-head-colour; length — → MEDIUM; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; price nature LISTED → SUBJECT_TO_CONSULTATION; price note; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwea000ghgg01a2c0p21 | Full Head Colour & Blow Dry - Long Hair | full-head-colour | LONG | STANDARD | £157.00 | £157.00 | 150 min | VAT excluded (Treatwell item label) | SUBJECT_TO_CONSULTATION | yes / yes | 0 | link → full-head-colour; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; price nature LISTED → SUBJECT_TO_CONSULTATION; price note; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwea000ehgg059nhuaqo | Full Head Colour & Blow Dry - Long Hair (NHS) | full-head-colour | LONG | NHS | £142.00 | £142.00 | 150 min | VAT excluded (Treatwell item label) | SUBJECT_TO_CONSULTATION | yes / yes | 0 | link → full-head-colour; length — → LONG; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; price nature LISTED → SUBJECT_TO_CONSULTATION; price note; source → treatwell:2026-09-28 |
| CREATE | (new) | Full Head Colour & Blow Dry - Extra Long Hair | full-head-colour | EXTRA_LONG | STANDARD | — | £194.00 (long + £37) | 150 min placeholder from Full Head Colour & Blow Dry - Long Hair (150 min), unconfirmed | VAT excluded (owner policy; £37 add-on label unverified) | SUBJECT_TO_CONSULTATION | yes / no | 0 | new option |
| CREATE | (new) | Full Head Colour & Blow Dry - Extra Long Hair (NHS) | full-head-colour | EXTRA_LONG | NHS | — | £179.00 (long + £37) | 150 min placeholder from Full Head Colour & Blow Dry - Long Hair (150 min), unconfirmed | VAT excluded (owner policy; £37 add-on label unverified) | SUBJECT_TO_CONSULTATION | yes / no | 0 | new option |
| UPDATE | cmns9nwjl0016hgg0jk6esm1q | Half Head Highlights & Blow Dry - Short Hair | half-head-highlights | SHORT | STANDARD | £181.00 | £181.00 | 165 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → half-head-highlights; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjk0011hgg01ya6c5x9 | Half Head Highlights & Blow Dry - Short Hair (NHS) | half-head-highlights | SHORT | NHS | £164.00 | £164.00 | 165 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → half-head-highlights; length — → SHORT; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwea000dhgg0wwtqcxnt | Half Head Highlights & Blow Dry - Long Hair | half-head-highlights | LONG | STANDARD | £218.00 | £218.00 | 165 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → half-head-highlights; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwee000qhgg04jcm4030 | Half Head Highlights & Blow Dry - Long Hair (NHS) | half-head-highlights | LONG | NHS | £196.00 | £196.00 | 165 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → half-head-highlights; length — → LONG; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwe3000chgg0r6srt52a | Full Head Highlights & Blow Dry - Short Hair | full-head-highlights | SHORT | STANDARD | £211.00 | £211.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → full-head-highlights; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwec000ohgg0a4re5gbf | Full Head Highlights & Blow Dry - Short Hair (NHS) | full-head-highlights | SHORT | NHS | £196.00 | £196.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → full-head-highlights; length — → SHORT; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwdy0007hgg0h6ld3lk6 | Full Head Highlights & Blow Dry - Long Hair | full-head-highlights | LONG | STANDARD | £278.00 | £278.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → full-head-highlights; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwdn0006hgg0m7tqqauy | Full Head Highlights & Blow Dry - Long Hair (NHS) | full-head-highlights | LONG | NHS | £251.00 | £251.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → full-head-highlights; length — → LONG; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwec000phgg0o5vfj20x | Partial Highlights & Blow Dry - Short Hair | partial-highlights | SHORT | STANDARD | £182.00 | £182.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → partial-highlights; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwea000ihgg0qf2t7p11 | Partial Highlights & Blow Dry - Short Hair (NHS) | partial-highlights | SHORT | NHS | £165.00 | £165.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → partial-highlights; length — → SHORT; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwec000mhgg0sdljoigs | Partial Highlights & Blow Dry - Long Hair | partial-highlights | LONG | STANDARD | £278.00 | £278.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → partial-highlights; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwe2000bhgg0l28hr5nz | Partial Highlights & Blow Dry - Long Hair (NHS) | partial-highlights | LONG | NHS | £251.00 | £251.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → partial-highlights; length — → LONG; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjm0018hgg0l8jlf0rd | Balayage, Haircut & Blow Dry (Adult) | balayage | — | STANDARD | £339.00 | £339.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → balayage; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwdy0008hgg096k6f010 | Balayage, Haircut & Blow Dry (NHS) | balayage | — | NHS | £303.00 | £303.00 | 225 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → balayage; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwec000khgg08b4nzej3 | Cold Perm Half Head | cold-perm-half-head | — | STANDARD | £157.00 | £157.00 | 150 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → cold-perm-half-head; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwea000fhgg0o6tj8w30 | Cold Perm Full Head | cold-perm-full-head | — | STANDARD | £194.00 | £194.00 | 150 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → cold-perm-full-head; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nw8r0004hgg0r6pzg62z | Hair Correction | hair-correction | — | STANDARD | £242.00 | £242.00 | 210 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → hair-correction; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwio000shgg0uxi2mk4p | Keratin Treatment | keratin-treatment | — | STANDARD | £242.00 | £242.00 | 180 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → keratin-treatment; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwe0000ahgg0jdw9m2uu | Paimore Hot Perm | paimore-hot-perm | — | STANDARD | £242.00 | £242.00 | 210 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → paimore-hot-perm; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwj2000vhgg0n8ltm92y | Dr.Jr. TOKIO Inkarami System Treatment | inkarami-treatment | — | STANDARD | £154.00 | £154.00 | 120 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → inkarami-treatment; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwj1000uhgg05su396k2 | Dr.Jr. TOKIO Inkarami System Treatment (NHS) | inkarami-treatment | — | NHS | £143.00 | £143.00 | 120 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → inkarami-treatment; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjd000yhgg00poz0l3k | Shampoo & Blow Dry - Short Over Ears | shampoo-blow-dry | SHORT | STANDARD | £30.00 | £30.00 | 45 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → shampoo-blow-dry; length — → SHORT; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwj4000xhgg0hv4em6ud | Shampoo & Blow Dry - Short Over Ears (Student & NHS) | shampoo-blow-dry | SHORT | NHS | £25.00 | £25.00 | 45 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → shampoo-blow-dry; length — → SHORT; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwjl0017hgg04sxi500d | Shampoo & Blow Dry - Long Over Ears | shampoo-blow-dry | LONG | STANDARD | £40.00 | £40.00 | 60 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → shampoo-blow-dry; length — → LONG; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| UPDATE | cmns9nwji000zhgg0ujl4rswj | Shampoo & Blow Dry - Long Over Ears (Student & NHS) | shampoo-blow-dry | LONG | NHS | £35.00 | £35.00 | 60 min | VAT excluded (Treatwell item label) | LISTED | yes / yes | 0 | link → shampoo-blow-dry; length — → LONG; type STANDARD → NHS; VAT wording UNSPECIFIED → EXCLUDED; source → treatwell:2026-09-28 |
| CREATE | (new) | Shampoo & Blow Dry - Extra Long Hair | shampoo-blow-dry | EXTRA_LONG | STANDARD | — | £50.00 | 60 min placeholder from Shampoo & Blow Dry - Long Over Ears (60 min), unconfirmed | VAT excluded (Treatwell item label) | LISTED | yes / no | 0 | new option |
| CREATE | (new) | Shampoo & Blow Dry - Extra Long Hair (NHS) | shampoo-blow-dry | EXTRA_LONG | NHS | — | £45.00 | 60 min placeholder from Shampoo & Blow Dry - Long Over Ears (60 min), unconfirmed | VAT excluded (Treatwell item label) | LISTED | yes / no | 0 | new option |
| UNCHANGED | cmns9nw0o0001hgg0rebelto6 | Consultation & Patch Test | — | — | STANDARD | £15.00 | (unchanged) | 15 min | UNSPECIFIED | LISTED | yes / yes | 0 | Sensitive-test flow kept as it is (owner, 2026-09-28): no new, merged or repurposed patch tests; eligibility, validity and routing unchanged. |
| UNCHANGED | cmr87t50u0000ckdoxm5f8htg | Consultation | — | — | STANDARD | £0.00 | (unchanged) | 15 min | UNSPECIFIED | LISTED | yes / yes | 6 | Free consultation that consultation-only services route to; not part of the Treatwell list. |
| RETIRE | cmns9nwec000jhgg0hbkrflkd | Cold Perm Full Head (NHS) | cold-perm-full-head | — | NHS | £159.00 | (kept, not offered) | 150 min | — | — | no / no | 0 | hide from listings; close to new bookings; type → NHS |
| RETIRE | cmns9nw5t0003hgg0vjjr7wh0 | Cold Perm Half Head (NHS) | cold-perm-half-head | — | NHS | £129.00 | (kept, not offered) | 150 min | — | — | no / no | 0 | hide from listings; close to new bookings; type → NHS |
| RETIRE | cmns9nw390002hgg0t22mkyx3 | Hair Correction (NHS) | hair-correction | — | NHS | £198.00 | (kept, not offered) | 210 min | — | — | no / no | 0 | hide from listings; close to new bookings; type → NHS |
| RETIRE | cmns9nwbe0005hgg0ep4l0nz7 | Keratin Treatment (NHS) | keratin-treatment | — | NHS | £198.00 | (kept, not offered) | 180 min | — | — | no / no | 0 | hide from listings; close to new bookings; type → NHS |
| RETIRE | cmns9nwgi000rhgg0efjijjnr | Paimore Hot Perm (NHS) | paimore-hot-perm | — | NHS | £198.00 | (kept, not offered) | 210 min | — | — | no / no | 0 | hide from listings; close to new bookings; type → NHS |
| UNCHANGED | cmns9nwj0000thgg076pqmj4y | Perm Under Shoulder Add-on | — | — | STANDARD | £24.00 | (unchanged) | 210 min | UNSPECIFIED | LISTED | yes / yes | 0 | Not in the 2026-09-28 Treatwell check; left unchanged rather than guessed. |
| UNCHANGED | cmns9nwj3000whgg0m7qecd81 | Heat Set Add-on | — | — | STANDARD | £10.00 | (unchanged) | 45 min | UNSPECIFIED | LISTED | yes / yes | 0 | £20 Special Set is on hold: no new add-on, pairing or rename, and this £10 item is NOT merged into it. |

## Historical prices

Appointments with no recorded price: **0**. Completed ones for commission-paid stylists: **0**.

These are shown as “price not recorded” (never today’s price or £0); payroll refuses to compute commission from them. This update does not touch any appointment.

## Platform facts intentionally not turned into site prices

- Adds Extra Long £37 (Treatwell, under full-head colour): used only as the extra-long composite (long-hair price + £37). Its own VAT label was not verified.
- Special Set add-on £20 (Treatwell): on hold — no pairing, standalone service or booking add-on rules were created.
- Patch Test Can camp after Color of Perm £15 and Patch Test £15 (two Treatwell categories): not added, merged or repurposed; the site keeps its single Consultation & Patch Test flow.
- Cold perm has no short/medium/long tiers on Treatwell; none were created. No Paimore straight+curl or photo-only packages were added.
- Durations for newly created extra-long options were not confirmed; those rows take the long-hair duration as a placeholder, are flagged durationConfirmed=false and are not open for direct booking.

## Problems

None — the plan can be applied.
