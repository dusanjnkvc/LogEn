/* Manual edits use the same millimetre model as CAD export and the 3D viewer. */
(function(scope){
 'use strict';
 const L=scope.LogEnLayout,O=()=>scope.LogEnOptimizer,clone=v=>JSON.parse(JSON.stringify(v));
 const origin=g=>g.frame?O().toWorld([g.x,g.y],g.frame):[g.x,g.y];
 const box=g=>L.bounds(L.placedObjects(g).flatMap(o=>o.points||L.corners(o)));
 function splitGroundRow(layout,g,objectId){
  let rows=g.groundRows?.map(row=>({...row,objectIds:row.objectIds||g.objects.filter(o=>o.groundRowId===row.id).map(o=>o.id)}));
  if(!rows?.length){const groups=new Map();for(const o of g.objects){const key=o.groundRowId||`${o.groundFace||'front'}:${o.dx}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);}rows=[...groups].map(([id,list])=>{const x=Math.min(...list.map(o=>o.dx)),y=Math.min(...list.map(o=>o.dy));return {id,x,y,w:Math.max(...list.map(o=>o.dx+o.w))-x,h:Math.max(...list.map(o=>o.dy+o.h))-y,side:list[0].groundFace||'front',objectIds:list.map(o=>o.id)};});}
  // Older saved layouts may label an entire PN grid as one row. Partition it
  // by physical frontage position so a row always means one line of boxes.
  const columns=list=>{const buckets=[];for(const o of [...list].sort((a,b)=>a.dx-b.dx||a.dy-b.dy)){let b=buckets.find(b=>Math.abs(b[0].dx-o.dx)<=.11);if(!b){b=[];buckets.push(b);}b.push(o);}return buckets;};
  let coverage=rows.flatMap(row=>row.objectIds);
  if(new Set(coverage).size!==g.objects.length||coverage.length!==g.objects.length){rows=[];const faces=new Map();for(const o of g.objects){const face=o.groundFace||'front';if(!faces.has(face))faces.set(face,[]);faces.get(face).push(o);}for(const [side,list]of faces)for(const items of columns(list)){const x=Math.min(...items.map(o=>o.dx)),y=Math.min(...items.map(o=>o.dy));rows.push({id:'line:'+items[0].id,x,y,w:Math.max(...items.map(o=>o.dx+o.w))-x,h:Math.max(...items.map(o=>o.dy+o.h))-y,side,objectIds:items.map(o=>o.id)});}}
  rows=rows.flatMap(row=>{const items=g.objects.filter(o=>row.objectIds.includes(o.id)),parts=columns(items);if(parts.length<2)return [row];const margin=Math.max(0,Math.min(...items.map(o=>o.dx))-row.x);return parts.map(list=>{const x=Math.min(...list.map(o=>o.dx))-margin,y=Math.min(...list.map(o=>o.dy))-margin;return {...row,id:row.id+':line:'+list[0].id,x,y,w:Math.max(...list.map(o=>o.dx+o.w))-x+margin,h:Math.max(...list.map(o=>o.dy+o.h))-y+margin,objectIds:list.map(o=>o.id)};});});
  if(rows.length<2)return g.id;
  const parts=rows.map(row=>{const n=clone(g);n.id=g.id+':row:'+row.id;n.manualRow=true;n.manualRowFace=row.side;n.groundLane=false;n.paired=false;n.reservedBackRow=false;n.rows=1;
   n.x=g.x+(g.rotated?g.h-row.y-row.h:row.x);n.y=g.y+(g.rotated?row.x:row.y);n.w=row.w;n.h=row.h;
   n.objects=g.objects.filter(o=>row.objectIds.includes(o.id)).map(o=>({...clone(o),dx:o.dx-row.x,dy:o.dy-row.y}));n.groundRows=[{...clone(row),x:0,y:0}];delete n.centerLine;delete n.backY;
   return n;});
  const index=layout.groups.indexOf(g);layout.groups.splice(index,1,...parts);layout.manualEdited=true;return parts.find(n=>n.objects.some(o=>o.id===objectId)).id;
 }
 function split(layout,objectId){
  const g=layout.groups.find(g=>g.objects.some(o=>o.id===objectId));if(!g||g.existing)return g?.id;
  // Ground selection isolates one complete row, never an individual box.
  if(g.kind==='ground')return splitGroundRow(layout,g,objectId);
  if(g.objects.length===1)return g.id;
  const o=g.objects.find(o=>o.id===objectId),n=clone(g);n.id='manual:'+o.id;
  // Retain the physical footprint even when the parent was rotated.
  const dx=g.rotated?g.h-o.dy-o.h:o.dx,dy=g.rotated?o.dx:o.dy;
  n.x=g.x+dx;n.y=g.y+dy;n.w=g.rotated?o.h:o.w;n.h=g.rotated?o.w:o.h;
  n.w=o.w;n.h=o.h;n.rotated=!!g.rotated;n.objects=[{...clone(o),dx:0,dy:0}];
  n.paired=false;n.groundLane=false;delete n.groundRows;g.objects=g.objects.filter(v=>v.id!==o.id);
  const minX=Math.min(...g.objects.map(o=>o.dx)),minY=Math.min(...g.objects.map(o=>o.dy)),maxX=Math.max(...g.objects.map(o=>o.dx+o.w)),maxY=Math.max(...g.objects.map(o=>o.dy+o.h));
  const oldHeight=g.h;g.x+=g.rotated?oldHeight-maxY:minX;g.y+=g.rotated?minX:minY;g.w=maxX-minX;g.h=maxY-minY;for(const remaining of g.objects){remaining.dx-=minX;remaining.dy-=minY;}delete g.groundRows;
  layout.groups.push(n);return n.id;
 }
 function translate(layout,ids,dx,dy){for(const g of layout.groups.filter(g=>ids.includes(g.id)&&!g.existing)){const p=origin(g),v=g.frame?O().toLocal([p[0]+dx,p[1]+dy],g.frame):[p[0]+dx,p[1]+dy];if(g.wallSide&&Math.abs((g.wallSide==='left'||g.wallSide==='right')?v[0]-g.x:v[1]-g.y)>.11)g.wallSide=null;g.x=v[0];g.y=v[1];}layout.manualEdited=true;}
 function rotate(layout,ids){for(const g of layout.groups.filter(g=>ids.includes(g.id)&&!g.existing)){
  g.rotated=!g.rotated;g.wallSide=null;
 }layout.manualEdited=true;}
 function moveAssignment(layout,objectId,index,dx,dy){const g=layout.groups.find(g=>g.objects.some(o=>o.id===objectId));if(!g||g.existing)return;const o=g.objects.find(o=>o.id===objectId),a=o.allocations[index];if(!a)return;const v=g.frame?O().toLocal([dx,dy],g.frame):[dx,dy];a.x=(a.x||0)+(g.rotated?v[1]:v[0]);a.y=(a.y||0)+(g.rotated?-v[0]:v[1]);layout.manualEdited=true;
  // Invalidate cached empty shelf rectangles after changing their occupied footprint.
  if(o.shelves)for(const sh of o.shelves)if(sh.level===a.level)sh.free=[];
 }
 function duplicate(layout,ids,offset){const added=[];for(const g of layout.groups.filter(g=>ids.includes(g.id)&&!g.existing)){const n=clone(g),suffix=':copy:'+Date.now()+':'+added.length;n.id+=suffix;for(const o of n.objects){o.id+=suffix;o.manualEmpty=true;o.allocations=[];o.shelves=[];o.quantity=0;o.pallets=0;}n.x+=offset;n.y+=offset;layout.groups.push(n);added.push(n.id);}layout.manualEdited=true;return added;}
 function remove(layout,ids){const removed=layout.groups.filter(g=>ids.includes(g.id)&&!g.existing);layout.groups=layout.groups.filter(g=>!removed.includes(g));for(const g of removed)if(g.objects.some(o=>(o.allocations||[]).length||o.quantity>0))layout.unplaced.push(g);layout.manualEdited=true;}
 function snap(layout,ids,dx,dy,settings,tolerance,grid=100){
  const moving=layout.groups.filter(g=>ids.includes(g.id));if(!moving.length)return {dx,dy,guides:[]};
  const b=box(moving[0]),xs=[],ys=[],g=settings.gangwayWidth;
  const edgeTargets={minX:[],maxX:[],minY:[],maxY:[]};
  for(const other of layout.groups.filter(g=>!ids.includes(g.id))){const a=box(other),clearance=moving.some(v=>v.kind==='ground')||other.kind==='ground'?(settings.floorPalletClearance||0):0;
   edgeTargets.minX.push(a.maxX+clearance);edgeTargets.maxX.push(a.minX-clearance);edgeTargets.minY.push(a.maxY+clearance);edgeTargets.maxY.push(a.minY-clearance);
   xs.push(a.minX-g,a.maxX+g);ys.push(a.minY-g,a.maxY+g);
   // Alignment along a shared row is independent of the required separation at its ends.
   edgeTargets.minX.push(a.minX);edgeTargets.maxX.push(a.maxX);edgeTargets.minY.push(a.minY);edgeTargets.maxY.push(a.maxY);
  }
  for(const zone of (moving.some(v=>v.kind==='ground')?[]:[...(layout.clearances||[]),...(layout.aisles||[])])){const pts=zone.points;if(pts){const a=L.bounds(pts);xs.push(a.minX,a.maxX);ys.push(a.minY,a.maxY);}}
  const eb=layout.env.box,margin=layout.options.allowWallStorage&&moving.every(v=>v.wallSide)?(layout.options.wallClearance||0):Math.max(g,layout.options.wallClearance||0);
  if(eb){const p=layout.env.frame?O().toWorld([eb.minX+margin,eb.minY+margin],layout.env.frame):[eb.minX+margin,eb.minY+margin],q=layout.env.frame?O().toWorld([eb.maxX-margin,eb.maxY-margin],layout.env.frame):[eb.maxX-margin,eb.maxY-margin];xs.push(p[0],q[0]);ys.push(p[1],q[1]);}
  const nearest=(targets,edges)=>{let best=null;for(const target of targets)for(const edge of edges){const delta=target-edge;if(Math.abs(delta)<=tolerance&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,target};}return best;};
  const choose=(a,b)=>!a?b:!b?a:Math.abs(a.delta)<Math.abs(b.delta)?a:b;
  const sx=choose(nearest(xs,[b.minX+dx,b.maxX+dx]),choose(nearest(edgeTargets.minX,[b.minX+dx]),nearest(edgeTargets.maxX,[b.maxX+dx]))),sy=choose(nearest(ys,[b.minY+dy,b.maxY+dy]),choose(nearest(edgeTargets.minY,[b.minY+dy]),nearest(edgeTargets.maxY,[b.maxY+dy]))),guides=[];
  if(sx){dx+=sx.delta;guides.push({axis:'x',value:sx.target});}else dx=Math.round((b.minX+dx)/grid)*grid-b.minX;
  if(sy){dy+=sy.delta;guides.push({axis:'y',value:sy.target});}else dy=Math.round((b.minY+dy)/grid)*grid-b.minY;
  return {dx,dy,guides};
 }
 function validate(layout,plan,settings,geometry){
  // Re-check saved wall attachments too: older manual moves retained wallSide after leaving the wall.
  for(const g of layout.groups.filter(g=>g.kind==='ground'&&g.manualRow&&g.wallSide&&!g.existing)){
   const e=layout.env,b=e.wallBox||e.box;if(!b)continue;const r={x:g.x,y:g.y,w:g.rotated?g.h:g.w,h:g.rotated?g.w:g.h},c=layout.options.wallClearance||0,max=c+(e.analysis?(e.optionsObstacleClearance||0):0),distance=g.wallSide==='left'?r.x-b.minX:g.wallSide==='right'?b.maxX-r.x-r.w:g.wallSide==='bottom'?r.y-b.minY:b.maxY-r.y-r.h;
   if(!layout.options.allowWallStorage||distance<c-.11||distance>max+.11){g.wallSide=null;layout.manualEdited=true;}
  }
  const result=L.validate(layout,plan,settings);Object.assign(layout,result);
  const errors=[],warnings=[],add=(groupId,message,details={})=>errors.push({groupId,pn:groupId,message,...details});
  const objects=layout.groups.flatMap(g=>L.placedObjects(g).map(o=>({g,o,b:L.bounds(o.points||L.corners(o))})));
  for(const {g,o,b} of objects){
   const rect={x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY};
   for(const e of geometry?.entities||[]){const role=scope.LogEnWarehouseGeometry.role(e,layout.options);if(!['pillar','wall','door','pedestrian','restricted'].includes(role))continue;
    const poly=e.points.map(p=>p.map(v=>v*layout.options.scale)),eb=L.bounds(poly),overlapX=Math.min(b.maxX,eb.maxX)-Math.max(b.minX,eb.minX),overlapY=Math.min(b.maxY,eb.maxY)-Math.max(b.minY,eb.minY);
    if(overlapX>0.1&&overlapY>0.1&&O().geometry.area(O().geometry.intersect([O().geometry.path(poly)],[O().geometry.path(o.points||L.corners(rect))]))>.1)add(g.id,`${o.id} overlaps ${role} ${e.id}: bounding overlap ${Math.round(overlapX)} × ${Math.round(overlapY)} mm.`);
   }
   const t=scope.LogEnDomain.configuredRackTypes(settings).find(t=>t.id===o.typeId)||settings;
   for(const a of o.allocations||[]){if(a.length>t.rackSlotLength+.1||a.depth>t.rackSlotDepth+.1||a.height>t.rackSlotHeight+.1||(a.x||0)<-.1||(a.y||0)<-.1||(a.x||0)+a.length>t.rackSlotLength+.1||(a.y||0)+a.depth>t.rackSlotDepth+.1)add(g.id,`${a.pn} at ${Math.round(a.x||0)}, ${Math.round(a.y||0)} mm: pallet ${a.length} × ${a.depth} × ${a.height} mm exceeds slot ${t.rackSlotLength} × ${t.rackSlotDepth} × ${t.rackSlotHeight} mm.`);}
   if(o.kind==='rack'){
    const allocations=o.allocations||[];
    for(let i=0;i<allocations.length;i++){const a=allocations[i];if(a.level<1||a.level>(o.levels||t.rackLevels))add(g.id,`${a.pn}: level ${a.level}; rack allows ${o.levels||t.rackLevels} levels.`);
     if((a.z||0)+(a.height||0)>t.rackSlotHeight+.1)add(g.id,`${a.pn}: stack top ${(a.z||0)+(a.height||0)} mm; slot height ${t.rackSlotHeight} mm.`);
     for(let j=0;j<i;j++){const b=allocations[j];if(a.level!==b.level)continue;const sameHeight=(a.z||0)<(b.z||0)+(b.height||0)&& (b.z||0)<(a.z||0)+(a.height||0);if(sameHeight&&L.core.overlaps({x:a.x,y:a.y,w:a.length,h:a.depth},{x:b.x,y:b.y,w:b.length,h:b.depth},t.betweenBoxesAllowance||0))add(g.id,`${a.pn} overlaps ${b.pn} or violates ${t.betweenBoxesAllowance||0} mm box clearance on level ${a.level}.`);}
    }
   }
   if(o.kind==='ground'&&o.height*(o.stacking||1)>settings.maxFloorStackingHeight+.1)add(g.id,`${o.pn}: stack ${o.height*o.stacking} mm; maximum ${settings.maxFloorStackingHeight} mm.`);
   if(o.manualEmpty)warnings.push({groupId:g.id,message:`${o.id} is empty; no inventory was duplicated.`});
  }
  const segmentDistance=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y);};
  for(let i=0;i<objects.length;i++)for(let j=0;j<i;j++){
   const a=objects[i],b=objects[j],pa=a.o.points||L.corners(a.o),pb=b.o.points||L.corners(b.o),G=O().geometry;
   if(a.g.id===b.g.id&&a.o.kind!=='ground'&&b.o.kind!=='ground')continue;
   const overlap=G.area(G.intersect([G.path(pa)],[G.path(pb)]));
   if(overlap>.1){add(a.g.id,`${a.o.id} overlaps ${b.o.id}: ${Math.round(overlap)} mm².`,{code:'storage-overlap',objectIds:[a.o.id,b.o.id],required:(a.o.kind==='ground'||b.o.kind==='ground')?(settings.floorPalletClearance||0):0,measured:0});if(a.g.id!==b.g.id)add(b.g.id,`${b.o.id} overlaps ${a.o.id}.`);continue;}
   if(a.o.kind!=='ground'&&b.o.kind!=='ground')continue;
   const required=settings.floorPalletClearance||0;
   if(a.b.minX>b.b.maxX+required||b.b.minX>a.b.maxX+required||a.b.minY>b.b.maxY+required||b.b.minY>a.b.maxY+required)continue;
   let gap=Infinity;for(const [p,q] of [[pa,pb],[pb,pa]])for(const v of p)for(let k=0;k<q.length;k++)gap=Math.min(gap,segmentDistance(v,q[k],q[(k+1)%q.length]));
   if(gap<required-.11){const text=`Storage clearance between ${a.o.id} and ${b.o.id} is ${Math.round(gap)} mm; required ${required} mm.`;add(a.g.id,text,{code:'storage-clearance',objectIds:[a.o.id,b.o.id],required,measured:gap});if(a.g.id!==b.g.id)add(b.g.id,text,{code:'storage-clearance',objectIds:[a.o.id,b.o.id],required,measured:gap});}
  }
  if(layout.version===3)for(const g of layout.groups.filter(g=>!g.existing)){try{const trial=clone(layout),p=origin(g);scope.LogEnExistingLayout.move(trial,g.id,p[0],p[1],!!g.rotated,plan,settings);}catch(error){add(g.id,error.message);}}
  for(const e of result.validationErrors||[]){const groups=layout.groups.filter(g=>g.objects.some(o=>e.pn?.includes(o.pn||o.typeName)));if(groups.length)groups.forEach(g=>add(g.id,e.message));else errors.push(e);}
  layout.manualValidation={errors,warnings};layout.validationErrors=errors;layout.accessValid=errors.length===0;layout.complete=layout.complete&&layout.accessValid;return layout.manualValidation;
 }
 function placedQuantities(layout){const counts=new Map();for(const g of layout.groups)for(const o of g.objects){if(o.kind==='rack')for(const a of o.allocations||[]){const n=counts.get(a.pn)||{rack:0,ground:0};n.rack+=a.quantity||1;counts.set(a.pn,n);}else if(!o.manualEmpty){const n=counts.get(o.pn)||{rack:0,ground:0};n.ground+=o.quantity||0;counts.set(o.pn,n);}}return counts;}
 function missingParts(layout,plan){const counts=placedQuantities(layout);return plan.rows.map(r=>{const n=counts.get(r.input.partNumber)||{rack:0,ground:0},placed=n.rack+n.ground;return {pn:r.input.partNumber,required:r.required,placed,missing:Number.isSafeInteger(r.required)?Math.max(0,r.required-placed):null};}).filter(r=>r.missing===null||r.missing>0);}
 function placementPlan(layout,plan,settings){if(!layout.manualStorageTransfers||plan._manualStorageAdjusted)return plan;return {...plan,_manualStorageAdjusted:true,rows:plan.rows.map(r=>{const t=layout.manualStorageTransfers[r.input.partNumber];if(!t)return r;const groundPallets=(r.groundPallets||0)+t.ground,rackPallets=(r.rackPallets||0)+t.rack,check=scope.LogEnDomain.calculatePart(r.input,settings,r.required);return {...r,rackPallets,groundPallets,ground:groundPallets?scope.LogEnDomain.calculatePart(r.input,settings,groundPallets).floor:null,errors:check.isPlanningValid?[]:r.errors};})};}
 function addMissing(layout,plan,settings,pn,storage,point){
  if(!['rack','ground'].includes(storage))throw new Error('Choose Racks or Ground storage.');
  const row=plan.rows.find(r=>r.input.partNumber===pn),missing=missingParts(layout,plan).find(r=>r.pn===pn);if(!row||!missing?.missing)throw new Error('No additional known pallet quantity is available for this part. Correct its inputs or existing layout errors first.');
  const quantity=missing.missing,D=scope.LogEnDomain,synthetic={...row.input,qtyBox:1,qtyOnPallet:1,consumptionPerShift:quantity,doh:1},localSettings={...settings,shiftsPerDay:1,coverageMode:'custom',customCoverageDays:1},residual=D.calculateImplementation([synthetic],localSettings,{greenfield:true,storageMode:storage});
  if(!residual.available||residual.rows[0]?.errors.length||(storage==='rack'?residual.rows[0]?.rackPallets:residual.rows[0]?.groundPallets)!==quantity)throw new Error(residual.errors?.join(' ')||residual.rows[0]?.errors.join(' ')||'This part cannot use the chosen storage with the current dimensions and settings.');
  const source=L.makeObjects(residual,settings);if(source.issues.length||!source.groups.length)throw new Error(source.issues.map(i=>i.message).join(' ')||'No storage geometry can be created.');
  const represented=source.groups.flatMap(g=>g.objects).reduce((n,o)=>n+(o.kind==='rack'?o.allocations.length:o.quantity),0);if(represented!==quantity)throw new Error('The required pallet quantity could not be fully allocated.');
  if(layout.groups.flatMap(g=>g.objects).length+source.groups.flatMap(g=>g.objects).length>10000)throw new Error('The layout would exceed 10,000 storage objects.');
  const current=placementPlan(layout,plan,settings),expected=current.rows.find(r=>r.input.partNumber===pn),placed=placedQuantities(layout).get(pn)||{rack:0,ground:0},fromRack=Math.min(quantity,Math.max(0,expected.rackPallets-placed.rack)),fromGround=quantity-fromRack;
  const transfer=layout.manualStorageTransfers?.[pn]||{rack:0,ground:0},frame=layout.env.frame||layout.groups.find(g=>g.frame)?.frame||{angle:0,sx:1,sy:1},anchor=O().toLocal(point,frame),serial=(layout.manualAdditionSerial||0)+1,groups=[];let offset=0;
  for(const [index,original]of source.groups.entries()){const g=clone(original);g.id=`added:${serial}:${index}`;g.frame=clone(frame);g.x=anchor[0]+offset;g.y=anchor[1];g.paired=false;g.manualRow=storage==='ground';
   for(const o of g.objects){o.id=`added:${serial}:${o.id}`;o.groundRowId=g.id;}
   if(storage==='ground'){const c=settings.floorPalletClearance||0;g.h=Math.max(...g.objects.map(o=>o.dy+o.h))+c/2;g.groundRows=[{id:g.id,x:0,y:0,w:g.w,h:g.h,side:'front',objectIds:g.objects.map(o=>o.id)}];}
   groups.push(g);offset+=g.w+(settings.floorPalletClearance||0);
  }
  // Commit only after the complete residual demand and geometry are known.
  layout.manualStorageTransfers={...layout.manualStorageTransfers,[pn]:{rack:transfer.rack+(storage==='rack'?quantity:0)-fromRack,ground:transfer.ground+(storage==='ground'?quantity:0)-fromGround}};
  layout.manualAdditionSerial=serial;layout.manualAddedIds=[...(layout.manualAddedIds||[]),...groups.flatMap(g=>g.objects.map(o=>o.id))];
  layout.unplaced=layout.unplaced.map(g=>({...g,objects:g.objects.flatMap(o=>{if(o.kind!=='rack')return o.pn===pn?[]:[o];if(!o.allocations.some(a=>a.pn===pn))return [o];const allocations=o.allocations.filter(a=>a.pn!==pn);return allocations.length?[{...o,allocations,pallets:allocations.length}]:[];})})).filter(g=>g.objects.length);
  layout.groups.push(...groups);layout.issues=layout.issues.filter(i=>i.pn!==pn);layout.manualEdited=true;const effective=placementPlan(layout,plan,settings);layout.rackRequired=effective.rows.reduce((n,r)=>n+(r.rackPallets||0),0);layout.groundRequired=effective.rows.reduce((n,r)=>n+(layout.manualStorageTransfers[r.input.partNumber]?layout.groups.flatMap(g=>g.objects).filter(o=>o.kind==='ground'&&o.pn===r.input.partNumber&&!o.manualEmpty).length:(r.ground?.positions||0)),0);return {groupIds:groups.map(g=>g.id),quantity,pn,storage};
 }
 // Explicit repair is bounded, transactional, and validated against all current constraints.
 async function fixErrors(layout,plan,settings,geometry,onProgress=()=>{},budget=240){
  const start=clone(layout);validate(layout,plan,settings,geometry);
  const spacing=e=>!!e.objectIds||/clearance to|accessible face|Forklift clearance/i.test(e.message);
  const fingerprint=e=>(e.groupId||e.pn||'')+':'+(e.code||e.message.replace(/\d+(?:\.\d+)?/g,'#'));
  const hardKeys=l=>new Set(l.manualValidation.errors.filter(e=>!spacing(e)).map(fingerprint));
  const score=l=>[hardKeys(l).size,l.manualValidation.errors.filter(spacing).length,l.manualValidation.errors.filter(e=>e.objectIds).reduce((n,e)=>n+Math.max(0,e.required-e.measured),0)];
  const better=(a,b)=>{for(let i=0;i<a.length;i++){if(Math.abs(a[i]-b[i])>.01)return a[i]<b[i];}return false;};
  const restore=v=>{for(const key of Object.keys(layout))delete layout[key];Object.assign(layout,clone(v));};
  let attempts=0,changes=0;
  while(attempts<budget){
   const current=clone(layout),allowed=hardKeys(layout),oldScore=score(layout),records=layout.groups.flatMap(g=>L.placedObjects(g).map(o=>({g,o}))),byId=new Map(records.map(v=>[v.o.id,v])),pairs=new Map();
   for(const e of layout.manualValidation.errors){if(!spacing(e))continue;if(e.objectIds){const [a,b]=e.objectIds.map(id=>byId.get(id));if(a&&b)pairs.set(e.objectIds.slice().sort().join('|'),{a,b,gap:e.required});}
    else{const owners=layout.groups.filter(g=>g.id===e.groupId||g.objects.some(o=>e.pn?.includes(o.pn||o.typeName)));for(const g of owners){const b=box(g),near=layout.groups.filter(v=>v.id!==g.id).map(v=>({v,b:box(v)})).sort((a,c)=>Math.hypot(a.b.minX-b.minX,a.b.minY-b.minY)-Math.hypot(c.b.minX-b.minX,c.b.minY-b.minY)).slice(0,3);for(const {v}of near)pairs.set(g.id+'|'+v.id,{a:records.find(r=>r.g.id===g.id),b:records.find(r=>r.g.id===v.id),gap:settings.gangwayWidth});}}
   }
   const candidates=[];
   for(const {a,b,gap}of pairs.values())for(const [fixed,moving]of [[a,b],[b,a]]){
    if(!fixed||!moving||moving.g.existing)continue;
    // Only explicit repair may adjust a box within an existing ground block.
    const internal=fixed.g.id===moving.g.id;if(internal&&moving.o.kind!=='ground')continue;
    const pa=fixed.o.points||L.corners(fixed.o),pb=moving.o.points||L.corners(moving.o);
    for(let i=0;i<2;i++){const edge=[pa[i+1][0]-pa[i][0],pa[i+1][1]-pa[i][1]],length=Math.hypot(...edge);if(!length)continue;const axis=edge.map(v=>v/length),project=p=>p[0]*axis[0]+p[1]*axis[1],aa=pa.map(project),bb=pb.map(project);
     for(const delta of [Math.max(...aa)+gap-Math.min(...bb),Math.min(...aa)-gap-Math.max(...bb)])if(Math.abs(delta)>.01)candidates.push({groupId:moving.g.id,objectId:internal?moving.o.id:null,dx:axis[0]*delta,dy:axis[1]*delta,distance:Math.abs(delta)});
    }
   }
   candidates.sort((a,b)=>a.distance-b.distance);let best=null,bestScore=oldScore;
   for(const c of candidates){if(attempts++>=budget)break;restore(current);
    if(c.objectId){const g=layout.groups.find(g=>g.id===c.groupId),o=g.objects.find(o=>o.id===c.objectId),v=g.frame?O().toLocal([c.dx,c.dy],g.frame):[c.dx,c.dy];o.dx+=g.rotated?v[1]:v[0];o.dy+=g.rotated?-v[0]:v[1];
     const minX=Math.min(0,...g.objects.map(o=>o.dx)),minY=Math.min(0,...g.objects.map(o=>o.dy)),oldH=g.h;g.w=Math.max(g.w,...g.objects.map(o=>o.dx+o.w))-minX;g.h=Math.max(g.h,...g.objects.map(o=>o.dy+o.h))-minY;
     for(const o of g.objects){o.dx-=minX;o.dy-=minY;}g.x+=g.rotated?oldH-g.h-minY:minX;g.y+=g.rotated?minX:minY;
     if(g.backY!==undefined)g.backY-=minY;if(g.centerLine)g.centerLine=[[0,g.backY],[g.w,g.backY]];
     for(const row of g.groundRows||[]){const list=g.objects.filter(o=>row.objectIds.includes(o.id));if(list.length){row.x=Math.min(...list.map(o=>o.dx));row.y=Math.min(...list.map(o=>o.dy));row.w=Math.max(...list.map(o=>o.dx+o.w))-row.x;row.h=Math.max(...list.map(o=>o.dy+o.h))-row.y;}}
    }else translate(layout,[c.groupId],c.dx,c.dy);
    validate(layout,plan,settings,geometry);const now=score(layout),newHard=hardKeys(layout);
    if([...newHard].every(key=>allowed.has(key))&&better(now,bestScore)){best=clone(layout);bestScore=now;}
    if(attempts%8===0){onProgress(attempts,budget);await new Promise(resolve=>setTimeout(resolve,0));}
   }
   if(!best){restore(current);break;}restore(best);changes++;if(!layout.manualValidation.errors.some(spacing))break;
  }
  if(changes)layout.manualEdited=true;else restore(start);
  validate(layout,plan,settings,geometry);return {changes,attempts,remaining:layout.manualValidation.errors.length};
 }
 function align(layout,ids,edge){
  const groups=ids.map(id=>layout.groups.find(g=>g.id===id&&!g.existing)).filter(Boolean);if(groups.length<2)throw Error('Shift-select at least two movable rows or bays to align.');
  const horizontal=['left','right','center-x'].includes(edge),value=b=>edge==='left'?b.minX:edge==='right'?b.maxX:edge==='bottom'?b.minY:edge==='top'?b.maxY:horizontal?(b.minX+b.maxX)/2:(b.minY+b.maxY)/2;
  const target=value(box(groups[0]));for(const g of groups.slice(1)){const d=target-value(box(g));translate(layout,[g.id],horizontal?d:0,horizontal?0:d);}
 }
 function session(layout){let undo=[],redo=[];return {checkpoint(){undo.push(clone(layout));if(undo.length>50)undo.shift();redo=[];},undo(){if(!undo.length)return false;redo.push(clone(layout));replace(undo.pop());return true;},redo(){if(!redo.length)return false;undo.push(clone(layout));replace(redo.pop());return true;},get canUndo(){return !!undo.length},get canRedo(){return !!redo.length}};function replace(v){for(const k of Object.keys(layout))delete layout[k];Object.assign(layout,v);}}
 scope.LogEnManualLayout=Object.freeze({split,translate,rotate,moveAssignment,duplicate,remove,snap,validate,placedQuantities,missingParts,placementPlan,addMissing,fixErrors,align,session,origin,box,clone});
})(globalThis);
