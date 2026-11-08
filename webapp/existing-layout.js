/* Existing infrastructure is immutable. Only occupancy and optional additions are generated. */
(function(scope){
  'use strict';
  const D=scope.LogEnDomain,L=scope.LogEnLayout,O=scope.LogEnOptimizer,G=O.geometry,E=.11;
  const polygon=r=>G.path(L.corners(r)),area=paths=>G.area(paths)/1e6;
  const overlap=(a,b)=>G.area(G.intersect(a,b))>E;
  const bounded=pts=>{const b=L.bounds(pts);return {x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY};};
  const role=(e,o)=>scope.LogEnWarehouseGeometry?scope.LogEnWarehouseGeometry.role(e,o):o.entityRoles?.[e.id]||o.layerRoles?.[e.layer]||'obstacle';
  function pose(e,scale){
    if(!e.closed||!L.core.validPolygon(e.points))throw new Error('Existing storage '+e.id+' needs a closed, straight outline. Classify only the outer storage outline.');
    const pts=e.points.map(p=>p.map(n=>n*scale)),angle=O.buildingAngle(pts),frame={angle,sx:1,sy:1},local=pts.map(p=>O.toLocal(p,frame));
    return {points:pts,local,frame,...bounded(local)};
  }
  function infrastructure(geometry,settings,options){
    const types=D.configuredRackTypes(settings),items=[],issues=[];
    for(const e of geometry.entities){const kind=role(e,options);if(!['existing-rack','existing-ground','gangway'].includes(kind)||e.id===options.boundaryId)continue;
      try{const p=pose(e,options.scale),cfg=options.existingStorage?.[e.id]||{},item={...p,id:e.id,kind,config:cfg,status:cfg.status||'EMPTY'};
        if(kind==='existing-rack'){
          const t=types.find(t=>t.id===(cfg.typeId||options.existingRacks?.[0]?.typeId))||types[0];if(!t)throw new Error('Choose a rack type for '+e.id+'.');
          // Rack frontage follows the longer rectangle edge; the type controls usable shelf capacity.
          if(p.h>p.w){item.frame={angle:p.frame.angle+Math.PI/2,sx:1,sy:1};item.local=p.points.map(v=>O.toLocal(v,item.frame));Object.assign(item,bounded(item.local));}
          const bw=t.rackSlotLength+t.rackStructuralLength,bd=t.rackSlotDepth+t.rackStructuralDepth;
          if(Math.abs(G.area([G.path(item.local)])-item.w*item.h)>Math.max(1,item.w*item.h*.00001))throw new Error('Rack '+e.id+' needs a rectangular outer outline.');
          if(!D.rackFitsBuilding(t))issues.push({pn:e.id,message:D.rackHeightMessage(t)});
          item.type=t;item.bays=cfg.bays??Math.floor((item.w+E)/bw);item.positionsPerLevel=cfg.positionsPerLevel??2;
          if(!Number.isSafeInteger(item.bays)||item.bays<1||item.bays>1000||item.bays*bw>item.w+E||bd>item.h+E)throw new Error('Rack '+e.id+': selected bays/type exceed the original outline. Check its type, bays and drawing units.');
          if(item.bays*t.rackLevels*item.positionsPerLevel>10000)throw new Error('Rack '+e.id+': more than 10,000 fixed positions. Split the drawing into smaller scopes.');
          if(!Number.isSafeInteger(item.positionsPerLevel)||item.positionsPerLevel<1||item.positionsPerLevel>100)throw new Error('Rack '+e.id+': enter 1–100 positions per level.');
          const cell=(t.rackSlotLength-(item.positionsPerLevel+1)*t.betweenBoxesAllowance)/item.positionsPerLevel;if(cell<=0)throw new Error('Rack '+e.id+': positions and pillar clearances leave no usable frontage.');
          item.slots=[];for(let b=0;b<item.bays;b++)for(let level=1;level<=t.rackLevels;level++)for(let position=1;position<=item.positionsPerLevel;position++){
            const id=e.id+':'+(b+1)+':'+level+':'+position,saved=cfg.occupancy?.find(v=>v.id===id),status=saved?.status||item.status;
            item.slots.push({id,bay:b+1,level,position,status,...saved,cellLength:cell,cellDepth:t.rackSlotDepth,cellHeight:t.rackSlotHeight});
          }
        }
        if(kind==='gangway'&&Math.min(item.w,item.h)+E<settings.gangwayWidth)throw new Error('Gangway '+e.id+' is narrower than the configured gangway width.');
        if(item.slots?.some(v=>!['EMPTY','ALLOCATED','RESERVED','UNAVAILABLE'].includes(v.status)||(v.status==='ALLOCATED'&&!v.pn)))throw new Error('Rack '+e.id+': invalid saved occupancy state or missing PN.');
        items.push(item);
      }catch(error){issues.push({pn:e.id,message:error.message});}
    }
    return {items,issues};
  }
  function slotFit(input,item,slot){
    const t=item.type;if(!D.rackFitsBuilding(t))return null;
    const f=D.calculateBoxRack(1,input.length,input.width,input.height,slot.cellLength,slot.cellDepth,slot.cellHeight,1,0,0,0,{...t,rackAllowStacking:false,rackAllowDepthRows:false});
    return f.fits?{length:f.rotated?input.width:input.length,depth:f.rotated?input.length:input.width,rotated:f.rotated}:null;
  }
  function rackGroups(items){
    return items.filter(v=>v.kind==='existing-rack').flatMap(item=>Array.from({length:item.bays},(_,b)=>{
      const t=item.type,w=t.rackSlotLength+t.rackStructuralLength,h=t.rackSlotDepth+t.rackStructuralDepth,slots=item.slots.filter(v=>v.bay===b+1),allocations=slots.filter(v=>v.status==='ALLOCATED').map(v=>({pn:v.pn,level:v.level,position:v.position,length:v.length,depth:v.depth,quantity:1,slotId:v.id,status:v.status}));
      return {id:'installed:'+item.id+':'+(b+1),kind:'rack',existing:true,locked:true,frame:item.frame,x:item.x+b*w,y:item.y,w,h,objects:[{id:'installed-bay:'+item.id+':'+(b+1),kind:'rack',existing:true,dx:0,dy:0,w,h,bayNumber:b+1,typeId:t.id,typeName:t.name,levels:t.rackLevels,structuralLength:t.rackStructuralLength,structuralDepth:t.rackStructuralDepth,allocations,pallets:allocations.length,rotation:0,slots}]};
    }));
  }
  function summary(layout,plan,settings){
    plan=scope.LogEnManualLayout?.placementPlan(layout,plan,settings)||plan;
    const slots=layout.infrastructure.filter(v=>v.kind==='existing-rack').flatMap(v=>v.slots),ground=layout.groups.filter(g=>g.kind==='ground'),existingGround=ground.filter(g=>g.existing),newGroups=layout.groups.filter(g=>!g.existing),assigned=new Map();
    for(const g of layout.groups)for(const o of g.objects){if(o.kind==='rack')for(const a of o.allocations)assigned.set(a.pn,(assigned.get(a.pn)||0)+(a.quantity||1));else assigned.set(o.pn,(assigned.get(o.pn)||0)+o.quantity);}
    const rows=plan.rows.map(r=>{const placed=assigned.get(r.input.partNumber)||0,missing=r.required===null?null:Math.max(0,r.required-placed),target=layout.targets[r.input.partNumber]||'ground',floor=D.calculatePart(r.input,settings,missing||0).floor,rack=D.calculatePart(r.input,settings,missing||0).rack;return {pn:r.input.partNumber,required:r.required,placed,missingPallets:missing,storage:target,areaWithoutGangways:missing?(target==='rack'?rack?.withoutGangways:floor?.withoutGangways)||0:0,areaKnown:missing!==null&&(!missing||!!(target==='rack'?rack:floor)),reason:r.required===null?r.errors.join(' '):missing?'Existing storage capacity is insufficient. Additional storage positions are required.':''};});
    const shortage={rows:rows.filter(v=>v.missingPallets===null||v.missingPallets>0)};Object.assign(shortage,{partNumbers:shortage.rows.length,pallets:shortage.rows.reduce((n,r)=>n+(r.missingPallets||0),0),rackPallets:shortage.rows.filter(r=>r.storage==='rack').reduce((n,r)=>n+(r.missingPallets||0),0),groundPallets:shortage.rows.filter(r=>r.storage==='ground').reduce((n,r)=>n+(r.missingPallets||0),0),areaWithoutGangways:shortage.rows.reduce((n,r)=>n+r.areaWithoutGangways,0),unknownQuantityPartNumbers:shortage.rows.filter(r=>r.missingPallets===null).length,unknownAreaPartNumbers:shortage.rows.filter(r=>!r.areaKnown).length});
    // Use original infrastructure polygons and actual new reservations, never occupied pallets as free space.
    const footprints=G.union([...layout.infrastructure.filter(v=>v.kind!=='gangway').map(v=>G.path(v.points)),...newGroups.flatMap(g=>g.kind==='rack'?O.placedObjects(g).map(o=>G.path(o.points)):[G.path(L.corners({x:g.x,y:g.y,w:g.w,h:g.h}).map(v=>O.toWorld(v,g.frame)))])]);
    const occupied=area(footprints),free=area(G.diff(layout.boundary,G.union([...footprints,...layout.blocked,...layout.aisles.map(a=>G.path(a.points))])));
    const sum=(groups,kind)=>groups.flatMap(g=>g.objects).reduce((n,o)=>n+(o.kind===kind?(kind==='rack'?o.allocations.length:1):0),0),required=plan.rows.reduce((n,r)=>n+(r.required||0),0),allocated=rows.reduce((n,r)=>n+Math.min(r.placed,r.required||0),0);
    const stats={existingRackCapacity:slots.length,existingRackAllocated:slots.filter(v=>v.status==='ALLOCATED').length,existingRackRemaining:slots.filter(v=>v.status==='EMPTY').length,existingRackReserved:slots.filter(v=>v.status==='RESERVED'||v.status==='UNAVAILABLE').length,existingGroundCapacity:layout.groundCapacity,existingGroundAllocated:sum(existingGround,'ground'),existingGroundRemaining:Math.max(0,layout.groundCapacity-sum(existingGround,'ground')-layout.groundReserved),newRackPositions:sum(newGroups,'rack'),newGroundPositions:sum(newGroups,'ground'),required,allocated,unallocated:Math.max(0,required-allocated),occupiedFootprint:occupied,remainingUsableFloor:free};
    return {shortage,stats,generatedRack:sum(layout.groups,'rack'),generatedGround:sum(layout.groups,'ground'),unplacedRack:shortage.rackPallets,unplacedGround:shortage.groundPallets,affected:shortage.rows.map(r=>({pn:r.pn,message:(r.missingPallets??'Unknown')+' unallocated pallets · '+r.storage})),validationErrors:layout.issues,accessValid:!layout.issues.length,complete:!shortage.rows.length&&!layout.issues.length,safetyVerified:!!layout.options.geometryReviewed&&!!layout.options.constraintsConfirmed&&!layout.geometryUnverified&&!layout.geometryAnalysis?.warnings.length,accommodatedPallets:allocated,requiredPallets:required,metrics:{newGangwayArea:area(G.union(layout.aisles.filter(a=>!a.existing).map(a=>G.path(a.points)))),placedStorageArea:occupied,remainingUnoccupiedArea:free,grossIdentifiedArea:layout.geometryAnalysis?.grossArea,excludedArea:layout.geometryAnalysis?.excludedArea,netStorageEligibleArea:layout.geometryAnalysis?.netArea,detectedRegions:layout.geometryAnalysis?.regionCount,totalWarehouseArea:area(layout.boundary),rackFootprint:area(G.union(layout.infrastructure.filter(v=>v.kind==='existing-rack').map(v=>G.path(v.points)))),groundFootprint:area(G.union(layout.infrastructure.filter(v=>v.kind==='existing-ground').map(v=>G.path(v.points)))),unusedUsableArea:free,gangwayArea:area(G.union(layout.aisles.map(v=>G.path(v.points)))),occupiedFootprint:occupied}};
  }
  async function generate(plan,settings,geometry,options,onProgress=()=>{}){
    const boundaryEntity=geometry.entities.find(e=>e.id===options.boundaryId);L.environment(geometry,options);
    const analysis=scope.LogEnWarehouseGeometry&&geometry.interpretationVersion?scope.LogEnWarehouseGeometry.analyze(geometry,options,settings):null;
    const boundary=analysis?.warehouse||[G.path(boundaryEntity.points.map(p=>p.map(n=>n*options.scale)))],info=infrastructure(geometry,settings,options),items=info.items,issues=info.issues,groups=[],targets={},remaining=new Map(),existingRack=items.filter(v=>v.kind==='existing-rack'),zones=items.filter(v=>v.kind==='existing-ground'),aisles=items.filter(v=>v.kind==='gangway').map(v=>({id:'existing-aisle:'+v.id,kind:'aisle',existing:true,points:v.points,...bounded(v.points)}));
    const restricted=geometry.entities.filter(e=>e.id!==options.boundaryId&&!['reference','existing-rack','existing-ground','gangway'].includes(role(e,options)));
    const blocked=analysis?G.union([...analysis.noStorage,...analysis.physical,...G.diff(analysis.warehouse,analysis.gross)]):G.union([...restricted.flatMap(e=>{const pts=e.closed?e.points:L.corners({x:e.bounds[0],y:e.bounds[1],w:Math.max(.1,e.bounds[2]-e.bounds[0]),h:Math.max(.1,e.bounds[3]-e.bounds[1])});return G.offset([G.path(pts.map(p=>p.map(n=>n*options.scale)))],role(e,options)==='door'?Math.max(settings.gangwayWidth,options.obstacleClearance||0):Math.max(0,options.obstacleClearance||0));}),...(options.manualObstacles||[]).map(polygon)]);
    for(const item of items)if(G.area(G.diff([G.path(item.points)],boundary))>E||overlap([G.path(item.points)],item.kind==='gangway'&&analysis?analysis.movementBlocked:blocked))issues.push({pn:item.id,message:'Existing storage/access overlaps a restricted object or leaves the boundary. Review drawing roles.'});
    for(let i=0;i<items.length;i++)for(let j=0;j<i;j++)if(overlap([G.path(items[i].points)],[G.path(items[j].points)]))issues.push({pn:items[i].id,message:'Existing infrastructure overlaps '+items[j].id+'. Classify only outer storage outlines; preserve frame details as reference.'});
    const accessPaths=items.filter(v=>v.kind==='gangway').map(v=>G.path(v.points));
    if(accessPaths.length>1){const visited=new Set([0]);let changed=true;while(changed){changed=false;for(let i=0;i<accessPaths.length;i++)if(!visited.has(i)&&[...visited].some(j=>overlap(G.offset([accessPaths[i]],1),[accessPaths[j]]))){visited.add(i);changed=true;}}if(visited.size!==accessPaths.length)issues.push({pn:'Existing gangways',message:'Existing gangways are disconnected. Classify their connecting access outlines before allocation/export.'});}
    for(const item of items.filter(v=>v.kind!=='gangway')){item.accessible=accessPaths.length>0&&overlap(G.offset([G.path(item.points)],1),accessPaths);if(!item.accessible){issues.push({pn:item.id,message:'Classify an adjacent existing gangway before allocating this storage. Empty infrastructure remains fixed and is not free floor space.'});if(item.slots)for(const slot of item.slots)if(slot.status==='EMPTY')slot.status='UNAVAILABLE';}}
    for(const r of plan.rows)remaining.set(r.input.partNumber,r.required||0);
    for(const slot of existingRack.flatMap(v=>v.slots))if(slot.status==='ALLOCATED'&&slot.pn)remaining.set(slot.pn,Math.max(0,(remaining.get(slot.pn)||0)-1));
    for(const r of plan.rows)if(r.required!==null&&![r.input.length,r.input.width,r.input.height].every(v=>Number.isFinite(v)&&v>0))issues.push({pn:r.input.partNumber,message:'Invalid pallet dimensions; existing storage allocation requires positive L, W and H.'});
    const rows=[...plan.rows].filter(r=>r.required===null||[r.input.length,r.input.width,r.input.height].every(v=>Number.isFinite(v)&&v>0)).sort((a,b)=>(a.required??Infinity)-(b.required??Infinity)||a.input.partNumber.localeCompare(b.input.partNumber));
    const savedGroundPNs=new Set();for(const zone of zones)for(const saved of zone.config.occupancy||[])if(saved.status==='ALLOCATED'&&saved.pn){savedGroundPNs.add(saved.pn);remaining.set(saved.pn,Math.max(0,(remaining.get(saved.pn)||0)-(saved.quantity||1)));}
    if(options.storageMode==='auto'&&plan.assignmentSource==='improve-warehouse')for(const r of rows){
      const pn=r.input.partNumber,wantsRack=r.storageType==='Rack storage',savedRack=existingRack.some(v=>v.slots.some(s=>s.status==='ALLOCATED'&&s.pn===pn));
      if((wantsRack&&savedGroundPNs.has(pn))||(!wantsRack&&savedRack))issues.push({pn,message:'Saved occupancy conflicts with the Overview → Improve Warehouse assignment. Review existing occupancy or select Manual per-part assignments before saving/exporting this layout.'});
    }
    for(const r of rows){
      if(r.required===null){issues.push({pn:r.input.partNumber,message:r.errors.join(' ')});continue;}
      const pn=r.input.partNumber,fromOverview=options.storageMode==='auto'&&plan.assignmentSource==='improve-warehouse',mode=fromOverview?(r.storageType==='Rack storage'?'rack':'ground'):options.storageOverrides?.[pn]||(options.storageMode==='rack'?'rack':options.storageMode==='ground'?'ground':'auto'),n=remaining.get(pn)||0;
      targets[pn]=mode==='ground'||savedGroundPNs.has(pn)?'ground':'rack';if(targets[pn]==='ground')continue;
      const possible=existingRack.flatMap(item=>item.slots.filter(slot=>slot.status==='EMPTY').map(slot=>({item,slot,fit:slotFit(r.input,item,slot)})).filter(v=>v.fit));
      if(possible.length>=n||mode==='rack'||(options.allowNewStorageConstruction&&possible.length>0)){const allocated=Math.min(n,possible.length);for(const {slot,fit}of possible.slice(0,allocated))Object.assign(slot,fit,{status:'ALLOCATED',pn});remaining.set(pn,n-allocated);}else if(mode==='auto'&&!existingRack.some(v=>v.slots.some(s=>s.status==='ALLOCATED'&&s.pn===pn)))targets[pn]='ground';
    }
    groups.push(...rackGroups(items));
    let groundCapacity=0,groundReserved=0;
    for(const zone of zones){
      const reserved=(zone.config.occupancy||[]).filter(v=>v.status!=='EMPTY'),placed=[];
      for(const saved of reserved){if(saved.status!=='ALLOCATED'||!saved.pn)continue;const r=rows.find(r=>r.input.partNumber===saved.pn),qty=saved.quantity||1;if(!r||![saved.x,saved.y,saved.w,saved.h].every(Number.isFinite)||!L.core.contained(saved,zone.local)){issues.push({pn:saved.pn,message:'Saved ground occupancy is invalid or outside its zone.'});continue;}const g={id:'saved-ground:'+zone.id+':'+saved.id,kind:'ground',existing:true,locked:true,zoneId:zone.id,frame:zone.frame,x:saved.x,y:saved.y,w:saved.w,h:saved.h,objects:[{...r.input,id:'saved-position:'+saved.id,kind:'ground',existing:true,pn:saved.pn,dx:0,dy:0,w:saved.w,h:saved.h,quantity:qty,stacking:saved.stacking||1,rotation:0,position:saved.id}]};groups.push(g);targets[saved.pn]='ground';}
      const allocatable=zone.status==='EMPTY'&&zone.accessible;
      for(const r of rows){if(!allocatable||targets[r.input.partNumber]!=='ground'||!(remaining.get(r.input.partNumber)>0))continue;
        const rowSettings={...settings,maxFloorRowDepth:Math.min(settings.maxFloorRowDepth||Infinity,zone.h)},needed=remaining.get(r.input.partNumber),f=D.calculatePart(r.input,rowSettings,needed).floor;if(!f)continue;
        const source=L.makeObjects({rows:[{input:r.input,required:needed,rackPallets:0,groundPallets:needed,ground:f,errors:[]}],rack:{available:true}},rowSettings);
        for(const g of source.groups){
          let result=null;const xs=[zone.x,...placed.map(v=>v.x+v.w)],ys=[zone.y,...placed.map(v=>v.y+v.h+settings.gangwayWidth)];
          search:for(const y of ys)for(const x of xs){const box={x,y,w:g.w,h:g.h},pts=L.corners(box);if(!L.core.contained(box,zone.local)||placed.some(v=>L.core.overlaps(v,box))||reserved.some(v=>L.core.overlaps(v,box)))continue;result={...g,id:'existing-ground:'+zone.id+':'+g.id,existing:true,locked:true,zoneId:zone.id,frame:zone.frame,x,y};break search;}
          if(result){result.objects=result.objects.map(o=>({...o,id:zone.id+':'+o.id,existing:true}));groups.push(result);placed.push(result);remaining.set(r.input.partNumber,remaining.get(r.input.partNumber)-result.objects.reduce((n,o)=>n+o.quantity,0));}
        }
      }
      // Capacity is PN/dimension-dependent. Count a deterministic reference pallet grid in the actual polygon.
      const reference=rows.find(r=>r.required>0&&D.calculatePart(r.input,{...settings,maxFloorRowDepth:Math.min(settings.maxFloorRowDepth||Infinity,zone.h)},1).floor),f=reference&&D.calculatePart(reference.input,{...settings,maxFloorRowDepth:Math.min(settings.maxFloorRowDepth||Infinity,zone.h)},1).floor;
      let capacity=0;if(f){for(let y=zone.y;y+f.floorLength<=zone.y+zone.h+E;y+=f.floorLength)for(let x=zone.x;x+f.floorWidth<=zone.x+zone.w+E;x+=f.floorWidth)if(L.core.contained({x,y,w:f.floorWidth,h:f.floorLength},zone.local))capacity++;zone.capacityReference=reference.input.partNumber;}
      zone.capacity=Math.max(capacity,placed.reduce((n,g)=>n+g.objects.length,0));groundCapacity+=zone.capacity;groundReserved+=allocatable?reserved.length:zone.capacity;
    }
    const layout={version:3,orientation:options.warehouseOrientation||'auto',groups,unplaced:[],infrastructure:items,boundary,blocked,aisles,clearances:[],options:{...options},issues,targets,groundCapacity,groundReserved,geometryAnalysis:analysis?{regionCount:analysis.regionCount,grossArea:analysis.grossArea,excludedArea:analysis.excludedArea,netArea:analysis.netArea,warnings:analysis.warnings}:null,geometryUnverified:geometry.unreadableEntities||0,env:{poly:boundaryEntity.points.map(p=>p.map(n=>n*options.scale)),box:L.bounds(boundaryEntity.points.map(p=>p.map(n=>n*options.scale)))},rackRequired:rows.filter(r=>targets[r.input.partNumber]==='rack').reduce((n,r)=>n+(r.required||0),0),groundRequired:rows.filter(r=>targets[r.input.partNumber]==='ground').reduce((n,r)=>n+(r.required||0),0)};
    if(options.allowNewStorageConstruction&&[...remaining.values()].some(n=>n>0)&&!issues.length){
      const residualRows=rows.filter(r=>(remaining.get(r.input.partNumber)||0)>0).map(r=>{const n=remaining.get(r.input.partNumber),rack=targets[r.input.partNumber]==='rack',value=D.calculatePart(r.input,settings,n);return {...r,required:n,rackPallets:rack?n:0,groundPallets:rack?0:n,ground:rack?null:value.floor,errors:[]};});
      const rackParts=residualRows.filter(r=>r.rackPallets).map(r=>({...r.input,consumptionPerShift:r.required*r.input.qtyBox*r.input.qtyOnPallet, doh:1})),rackSettings={...settings,shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1},rack=D.calculateProject(rackParts,rackSettings).sharedRack;
      const residual={available:true,rows:residualRows,rack:rack||{available:true,bayLayouts:[]}},source=L.makeObjects(residual,settings),frame={angle:O.buildingAngle(layout.env.poly)+(options.warehouseOrientation==='vertical'?Math.PI/2:0),sx:1,sy:1},poly=layout.env.poly.map(p=>O.toLocal(p,frame)),box=L.bounds(poly),g=settings.gangwayWidth;
      const fixed=G.union([...blocked,...items.filter(v=>v.kind!=='gangway').map(v=>G.path(v.points))]),movementFixed=G.union([...(analysis?.movementBlocked||blocked),...items.filter(v=>v.kind!=='gangway').map(v=>G.path(v.points))]),added=[];
      const groupsToPlace=[];for(let i=0;i<source.groups.length;i++){const a=source.groups[i],b=source.groups[i+1];if(a.kind==='rack'&&b?.kind==='rack'&&a.typeId===b.typeId){const gap=options.backToBackSeparation||0;groupsToPlace.push({...a,id:'pair:'+a.id,w:Math.max(a.w,b.w),h:a.h+gap+b.h,paired:true,objects:[...a.objects,...b.objects.map(o=>({...o,dy:o.dy+a.h+gap}))]});i++;}else groupsToPlace.push(a);} if(groupsToPlace.length>10000)throw new Error('Additional layout exceeds 10,000 rows/runs. Select a category.');for(let i=0;i<groupsToPlace.length;i++){onProgress(i+1,groupsToPlace.length);const block=groupsToPlace[i];let placed=null;
        const existingBounds=items.map(v=>bounded(v.points.map(p=>O.toLocal(p,frame)))).concat(added.map(v=>({x:v.x,y:v.y,w:v.w,h:v.h}))),xs=[box.minX+g,...existingBounds.flatMap(v=>[v.x+v.w+g,v.x-block.w-g])],ys=[box.minY+g,...existingBounds.flatMap(v=>[v.y+v.h+g,v.y-block.h-g])];
        search:for(const y of ys)for(const x of xs){const trial={...block,id:'new:'+block.id,frame,x,y},world=L.corners({x,y,w:block.w,h:block.h}).map(p=>O.toWorld(p,frame)),path=G.path(world);if(G.area(G.diff([path],boundary))>E||overlap([path],fixed)||aisles.some(a=>overlap([path],[G.path(a.points)]))||added.some(v=>L.core.overlaps(v,{x,y,w:block.w,h:block.h})))continue;
          const face={x,y:y-g,w:block.w,h:g},facePath=G.path(L.corners(face).map(p=>O.toWorld(p,frame)));if(G.area(G.diff([facePath],boundary))>E||overlap([facePath],movementFixed)||added.some(v=>L.core.overlaps(v,face)))continue;
          const extraFaces=block.paired?[{x,y:y+block.h,w:block.w,h:g},{x:x-g,y:y-g,w:g,h:block.h+2*g}]:[];
          if(extraFaces.some(r=>{const p=G.path(L.corners(r).map(v=>O.toWorld(v,frame)));return G.area(G.diff([p],boundary))>E||overlap([p],movementFixed)||added.some(v=>L.core.overlaps(v,r));}))continue;
          // Connect each new front to an existing gangway or an already connected new front.
          const anchors=aisles.map(a=>bounded(a.points.map(p=>O.toLocal(p,frame))));if(!anchors.length)anchors.push({x:box.minX,y:box.minY+g/2,w:g,h:Math.max(g,box.maxY-box.minY-g)});
          let routes=null;for(const a of anchors){const ax=a.x+a.w/2,ay=a.y+a.h/2,fx=x+block.w/2,fy=y-g/2;for(const horizontalFirst of [true,false]){const turn=horizontalFirst?[ax,fy]:[fx,ay],segments=[[fx,fy,...turn],[...turn,ax,ay]].map(([x1,y1,x2,y2])=>({x:Math.min(x1,x2)-g/2,y:Math.min(y1,y2)-g/2,w:Math.abs(x2-x1)+g,h:Math.abs(y2-y1)+g})),paths=segments.map(v=>G.path(L.corners(v).map(p=>O.toWorld(p,frame))));if(paths.every(p=>G.area(G.diff([p],boundary))<E&&!overlap([p],movementFixed)&&!overlap([p],[path])&&!added.some(v=>overlap([p],[G.path(L.corners(v).map(p=>O.toWorld(p,frame)))])))){routes=[face,...extraFaces,...segments];break;}}if(routes)break;}
          if(!routes)continue;trial.objects=trial.objects.map(o=>({...o,id:'new:'+o.id}));placed=trial;for(const [j,r]of routes.entries())aisles.push({id:'new-aisle:'+block.id+':'+j,kind:'aisle',points:L.corners(r).map(p=>O.toWorld(p,frame)),...bounded(L.corners(r).map(p=>O.toWorld(p,frame)))});break search;
        }
        if(placed){groups.push(placed);added.push({x:placed.x,y:placed.y,w:placed.w,h:placed.h});}else layout.unplaced.push(block);if(i%20===0)await new Promise(r=>setTimeout(r,0));
      }
    }
    Object.assign(layout,summary(layout,plan,settings));return {layout,alternatives:null,winner:'existing'};
  }
  function cadObjects(layout){const list=[];for(const g of layout.groups)for(const o of O.placedObjects(g)){if(g.existing){const text=o.kind==='rack'?o.allocations.map(a=>a.pn+' · L'+a.level+' P'+a.position).join('; '):'PN: '+o.pn+' · QTY: '+o.quantity;list.push({...o,kind:'annotation',existing:true,label:text||'EMPTY',id:'occupancy:'+o.id});}else list.push({...o,newConstruction:true});}return list;}
  function move(layout,id,x,y,rotated,plan,settings){
    const group=layout.groups.find(g=>g.id===id);if(!group||group.existing)throw new Error('Existing infrastructure stays at its original position. Change its occupancy or regenerate optional additions.');
    if(!!rotated!==!!group.rotated||![x,y].every(Number.isFinite))throw new Error('Use finite coordinates and preserve the generated rack/row orientation.');
    const [lx,ly]=O.toLocal([x,y],group.frame),trial={...group,x:lx,y:ly},storage=G.path(L.corners({x:lx,y:ly,w:group.w,h:group.h}).map(v=>O.toWorld(v,group.frame))),access=G.union(layout.aisles.map(a=>G.path(a.points))),fixed=G.union([...layout.blocked,...layout.infrastructure.filter(v=>v.kind!=='gangway').map(v=>G.path(v.points)),...layout.groups.filter(g=>g.id!==id&&!g.existing).map(g=>G.path(L.corners({x:g.x,y:g.y,w:g.w,h:g.h}).map(v=>O.toWorld(v,g.frame))))]);
    if(G.area(G.diff([storage],layout.boundary))>E||overlap([storage],fixed)||overlap([storage],access))throw new Error('The adjustment crosses original infrastructure, a reserved aisle or the warehouse boundary.');
    const faces=[{x:lx,y:ly-settings.gangwayWidth,w:group.w,h:settings.gangwayWidth},...(group.paired?[{x:lx,y:ly+group.h,w:group.w,h:settings.gangwayWidth}]:[])];if(faces.some(r=>G.area(G.diff([G.path(L.corners(r).map(v=>O.toWorld(v,group.frame)))],access))>E))throw new Error('Keep each accessible face beside an existing full-width gangway, or regenerate the additions.');
    Object.assign(group,trial);Object.assign(layout,summary(layout,plan,settings));return layout;
  }
  scope.LogEnExistingLayout=Object.freeze({generate,infrastructure,summary,cadObjects,move});
})(globalThis);
