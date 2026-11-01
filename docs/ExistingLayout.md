# Existing Layout allocation

Uncheck **Greenfeild** in Warehouse Designer. **Allow New Storage Construction** starts off for a new project and resets to off whenever a DWG is uploaded. Switching modes preserves the setting and each mode's drawing setup/layout.

1. Configure rack types in Warehouse Settings.
2. Upload the warehouse DWG and choose Create Layout.
3. Select units and the closed warehouse boundary. Classify outer outlines as **Existing rack**, **Existing ground storage**, or **Existing gangway**. Use Reference only for rack-frame details and dimension lines. Unclassified objects remain restricted.
4. Click a rack outline and choose its type, bay count and positions per shelf level. Blank bay count is inferred from outline length; positions per level default to two and can be changed. The configured type and bay count must fit the actual rectangular outline. Shelf capacity uses the type's levels, usable dimensions and pillar clearances.
5. Positions are initially EMPTY. RESERVED and UNAVAILABLE positions are not used; explicitly saved ALLOCATED occupancy is deducted from demand. Per-position occupancy can be changed from the selected outline's configuration.
6. Classify adjacent existing gangways. Disconnected, missing or undersized access is flagged. Review the drawing and generate the allocation.

With construction off, allocations stay inside the existing infrastructure. Rack and ground shortages are reported separately, and created positions remain zero. With construction on, compatible existing capacity is used before additions are considered. Additional rack/ground placement uses a bounded free-space and connected-access search; additions cannot cover original storage, gangways, restrictions or the boundary. No new storage is created when material already fits.

Ground capacity is dimension-dependent. The reference capacity is a deterministic floor-position grid in each actual zone, using an identified compatible PN and its clearances. Allocated pallet quantities, stacking, known shortages and remaining floor area are separate results; the reference grid is not a universal capacity for every mix of pallet dimensions.

Existing infrastructure stays fixed. Generated additions can be adjusted only where their accessible faces remain alongside full-width planned gangways. Greenfield editing is unchanged.

## Export

Use the updated local AutoCAD helper (version 6). Original CAD entities, including imported LogEn-tagged geometry, are preserved. Existing infrastructure receives occupancy annotations, not duplicated rack or ground geometry. New racks are orange; new ground storage is yellow. Existing-rack cyan, ground-zone purple, allocated highlights, green existing aisles and red restrictions are shown in the preview.

Generated occupancy/additions use separate XData tags, allowing repeated exports to replace only this workflow's output. DWG/PDF exports use the current saved allocation. The Excel output includes the capacity summary, infrastructure, occupancy, parts and shortages. Review final layouts manually; bounded placement and user-confirmed access are not an optimized or certified warehouse design.
