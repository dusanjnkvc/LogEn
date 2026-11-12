/* Read-only explanations and physical layout measurements. */
(function(scope){
 'use strict';
 const contains=(paths,p)=>{let n=0;for(const ring of paths||[]){const hit=scope.ClipperLib.Clipper.PointInPolygon({X:Math.round(p[0]*10),Y:Math.round(p[1]*10)},ring);if(hit===-1)return true;if(hit)n+=scope.ClipperLib.Clipper.Orientation(ring)?1:-1;}return n!==0;};
 function summary(layout){const m=layout.metrics||{},required=layout.requiredPallets||0,placed=layout.accommodatedPallets||0,storage=m.placedStorageArea??((m.rackFootprint||0)+(m.groundFootprint||0)),eligible=m.netStorageEligibleArea??m.availableStorageArea;return {required,placed,unplaced:Math.max(0,required-placed),storage,eligible,utilization:eligible>0?storage/eligible*100:null,gangways:m.gangwayArea||0,physicalWithGangways:storage+(m.gangwayArea||0)};}
 function explain(layout,world){
  if(!layout)return {title:'No layout yet',message:'Generate a layout to inspect space use.'};
  const O=scope.LogEnOptimizer,p=layout.env?.frame?O.toLocal(world,layout.env.frame):world,e=layout.env||{},m=layout.metrics||{};
  if(layout.version===3){const paths=shapes=>(shapes||[]).map(s=>O.geometry.path(s.points));if(contains(layout.boundary,world)===false)return {title:'Outside usable area',message:'Storage must remain inside the confirmed warehouse regions.'};if(contains(paths(layout.aisles),world))return {title:'Reserved gangway',message:'This space is kept clear for access to storage.'};if(contains(layout.blocked,world))return {title:'Blocked or reserved area',message:'A drawing object or its required clearance prevents storage here.'};return {title:'Unallocated space',message:'Existing storage and construction permissions restrict placement. Review existing infrastructure, dimensions and access; this is not proof that no arrangement can fit.'};}
  if(!contains(e.boundary,p))return {title:'Outside usable area',message:'This location is outside the confirmed usable warehouse boundary.'};
  if(contains(e.physical,p)||contains(e.blocked,p)||contains(e.storageBlocked,p))return {title:'Obstacle or required clearance',message:'A pillar, door, restricted area, pedestrian route or its clearance excludes storage here. Review Drawing setup → Clearance around drawing objects and layer roles.'};
  if(contains(m.clearancePaths,p)||contains(e.wallSafety,p))return {title:'Mandatory clearance',message:'This space is reserved by the wall, corner or obstacle clearance rules. Review Drawing setup and Warehouse Designer wall permissions.'};
  if(contains(m.accessPaths,p)||contains(e.baseAccess,p))return {title:'Reserved forklift gangway',message:'This area provides access to storage. Its width comes from Warehouse settings → Gangway width.'};
  if(contains(m.freePaths,p))return {title:'Unused storage-eligible space',message:layout.complete?'All required pallets are already placed; no extra inventory was added to fill this space.':'The bounded search left this space unused. Remaining rows or bays may need different dimensions, orientation or access. Try another arrangement or adjust it manually; this space is not proven impossible to use.'};
  return {title:'Storage allocation',message:'This position is within the current storage footprint. Click a box or rack bay for its part assignments.'};
 }
 scope.LogEnLayoutInsights=Object.freeze({summary,explain,contains});
})(globalThis);
