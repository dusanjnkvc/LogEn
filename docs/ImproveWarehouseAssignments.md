# Automatic / Improve Warehouse assignments

Warehouse Designer uses the same part assignment list as Overview → Improve Warehouse.

- The project’s saved pallet threshold applies to both screens: quantities at or below it go to racks; larger quantities go to ground storage.
- Both screens use the selected category and current inventory, shift, coverage, stacking and warehouse settings.
- Selecting Automatic clears previous per-part overrides. Changing a part assignment switches to Manual per-part assignments.
- All on ground storage and All on Racks remain separate explicit modes.
- Existing Layout uses the same desired assignments. Installed capacity, shelf fit and Allow New Storage Construction are checked during drawing allocation; shortages remain visible. Conflicting saved occupancy is flagged for review.
- Previously generated layouts must be regenerated to apply the updated assignments. Saved inventory and source drawings are retained.

Validation: `node --test webapp/improve-warehouse-sync.test.cjs` covers the threshold/category matrix, manual/forced modes, both warehouse modes, UI switching and Existing Layout with construction disabled.
