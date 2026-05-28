# Source RMS screens — notes from screenshots

These are the existing Oracle Retek RMS forms that frame the work. The new app
mirrors their concepts (price change, location selection, zones, promotions)
but adds a location-list level of granularity.

## 1. `pcstore` — Price Change Locations Maintenance

Top form for choosing which locations a price change applies to. Today:

- "Selection Type" dropdown: All Zones, Zone, Zone Group, Store, ...
- The grid above is zone-keyed: `Zone Group | Description | Zone | Description | Comments`
- Adds rows via `Add Zones` button.

**Gap:** there is no "Location List" selection type. You can add individual
stores one by one, but you cannot save and reuse a list, and you cannot mix
"these specific 47 stores" with the rest of the zone logic cleanly.

## 2. `pcskust` — Retail Price Change Header

The price change object itself:

- Price Change `863266`, name "Test Penny Mark"
- Status: Worksheet
- Effective Date, Reason (e.g. `9 Slow Seller`)
- Pricing Level: **Zone** (this is the dimension we need to extend)
- Pricing Zone Group: `3000 FD Basic Pricing`
- SKU: `3499080 Citronella Torch`
- Flags: X-Label Required, Markup Cancellation, In Store Printing
- Vendor Funded Markdown block (Deal ID, Supplier, Partner)
- **Event-Level Price Change Default** grid: Currency, Type (Set Price to a
  Set Amount, % off, $ off…), Amount, Adjust, Ends In, Multi-Units, Multi-Retail
- Buttons: OK | Locations | SKU | Conflicts | Cancel

The Options menu shows the approval ladder: Worksheet → Submit → GMM → SVP →
Final → Reject / Cancel / Delete, plus calculate-impact actions.

## 3. `pcsfbysk` — Retail Price Change by Item / Location

The grid-heavy editor:

- Header: Item, Color, Price Change #, Status, Effective Date
- Per-row: Zone | Description | Current Retail | New Mkup% | New Retail |
  New Mkup% | Clearance Label % | Est Original Retail | Multi Unit | Curr
- Notice every row in the screenshot is a **Zone** row (Zone 01, Zone 03,
  Zone 06, …). This is the core constraint to break: we need rows that are
  Zone OR Location-List OR explicit Store-set.
- Buttons: Multi-Unit | Add Zones | Zone Detail | OK | OK + Repeat | Delete | Cancel

## 4. `promhead` / `promsku` / `promst` — Promotion screens

The promotion side of the house (Event 767 SZC Chaser Event, Promo Type
Clearance). Same modeling pattern: Header → Items → Stores. The
`promst` form ("Promotion Store Maintenance") *does* let you add stores one
by one or by store group, but again — no reusable location list, and the
form is row-at-a-time.

## What this POC adds

- A **Location List** entity: name, description, member store IDs, saveable
  and reusable.
- The price-change editor accepts Location List as a first-class selection
  type alongside Zone / Store.
- The grid shows one row per Store-or-LocationList-or-Zone, with the same
  edit columns as RMS plus an "applies-to" tag.
- "Add stores by intent" — paste a list, or describe in natural language,
  and the AI proposes a Location List you can save.
