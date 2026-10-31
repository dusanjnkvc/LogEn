/* Bounded, offline layout search. Demand and rack allocations come from LogEnDomain. */
(function(scope){
  'use strict';
  const L=scope.LogEnLayout,C=scope.ClipperLib,S=10,E=0.11,core=L.core;
  const path=p=>p.map(([x,y])=>({X:Math.round(x*S),Y:Math.round(y*S)}));
  const points=p=>p.map(v=>[v.X/S,v.Y/S]);
  const area=ps=>Math.abs(ps.reduce((a,p)=>a+C.Clipper.Area(p),0))/(S*S);
  function boolean(a,b,type){if(!a.length)return [];const c=new C.Clipper(),out=[];c.AddPaths(a,C.PolyType.ptSubject,true);if(b.length)c.AddPaths(b,C.PolyType.ptClip,true);c.Execute(type,out,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);return out;}
  const union=ps=>boolean(ps,[],C.ClipType.ctUnion),intersect=(a,b)=>boolean(a,b,C.ClipType.ctIntersection),diff=(a,b)=>b.length?boolean(a,b,C.ClipType.ctDifference):a;
  function offset(ps,d){if(!ps.length)return [];if(!d)return ps;const out=[],o=new C.ClipperOffset(2,0.1*S);o.AddPaths(ps,C.JoinType.jtMiter,C.EndType.etClosedPolygon);o.Execute(out,d*S);return out;}
  const rect=r=>path(L.corners(r));
  function oriented(p){const q=path(p);if(!C.Clipper.Orientation(q))q.reverse();return q;}
  const polygonArea=ps=>area(ps)/1e6;
  const collide=(r,ps)=>area(intersect([rect(r)],ps))>E;
  const fits=(r,ps)=>area(diff([rect(r)],ps))<E;
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const toWorld=(p,f)=>{const c=Math.cos(f.angle),s=Math.sin(f.angle),x=p[0]*f.sx,y=p[1]*f.sy;return [x*c-y*s,x*s+y*c];};
  const toLocal=(p,f)=>{const c=Math.cos(f.angle),s=Math.sin(f.angle);return [Math.round((p[0]*c+p[1]*s)*f.sx*S)/S,Math.round((-p[0]*s+p[1]*c)*f.sy*S)/S];};
  const regionBounds=ps=>L.bounds(ps.flatMap(points));
  const rectBounds=p=>{const b=L.bounds(p);return {x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY};};
  function buildingAngle(poly){let length=0,angle=0;poly.forEach((p,i)=>{const q=poly[(i+1)%poly.length],n=Math.hypot(q[0]-p[0],q[1]-p[1]);if(n>length+E){length=n;angle=Math.atan2(q[1]-p[1],q[0]-p[0]);}});while(angle>=Math.PI/4)angle-=Math.PI/2;while(angle< -Math.PI/4)angle+=Math.PI/2;return angle;}
  function normalizedOptions(options){const o={warehouseOrientation:'auto',backToBackSeparation:0,wallClearance:0,suitableWallEdges:[],...options};for(const k of ['backToBackSeparation','wallClearance','obstacleClearance'])if(!Number.isFinite(o[k])||o[k]<0)throw new Error('Enter non-negative rack separation, wall and obstacle clearances.');return o;}
  function environment(geometry,options,settings,orientation,sx,sy){
    const raw=L.environment(geometry,options),angle=buildingAngle(raw.poly)+(orientation==='vertical'?Math.PI/2:0),frame={angle,sx,sy},poly=raw.poly.map(p=>toLocal(p,frame)),boundary=[oriented(poly)],box=L.bounds(poly),g=settings.gangwayWidth;
    const obstacles=[],doors=[];
    for(const e of geometry.entities){if(e.id===options.boundaryId)continue;const role=options.entityRoles?.[e.id]||options.layerRoles?.[e.layer]||'obstacle';if(role==='reference')continue;
      const reliable=e.closed&&e.type!=='INSERT'&&core.validPolygon(e.points),p=(reliable?e.points:[[e.bounds[0],e.bounds[1]],[e.bounds[2],e.bounds[1]],[e.bounds[2],e.bounds[3]],[e.bounds[0],e.bounds[3]]]).map(v=>toLocal(v.map(n=>n*options.scale),frame));
      // Degenerate line obstacles get a 0.1 mm physical envelope before clearance.
      const b=rectBounds(p),q=reliable?oriented(p):rect({...b,w:Math.max(b.w,0.1),h:Math.max(b.h,0.1)});
      (role==='door'?doors:obstacles).push({id:e.id,path:q,bounds:b});
    }
    for(const [i,r]of(options.manualObstacles||[]).entries()){const p=L.corners(r).map(v=>toLocal(v,frame));obstacles.push({id:'reserved:'+i,path:oriented(p),bounds:rectBounds(p)});}
    const physical=intersect(union(obstacles.map(o=>o.path)),boundary),blocked=intersect(offset(union(obstacles.map(o=>o.path)),options.obstacleClearance),boundary),doorZones=intersect(offset(union(doors.map(o=>o.path)),g),boundary);
    const margin=options.allowWallStorage?options.wallClearance:g,zone=diff(offset(boundary,-margin),union([...blocked,...doorZones]));
    const perimeter=options.allowWallStorage?[]:diff(boundary,offset(boundary,-g)),wallSafety=options.allowWallStorage?diff(boundary,offset(boundary,-options.wallClearance)):[];
    const spine={x:box.minX+(options.allowWallStorage?options.wallClearance:0),y:box.minY+(options.allowWallStorage?options.wallClearance:0),w:g,h:box.maxY-box.minY-2*(options.allowWallStorage?options.wallClearance:0)};
    const circulation=union([...perimeter,rect(spine)]),routes=[];
    for(const d of doors){const r=d.bounds,cx=r.x+r.w/2,cy=Math.max(box.minY,Math.min(box.maxY-g,r.y+r.h/2-g/2));routes.push(rect({x:Math.min(spine.x,cx),y:cy,w:Math.max(spine.x+g,cx)-Math.min(spine.x,cx),h:g}));}
    const access=union([...circulation,...routes]),errors=[];
    if(area(diff(access,boundary))>E||area(intersect(access,blocked))>E)errors.push({pn:'Circulation',message:'The perimeter/main route or a door connection intersects blocked geometry or leaves the warehouse. This candidate is invalid.'});
    return {poly,box,boundary,zone,physical,blocked,doorZones,wallSafety,baseAccess:access,spine,frame,margin,obstacles,doors,errors};
  }
  function makeBlocks(source,env,settings,options,rowFraction){
    const rack=source.groups.filter(g=>g.kind==='rack').flatMap(g=>g.objects),byType=new Map(),blocks=[],wallRows=[];let index=0;
    for(const o of rack){if(!byType.has(o.typeId))byType.set(o.typeId,[]);byType.get(o.typeId).push(o);}
    for(const bays of byType.values()){
      const sample=bays[0],original=source.groups.find(g=>g.objects.some(o=>o.id===sample.id)),maxRun=sample.maxRunLength||original.w; // source runs already enforce rack-type maximum length
      const usable=env.box.maxX-env.margin-env.spine.x-env.spine.w,maxCount=Math.max(1,Math.floor(Math.min(maxRun,usable)/sample.w)),n=Math.max(1,Math.floor(maxCount*rowFraction)),rows=[];
      for(let i=0;i<bays.length;i+=n){const chunk=bays.slice(i,i+n);let x=0;rows.push({w:chunk.reduce((a,o)=>a+o.w,0),h:sample.h,objects:chunk.map(o=>{const q={...o,dx:x,dy:0};x+=o.w;return q;})});}
      const approved=options.suitableWallEdges||[];
      for(const side of ['bottom','top'])if(options.allowWallStorage&&rows.length){const y=side==='bottom'?env.box.minY:env.box.maxY;const edge=env.poly.findIndex((p,i)=>{const q=env.poly[(i+1)%env.poly.length];return approved.includes(i)&&Math.abs(p[1]-y)<E&&Math.abs(q[1]-y)<E;});if(edge>=0){const row=rows.shift();wallRows.push({...row,id:'wall:'+side+':'+row.objects[0].id,kind:'rack',wallSide:side,paired:false});}}
      while(rows.length){const a=rows.shift(),b=rows.shift(),gap=b?options.backToBackSeparation:0;blocks.push({id:'block:'+a.objects[0].id,kind:'rack',w:Math.max(a.w,b?.w||0),h:a.h+gap+(b?.h||0),objects:[...a.objects,...(b?b.objects.map(o=>({...o,dy:a.h+gap})):[])],paired:!!b,separation:gap,backY:a.h,rows:b?2:1});}
    }
    blocks.sort((a,b)=>b.objects.reduce((n,o)=>n+o.pallets,0)-a.objects.reduce((n,o)=>n+o.pallets,0)||b.w-a.w);
    return [...wallRows,...blocks,...source.groups.filter(g=>g.kind==='ground').map(g=>({...g,id:g.id,paired:false}))].map(g=>({...g,frame:env.frame,ordinal:++index}));
  }
  function groupRect(g){return {x:g.x,y:g.y,w:g.rotated?g.h:g.w,h:g.rotated?g.w:g.h};}
  function accessFor(g,env,width){const r=groupRect(g),x=env.spine.x,w=r.x+r.w-x;
    const bottom={x,y:r.y-width,w,h:width},top={x,y:r.y+r.h,w,h:width};
    return g.wallSide==='bottom'?[top]:g.wallSide==='top'?[bottom]:g.kind==='rack'&&g.paired?[bottom,top]:[bottom];
  }
  function placementError(g,placed,env,settings){
    const r=groupRect(g),access=accessFor(g,env,settings.gangwayWidth);
    if(!fits(r,env.zone))return 'Storage crosses the storage zone, boundary or mandatory clearance.';
    if(collide(r,env.baseAccess))return 'Storage blocks a circulation route.';
    for(const a of access)if(!fits(a,env.boundary)||collide(a,env.blocked))return 'A full-width access gangway is obstructed or leaves the warehouse.';
    for(const other of placed){if(other.id===g.id)continue;const rr=groupRect(other);if(core.overlaps(r,rr)||access.some(a=>core.overlaps(a,rr))||accessFor(other,env,settings.gangwayWidth).some(a=>core.overlaps(a,r)))return 'Storage or its required accessible face overlaps another storage block.';}
    return null;
  }
  async function pack(plan,settings,geometry,options,orientation,sx,sy,fraction,startOffset){
    const source=L.makeObjects(plan,settings),env=environment(geometry,options,settings,orientation,sx,sy),groups=[],unplaced=[],blocks=makeBlocks(source,env,settings,options,fraction),g=settings.gangwayWidth;
    let y=env.box.minY+env.margin+(options.allowWallStorage?g:0)+startOffset,x=env.spine.x+g,band=0;
    const left=x,right=env.box.maxX-env.margin,top=env.box.maxY-env.margin;
    for(let i=0;i<blocks.length;i++){
      if(i%32===0)await tick();const block=blocks[i];let result=null,lastError="No remaining valid storage band.";
      if(block.wallSide){const trial={...block,x:left,y:block.wallSide==='bottom'?env.box.minY+options.wallClearance:env.box.maxY-options.wallClearance-block.h};if(!placementError(trial,groups,env,settings))result=trial;}
      if(!result){let px=x,py=y,depth=band,attempt=0;
        while(py+block.h+(block.paired?g:0)<=top+(options.allowWallStorage?0:g)+E&&attempt++<160){
          if(px+block.w>right+E){py+=Math.max(depth,block.h)+g;px=left;depth=0;continue;}
          const trial={...block,wallSide:null,x:px,y:py};
          lastError=placementError(trial,groups,env,settings);if(!lastError){result=trial;x=px+block.w;y=py;band=Math.max(depth,block.h);break;}
          const occupied=[...env.obstacles.map(o=>o.bounds),...env.doors.map(o=>o.bounds),...groups.map(groupRect)],next=occupied.filter(o=>o.y<py+block.h+g&&o.y+o.h>py-g&&o.x+o.w>px+E).map(o=>o.x+o.w+options.obstacleClearance).sort((a,b)=>a-b)[0];
          if(next&&next+block.w<=right+E)px=next;else{const obstacleTop=env.obstacles.filter(o=>o.bounds.y<=py+block.h+g&&o.bounds.y+o.bounds.h>py).map(o=>o.bounds.y+o.bounds.h+options.obstacleClearance+g).sort((a,b)=>a-b)[0];py=Math.max(py+Math.max(depth,block.h)+g,obstacleTop??-Infinity);px=left;depth=0;}
        }
      }
      if(result){groups.push(result);if(result.wallSide==='bottom'){y=Math.max(y,result.y+result.h+g);x=left;band=0;}}else if(block.paired){const a=block.objects.filter(o=>o.dy===0),b=block.objects.filter(o=>o.dy>0);for(const row of [a,b])if(row.length)blocks.push({...block,id:'single:'+row[0].id,paired:false,rows:1,separation:0,backY:0,h:row[0].h,w:row.reduce((n,o)=>n+o.w,0),objects:row.map(o=>({...o,dy:0})),wallSide:null});}else unplaced.push({...block,unplacedReason:lastError});
    }
    const layout={version:2,orientation,groups,unplaced,env,options:{...options},issues:[...source.issues,...env.errors],rackRequired:source.rackRequired,groundRequired:source.groundRequired,search:{sx,sy,rowFraction:fraction,startOffset},buildingAngle:buildingAngle(geometry.entities.find(e=>e.id===options.boundaryId).points),geometryUnverified:geometry.unreadableEntities||0};
    Object.assign(layout,validate(layout,plan,settings));return layout;
  }
  function placedObjects(g){
    return g.objects.map(o=>{const x=g.x+(g.rotated?g.h-o.dy-o.h:o.dx),y=g.y+(g.rotated?o.dx:o.dy),w=g.rotated?o.h:o.w,h=g.rotated?o.w:o.h,p=L.corners({x,y,w,h}).map(p=>toWorld(p,g.frame)),center=toWorld([x+w/2,y+h/2],g.frame),origin=p[0];
      const localAngle=g.rotated?Math.PI/2:0,drawAngle=(g.frame.angle+Math.atan2(g.frame.sy*Math.sin(localAngle),g.frame.sx*Math.cos(localAngle)))*180/Math.PI;
      const frameLines=o.kind==='rack'?[o.structuralLength/2,o.w-o.structuralLength/2].map(dx=>{const a=[o.dx+dx,o.dy],b=[o.dx+dx,o.dy+o.h];return [a,b].map(([u,v])=>toWorld([g.x+(g.rotated?g.h-v:u),g.y+(g.rotated?u:v)],g.frame));}):[];
      return {...o,x:origin[0],y:origin[1],w,h,points:p,center,drawAngle,rotation:(o.rotation+drawAngle+360)%360,frameLines,groupId:g.id};});
  }
  function regionShapes(ps,frame,kind,prefix){return ps.map((p,i)=>({id:prefix+':'+i,kind,points:points(p).map(p=>toWorld(p,frame)),...rectBounds(points(p).map(p=>toWorld(p,frame))),hole:C.Clipper.Area(p)<0}));}
  function connected(ps){const tree=new C.PolyTree(),c=new C.Clipper();if(!ps.length)return false;c.AddPaths(ps,C.PolyType.ptSubject,true);c.Execute(C.ClipType.ctUnion,tree,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);return tree.Childs().length===1;}
  function metrics(layout,settings){
    const e=layout.env,rack=union(layout.groups.filter(g=>g.kind==='rack').flatMap(g=>g.objects.map(o=>rect({x:g.x+o.dx,y:g.y+o.dy,w:o.w,h:o.h})))),ground=union(layout.groups.filter(g=>g.kind==='ground').map(g=>rect(groupRect(g)))),storage=union([...rack,...ground]),access=union([...e.baseAccess,...layout.groups.flatMap(g=>accessFor(g,e,settings.gangwayWidth).map(rect))]);
    const safety=diff(union([...diff(e.blocked,e.physical),...e.wallSafety,...e.doorZones,...layout.groups.filter(g=>g.paired&&g.separation>0).map(g=>rect({x:g.x,y:g.y+g.backY,w:g.w,h:g.separation}))]),union([...access,...storage]));
    const free=diff(e.boundary,union([...storage,...access,...safety,...e.physical]));
    // Component areas use polygon clipping, including holes. Fit probes classify remaining components conservatively.
    const outer=free.filter(p=>C.Clipper.Area(p)>0),holes=free.filter(p=>C.Clipper.Area(p)<0),templates=layout.groups.concat(layout.unplaced).flatMap(g=>g.objects.map(o=>({w:o.w,h:o.h}))).filter((v,i,a)=>a.findIndex(t=>t.w===v.w&&t.h===v.h)===i).sort((a,b)=>a.w*a.h-b.w*b.h).slice(0,6);
    let unusable=0;
    for(const p of (templates.length?outer:[])){const region=[p,...holes.filter(h=>C.Clipper.PointInPolygon(h[0],p)!==0)],b=regionBounds([p]),probes=points(p);let usable=false;
      for(const t of templates){if(t.w>b.maxX-b.minX+E||t.h>b.maxY-b.minY+E)continue;const xs=[b.minX,b.maxX-t.w,(b.minX+b.maxX-t.w)/2,...probes.map(v=>v[0])],ys=[b.minY,b.maxY-t.h,(b.minY+b.maxY-t.h)/2,...probes.map(v=>v[1])];for(const x of xs.slice(0,8)){for(const y of ys.slice(0,8))if(fits({x,y,w:t.w,h:t.h},region)){usable=true;break;}if(usable)break;}if(usable)break;}
      if(!usable)unusable+=area(region);
    }
    const footprint=polygonArea(storage),total=polygonArea(e.boundary),clearance=polygonArea(safety),gangway=polygonArea(access),obstacle=polygonArea(e.physical),unused=polygonArea(free),sep=layout.groups.reduce((n,g)=>n+(g.paired?g.w*g.separation:0),0)/1e6;
    return {totalWarehouseArea:total,availableStorageArea:polygonArea(diff(e.zone,e.baseAccess)),rackFootprint:polygonArea(rack),groundFootprint:polygonArea(ground),gangwayArea:gangway,mandatoryClearanceArea:clearance,obstacleArea:obstacle,unusedUsableArea:Math.max(0,unused-unusable/1e6),unusableArea:unusable/1e6,racks:layout.groups.filter(g=>g.kind==='rack').reduce((n,g)=>n+g.objects.length,0),rackPositions:layout.generatedRack,groundPositions:layout.generatedGround,accommodatedPallets:layout.accommodatedPallets,requiredPallets:layout.requiredPallets,utilizationPercent:total>0?footprint/total*100:0,connected:connected(access),accessPaths:access,clearancePaths:safety,freePaths:free};
  }
  function validate(layout,plan,settings){
    const errors=[...layout.issues],valid=[],ids=new Set(),objectIds=new Set(),expected=new Set(L.makeObjects(plan,settings).groups.flatMap(g=>g.objects.map(o=>o.id)));
    for(const g of layout.groups){let error=placementError(g,layout.groups,layout.env,settings);for(const o of g.objects){if(objectIds.has(o.id)||!expected.has(o.id))error='Duplicate or unknown storage object.';objectIds.add(o.id);}if(ids.has(g.id)||error)errors.push({pn:g.objects.map(o=>o.pn||o.typeName).join(', '),message:error||'Duplicate block identity.'});else valid.push(g);ids.add(g.id);}
    const rack=new Map(),ground=new Map();let generatedRack=0,generatedGround=0,groundPallets=0;
    for(const g of valid)for(const o of g.objects){if(o.kind==='rack')for(const a of o.allocations){generatedRack++;rack.set(a.pn,(rack.get(a.pn)||0)+1);}else{generatedGround++;groundPallets+=o.quantity;ground.set(o.pn,(ground.get(o.pn)||0)+o.quantity);}}
    const affected=plan.rows.filter(r=>r.required===null||r.errors.length||(rack.get(r.input.partNumber)||0)!==r.rackPallets||(ground.get(r.input.partNumber)||0)!==r.groundPallets).map(r=>({pn:r.input.partNumber,message:r.errors.join(' ')||`Rack pallets ${rack.get(r.input.partNumber)||0}/${r.rackPallets}; ground pallets ${ground.get(r.input.partNumber)||0}/${r.groundPallets}`}));
    const result={generatedRack,generatedGround,unplacedRack:Math.max(0,layout.rackRequired-generatedRack),unplacedGround:Math.max(0,layout.groundRequired-generatedGround),affected,validationErrors:errors,accommodatedPallets:generatedRack+groundPallets,requiredPallets:plan.rows.reduce((n,r)=>n+(r.required||0),0)};
    Object.assign(layout,result);const m=metrics(layout,settings);if(!m.connected)errors.push({pn:'Circulation',message:'Forklift circulation is disconnected. This candidate is invalid.'});
    const baseSafety=!!layout.options.constraintsConfirmed&&!!layout.options.geometryReviewed&&!layout.geometryUnverified;
    Object.assign(result,{metrics:m,accessValid:errors.length===0,safetyVerified:baseSafety,complete:!affected.length&&!errors.length&&!layout.unplaced.length,aisles:regionShapes(m.accessPaths,layout.env.frame,'aisle','aisle'),clearances:regionShapes(m.clearancePaths,layout.env.frame,'clearance','clearance')});
    return result;
  }
  const rank=l=>[l.accessValid?1:0,l.accommodatedPallets,l.complete?1:0,-l.metrics.unusableArea,-l.metrics.gangwayArea,-l.groups.length];
  function better(a,b){if(!b)return true;const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++){if(Math.abs(x[i]-y[i])>1e-5)return x[i]>y[i];}return false;}
  async function optimize(plan,settings,geometry,rawOptions,onProgress=()=>{}){
    if(!plan.available)throw new Error(plan.errors.join(' '));if(!(settings.gangwayWidth>0))throw new Error('Enter a positive gangway width.');
    const options=normalizedOptions(rawOptions),source=L.makeObjects(plan,settings);if(source.groups.reduce((n,g)=>n+g.objects.length,0)>10000)throw new Error('Select a category to keep the drawing within 10,000 objects.');
    const alternatives={};let n=0;
    for(const orientation of ['horizontal','vertical']){let best=null;for(const [sx,sy]of [[1,1],[-1,1],[1,-1],[-1,-1]])for(const fraction of [1,0.5])for(const shift of [0,settings.gangwayWidth/2]){onProgress(++n,32);await tick();const candidate=await pack(plan,settings,geometry,options,orientation,sx,sy,fraction,shift);if(better(candidate,best))best=candidate;}alternatives[orientation]=best;}
    const recommended=recommend(alternatives);
    const winner=options.warehouseOrientation==='horizontal'?'horizontal':options.warehouseOrientation==='vertical'?'vertical':recommended||'horizontal';
    return {alternatives,winner,layout:alternatives[winner]};
  }
  function recommend(alternatives){const h=alternatives.horizontal,v=alternatives.vertical;if(!h?.accessValid&&!v?.accessValid)return null;return !h?.accessValid?'vertical':!v?.accessValid?'horizontal':better(v,h)?'vertical':'horizontal';}
  function move(layout,id,x,y,rotated,plan,settings){
    const group=layout.groups.find(g=>g.id===id)||layout.unplaced.find(g=>g.id===id);if(!group||![x,y].every(Number.isFinite))throw new Error('Select a block and enter finite world coordinates.');
    if(rotated!==!!group.rotated)throw new Error('Use the other orientation candidate to rotate rack blocks while preserving their accessible faces.');
    const [lx,ly]=toLocal([x,y],group.frame),trial={...group,x:lx,y:ly},error=placementError(trial,layout.groups,layout.env,settings);if(error)throw new Error(error);Object.assign(group,trial);if(!layout.groups.includes(group)){layout.groups.push(group);layout.unplaced=layout.unplaced.filter(g=>g.id!==id);}Object.assign(layout,validate(layout,plan,settings));return layout;
  }
  scope.LogEnOptimizer=Object.freeze({optimize,recommend,validate,move,placedObjects,toWorld,toLocal,geometry:Object.freeze({path,points,area,union,diff,intersect,offset,fits}),buildingAngle});
})(globalThis);
