/* Manual edits use the same millimetre model as CAD export and the 3D viewer. */
(function(scope){
 'use strict';
 const L=scope.LogEnLayout,O=()=>scope.LogEnOptimizer,clone=v=>JSON.parse(JSON.stringify(v));
 const origin=g=>g.frame?O().toWorld([g.x,g.y],g.frame):[g.x,g.y];
 const box=g=>L.bounds(L.placedObjects(g).flatMap(o=>o.points||L.corners(o)));
 function splitGroundRow(layout,g,objectId){
  if(g.manualRow)return g.id;
  let rows=g.groundRows?.map(row=>({...row,objectIds:row.objectIds||g.objects.filter(o=>o.groundRowId===row.id).map(o=>o.id)}));
  if(!rows?.length){const groups=new Map();for(const o of g.objects){const key=o.groundRowId||`${o.groundFace||'front'}:${o.dx}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);}rows=[...groups].map(([id,list])=>{const x=Math.min(...list.map(o=>o.dx)),y=Math.min(...list.map(o=>o.dy));return {id,x,y,w:Math.max(...list.map(o=>o.dx+o.w))-x,h:Math.max(...list.map(o=>o.dy+o.h))-y,side:list[0].groundFace||'front',objectIds:list.map(o=>o.id)};});}
  if(rows.length<2)return g.id;
  const coverage=rows.flatMap(row=>row.objectIds);if(new Set(coverage).size!==g.objects.length||coverage.length!==g.objects.length)return g.id;
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
 function translate(layout,ids,dx,dy){for(const g of layout.groups.filter(g=>ids.includes(g.id)&&!g.existing)){const p=origin(g),v=g.frame?O().toLocal([p[0]+dx,p[1]+dy],g.frame):[p[0]+dx,p[1]+dy];g.x=v[0];g.y=v[1];}layout.manualEdited=true;}
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
  const eb=layout.env.box,margin=layout.options.allowWallStorage?(layout.options.wallClearance||0):g;
  if(eb){const p=layout.env.frame?O().toWorld([eb.minX+margin,eb.minY+margin],layout.env.frame):[eb.minX+margin,eb.minY+margin],q=layout.env.frame?O().toWorld([eb.maxX-margin,eb.maxY-margin],layout.env.frame):[eb.maxX-margin,eb.maxY-margin];xs.push(p[0],q[0]);ys.push(p[1],q[1]);}
  const nearest=(targets,edges)=>{let best=null;for(const target of targets)for(const edge of edges){const delta=target-edge;if(Math.abs(delta)<=tolerance&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,target};}return best;};
  const choose=(a,b)=>!a?b:!b?a:Math.abs(a.delta)<Math.abs(b.delta)?a:b;
  const sx=choose(nearest(xs,[b.minX+dx,b.maxX+dx]),choose(nearest(edgeTargets.minX,[b.minX+dx]),nearest(edgeTargets.maxX,[b.maxX+dx]))),sy=choose(nearest(ys,[b.minY+dy,b.maxY+dy]),choose(nearest(edgeTargets.minY,[b.minY+dy]),nearest(edgeTargets.maxY,[b.maxY+dy]))),guides=[];
  if(sx){dx+=sx.delta;guides.push({axis:'x',value:sx.target});}else dx=Math.round((b.minX+dx)/grid)*grid-b.minX;
  if(sy){dy+=sy.delta;guides.push({axis:'y',value:sy.target});}else dy=Math.round((b.minY+dy)/grid)*grid-b.minY;
  return {dx,dy,guides};
 }
 function validate(layout,plan,settings,geometry){
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
 function session(layout){let undo=[],redo=[];return {checkpoint(){undo.push(clone(layout));if(undo.length>50)undo.shift();redo=[];},undo(){if(!undo.length)return false;redo.push(clone(layout));replace(undo.pop());return true;},redo(){if(!redo.length)return false;undo.push(clone(layout));replace(redo.pop());return true;},get canUndo(){return !!undo.length},get canRedo(){return !!redo.length}};function replace(v){for(const k of Object.keys(layout))delete layout[k];Object.assign(layout,v);}}
 scope.LogEnManualLayout=Object.freeze({split,translate,rotate,moveAssignment,duplicate,remove,snap,validate,fixErrors,session,origin,box,clone});
})(globalThis);
