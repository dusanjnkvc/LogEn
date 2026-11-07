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
  // Exact shortcut for the common rectangular boundary; retain clipping for holes/concave regions.
  const regionCache=new WeakMap();
  function regionInfo(ps){let info=regionCache.get(ps);if(info)return info;const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};for(const ring of ps)for(const p of ring){b.minX=Math.min(b.minX,p.X);b.maxX=Math.max(b.maxX,p.X);b.minY=Math.min(b.minY,p.Y);b.maxY=Math.max(b.maxY,p.Y);}const p=ps[0];const simple=ps.length===1&&p.length===4&&C.Clipper.Area(p)>0&&p.every((v,i)=>v.X===p[(i+1)%4].X||v.Y===p[(i+1)%4].Y);info={b,simple};regionCache.set(ps,info);return info;}
  function rectangleArea(r,b){const x=Math.round(r.x*S),y=Math.round(r.y*S),right=Math.round((r.x+r.w)*S),top=Math.round((r.y+r.h)*S);return {total:(right-x)*(top-y)/(S*S),overlap:Math.max(0,Math.min(right,b.maxX)-Math.max(x,b.minX))*Math.max(0,Math.min(top,b.maxY)-Math.max(y,b.minY))/(S*S)};}
  function collide(r,ps){if(r.w<0||r.h<0)return area(intersect([rect(r)],ps))>E;if(!ps.length)return false;const {b,simple}=regionInfo(ps),a=rectangleArea(r,b);if(a.overlap<=E)return false;return simple?a.overlap>E:area(intersect([rect(r)],ps))>E;}
  function fits(r,ps){if(r.w<0||r.h<0)return area(diff([rect(r)],ps))<E;if(!ps.length)return false;const {b,simple}=regionInfo(ps);if(simple){const a=rectangleArea(r,b);return a.total-a.overlap<E;}return area(diff([rect(r)],ps))<E;}

  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const toWorld=(p,f)=>{const c=Math.cos(f.angle),s=Math.sin(f.angle),x=p[0]*f.sx,y=p[1]*f.sy;return [x*c-y*s,x*s+y*c];};
  const toLocal=(p,f)=>{const c=Math.cos(f.angle),s=Math.sin(f.angle);return [Math.round((p[0]*c+p[1]*s)*f.sx*S)/S,Math.round((-p[0]*s+p[1]*c)*f.sy*S)/S];};
  const regionBounds=ps=>L.bounds(ps.flatMap(points));
  const rectBounds=p=>{const b=L.bounds(p);return {x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY};};
  function buildingAngle(poly){let length=0,angle=0;poly.forEach((p,i)=>{const q=poly[(i+1)%poly.length],n=Math.hypot(q[0]-p[0],q[1]-p[1]);if(n>length+E){length=n;angle=Math.atan2(q[1]-p[1],q[0]-p[0]);}});while(angle>=Math.PI/4)angle-=Math.PI/2;while(angle< -Math.PI/4)angle+=Math.PI/2;return angle;}
  function normalizedOptions(options){const o={warehouseOrientation:'auto',backToBackSeparation:0,wallClearance:0,suitableWallEdges:[],...options};if(o.allowWallStorage&&o.wallRackMode){o.racksAroundWalls=true;if(o.wallRackMode!=='all')o.wallStartSide=o.wallRackMode;}for(const k of ['backToBackSeparation','wallClearance','obstacleClearance'])if(!Number.isFinite(o[k])||o[k]<0)throw new Error('Enter non-negative rack separation, wall and obstacle clearances.');return o;}
  function environment(geometry,options,settings,orientation,sx,sy){
    const raw=L.environment(geometry,options),angle=buildingAngle(raw.poly)+(orientation==='vertical'?Math.PI/2:0),frame={angle,sx,sy},poly=raw.poly.map(p=>toLocal(p,frame)),boundary=[oriented(poly)],box=L.bounds(poly),g=settings.gangwayWidth;
    if(raw.analysis){
      const A=scope.LogEnWarehouseGeometry,a=A.analyze(geometry,options,settings),transform=ps=>ps.map(p=>{const q=path(A.points(p).map(v=>toLocal(v,frame)));if(C.Clipper.Orientation(q)!==C.Clipper.Orientation(p))q.reverse();return q;}),boundsPath=p=>rectBounds(points(p));
      const all=transform(a.warehouse),physical=transform(a.physical),blocked=transform(a.movementBlocked),storageBlocked=transform(union([...a.noStorage,...diff(a.warehouse,a.gross)])),margin=options.allowWallStorage?options.wallClearance:g,zone=intersect(transform(a.net),offset(all,-margin)),complex=all.length!==1||Math.abs(area(all)-(box.maxX-box.minX)*(box.maxY-box.minY))>E;
      const existingAccess=transform(union(a.zones.filter(z=>z.role==='gangway').flatMap(z=>z.paths))),access=diff(union([...(options.allowWallStorage?[]:diff(all,offset(all,-g))),...existingAccess]),blocked),obstacles=storageBlocked.map((p,i)=>({id:'zone:'+i,path:p,bounds:boundsPath(p)})),doors=a.doors.filter(d=>d.forklift).flatMap(d=>transform(d.paths).map(p=>({id:d.id,path:p,bounds:boundsPath(p)})));
      const interiors=transform(a.wallInterior||[]),wallBoundary=interiors.length&&area(diff(transform(a.gross),interiors))<E?interiors:transform(a.gross),wallPoly=points([...wallBoundary].sort((a,b)=>Math.abs(C.Clipper.Area(b))-Math.abs(C.Clipper.Area(a)))[0]),wallBox=regionBounds(wallBoundary);
      return {poly,wallPoly,wallBox,regions:a.regions.map(r=>({id:r.id,points:r.points.map(p=>toLocal(p,frame))})),pillarClearances:transform(a.pillarClearancePaths),box:regionBounds(all),boundary:all,zone,physical,blocked,storageBlocked,doorZones:[],wallSafety:diff(all,offset(all,-margin)),baseAccess:access,spine:{x:box.minX,y:box.minY,w:g,h:box.maxY-box.minY},frame,margin,obstacles,doors,errors:[],complex,existingAccess,analysis:{regionCount:a.regionCount,grossArea:a.grossArea,excludedArea:a.excludedArea,netArea:a.netArea,warnings:a.warnings,counts:a.counts},requireGroundPairs:true,allowWallStorage:!!options.allowWallStorage,wallClearance:options.wallClearance,optionsObstacleClearance:options.obstacleClearance};
    }
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
    return {poly,box,boundary,zone,physical,blocked,doorZones,wallSafety,baseAccess:access,spine,frame,margin,obstacles,doors,errors,requireGroundPairs:true,allowWallStorage:!!options.allowWallStorage,wallClearance:options.wallClearance,optionsObstacleClearance:options.obstacleClearance};
  }
  function wallPose(group,env,options){
    const b=env.wallBox||env.box,c=options.wallClearance+(env.analysis?options.obstacleClearance:0),side=group.wallSide,g={...group},position=g.wallReverse?g.wallLimit-g.wallOffset-g.w:g.wallOffset;
    g.rotated=side==='left'||side==='right';
    if(g.kind!=='ground')g.objects=g.objects.map(o=>({...o,dy:side==='top'||side==='left'?g.h-o.h:0}));
    if(g.rotated){g.x=side==='left'?b.minX+c:b.maxX-c-g.h;g.y=g.wallStart+position;}
    else{g.x=b.minX+c+(g.wallStart||0)+position;g.y=side==='bottom'?b.minY+c:b.maxY-c-g.h;}
    return g;
  }
  function allWallBlocks(rack,env,settings,options,fraction){
    const b=env.wallBox||env.box,c=options.wallClearance+(env.analysis?options.obstacleClearance:0),gap=settings.gangwayWidth,d=Math.max(0,...rack.map(o=>o.h)),approved=options.suitableWallEdges||[],sides=[];
    for(const side of ['bottom','top','left','right']){const horizontal=side==='bottom'||side==='top',axis=horizontal?1:0,value=side==='bottom'?b.minY:side==='top'?b.maxY:side==='left'?b.minX:b.maxX;const edge=(env.wallPoly||env.poly).findIndex((p,i,outline)=>{const q=outline[(i+1)%outline.length];return (!approved.length||approved.includes(i))&&Math.abs(p[axis]-value)<E&&Math.abs(q[axis]-value)<E;});if(edge>=0)sides.push({side,edge,horizontal,cursor:0,last:null});}
    const orders={left:['left','top','right','bottom'],right:['right','bottom','left','top'],bottom:['bottom','left','top','right'],top:['top','right','bottom','left']},baseAngle=buildingAngle(env.poly.map(p=>toWorld(p,env.frame))),normals={left:[-1,0],right:[1,0],bottom:[0,-1],top:[0,1]},order=(orders[options.wallStartSide]||orders.left).map(side=>{const [x,y]=normals[side],c=Math.cos(baseAngle),sn=Math.sin(baseAngle),v=toLocal([x*c-y*sn,x*sn+y*c],env.frame);return Math.abs(v[0])>Math.abs(v[1])?(v[0]<0?'left':'right'):(v[1]<0?'bottom':'top');});sides.sort((a,b)=>order.indexOf(a.side)-order.indexOf(b.side));for(const slot of sides){const side=(orders[options.wallStartSide]||orders.left)[order.indexOf(slot.side)],v=side==='left'?[0,1]:side==='top'?[1,0]:side==='right'?[0,-1]:[-1,0],c=Math.cos(baseAngle),sn=Math.sin(baseAngle),local=toLocal([v[0]*c-v[1]*sn,v[0]*sn+v[1]*c],env.frame);slot.reverse=(slot.horizontal?local[0]:local[1])<0;}
    if(options.wallRackMode&&options.wallRackMode!=='all'){const chosen=order[0];for(let i=sides.length-1;i>=0;i--)if(sides[i].side!==chosen)sides.splice(i,1);}
    const groups=[];let turn=0;
    for(const [i,slot]of sides.entries()){const earlier=new Set(sides.slice(0,i).map(v=>v.side)),low=slot.horizontal?'left':'bottom',high=slot.horizontal?'right':'top';slot.start=env.wallCornerClearance??env.groundCornerClearance??(earlier.has(low)?d:0);slot.end=env.wallCornerClearance??env.groundCornerClearance??(earlier.has(high)?d:0);}
    for(const o of rack){
      for(let attempt=0;turn+attempt<sides.length;attempt++){
        const slot=sides[turn+attempt],limit=(slot.horizontal?b.maxX-b.minX:b.maxY-b.minY)-2*c-slot.start-slot.end,start=slot.horizontal?slot.start:b.minY+c+slot.start,runLimit=Math.max(o.w,(o.maxRunLength||o.w)*fraction),last=slot.last;
        const append=last&&last.typeId===o.typeId&&last.w+o.w<=Math.min(last.runLimit,runLimit)+E;
        const jumps=env.obstacles.concat(env.doors).map(v=>slot.horizontal?v.bounds.x+v.bounds.w+Math.max(options.obstacleClearance,gap)-b.minX-c:v.bounds.y+v.bounds.h+Math.max(options.obstacleClearance,gap)-start);
        // A new logical run/type shares the same loading aisle along the wall.
        // Maximum run length must not create an empty gangway between wall bays.
        const offsets=[...(append?[last.wallOffset]:[]),slot.cursor,...jumps.filter(v=>v>=slot.cursor)].sort((a,b)=>a-b);
        let chosen=null;
        for(const position of [...new Set(offsets)].slice(0,64)){
          const extend=append&&Math.abs(position-last.wallOffset)<E,w=extend?last.w+o.w:o.w;if(position<0||position+w>limit+E)continue;
          const candidate={id:extend?last.id:'wall:'+slot.side+':'+o.id,kind:'rack',typeId:o.typeId,w,h:extend?Math.max(last.h,o.h):o.h,objects:extend?[...last.objects,{...o,dx:last.w,dy:0}]:[{...o,dx:0,dy:0}],wallSide:slot.side,wallEdge:slot.edge,wallOffset:position,wallStart:start,wallLimit:limit,wallReverse:slot.reverse,paired:false,runLimit};
          const placed=wallPose(candidate,env,options),r=groupRect(placed),front=slot.side==='bottom'?{x:r.x,y:r.y+r.h,w:r.w,h:gap}:slot.side==='top'?{x:r.x,y:r.y-gap,w:r.w,h:gap}:slot.side==='left'?{x:r.x+r.w,y:r.y,w:gap,h:r.h}:{x:r.x-gap,y:r.y,w:gap,h:r.h};
          if(!fits(r,env.zone)||!fits(front,env.boundary)||collide(front,env.blocked))continue;
          if(groups.some(v=>v.id!==candidate.id&&core.overlaps(r,groupRect(v))))continue;
          chosen=placed;break;
        }
        if(chosen){const previous=groups.findIndex(v=>v.id===chosen.id);if(previous>=0)groups[previous]=chosen;else groups.push(chosen);slot.last=chosen;slot.cursor=chosen.wallOffset+chosen.w;turn=turn+attempt;break;}
      }
    }
    return groups;
  }
  // Dedicated PN rows share a straight back line; each side fills its frontage before a new lane.
  function rotateGroundRow(row,clearance){const objects=row.objects.map((o,k)=>({...o,w:o.h,h:o.w,rotation:(o.rotation+90)%360,dx:clearance/2,dy:k*(o.w+clearance)+clearance/2}));return {...row,w:objects[0].w+clearance,h:objects.length*(objects[0].h+clearance),objects};}
  function splitGroundRows(rows,depth,clearance,allowRotation=false){
    const usable=[],oversize=[];
    for(const original of rows){let row=original;const firstInput=row.objects[0];if(!firstInput)continue;
      if(allowRotation){const turned=rotateGroundRow(row,clearance),cost=r=>{const cap=Math.floor((depth+E)/(r.objects[0].h+clearance));return cap>0?Math.ceil(r.objects.length/cap)*(r.objects[0].w+clearance):Infinity;};if(cost(turned)<cost(row)-E)row=turned;}
      const first=row.objects[0],step=first.h+clearance,capacity=Math.floor((depth+E)/step);
      if(capacity<1){oversize.push(row);continue;}
      for(let start=0;start<row.objects.length;start+=capacity){const items=row.objects.slice(start,start+capacity),id='ground-row:'+items[0].pn+':'+items[0].position;
        usable.push({...row,id,w:first.w+clearance,h:items.length*step,groundPending:false,objects:items.map((o,k)=>({...o,dx:clearance/2,dy:k*step+clearance/2}))});
      }
    }
    return {usable,oversize};
  }
  function fillGroundLane(rows,width,depth,env,serial,allowRotation=false,clearance=0){
    const used=new Set(),objects=[],groundRows=[],cursor=[0,0];
    for(const original of rows){let row=original,side=cursor[0]<=cursor[1]?0:1;if(cursor[side]+row.w>width+E)side=1-side;if(cursor[side]+row.w>width+E){if(!allowRotation)continue;const turned=rotateGroundRow(row,clearance);if(turned.h>depth+E)continue;if(cursor[side]+turned.w>width+E)side=1-side;if(cursor[side]+turned.w>width+E)continue;row=turned;}
      const x=cursor[side],face=side?'back':'front';
      groundRows.push({id:row.id,x,y:side?depth:depth-row.h,w:row.w,h:row.h,side:face,objectIds:row.objects.map(o=>o.id)});
      for(const o of row.objects)objects.push({...o,dx:x+o.dx,dy:side?depth+o.dy:depth-o.dy-o.h,groundRowId:row.id,groundFace:face});
      used.add(row.id);cursor[side]+=row.w;
    }
    if(!objects.length)return null;
    const complete=used.size===rows.length,w=complete?Math.max(...cursor):width;
    return {used,group:{id:'ground-lane:'+serial+':'+objects[0].id,kind:'ground',groundLane:true,w,h:2*depth,paired:true,rows:2,separation:0,backY:depth,centerLine:[[0,depth],[w,depth]],reservedBackRow:cursor.some(v=>v===0),groundRows,objects,frame:env.frame}};
  }
  function groundLaneIntervals(y,depth,left,right,groups,env,settings){
    const gap=settings.gangwayWidth,storage=rect({x:left,y,w:right-left,h:2*depth}),access=[rect({x:left,y:y-gap,w:right-left,h:gap}),rect({x:left,y:y+2*depth,w:right-left,h:gap})];
    const bad=[...diff([storage],env.zone),...intersect([storage],env.baseAccess),...diff(access,env.boundary),...intersect(access,env.blocked)];
    const whole=rect({x:left,y:y-gap,w:right-left,h:2*depth+2*gap});
    for(const group of groups){const fixed=cachedPlacement(group,env,gap);bad.push(...intersect([whole],[rect(fixed.r)]),...intersect([storage],fixed.access.map(rect)));}
    const cuts=bad.filter(p=>C.Clipper.Area(p)/(S*S)>E).map(p=>{const b=rectBounds(points(p));return [Math.max(left,b.x),Math.min(right,b.x+b.w),env.pillarClearances?.length>0&&area(diff([p],env.pillarClearances))<E];}).filter(v=>v[1]>v[0]+E).sort((a,b)=>a[0]-b[0]),merged=[];
    for(const cut of cuts){const prev=merged[merged.length-1];if(prev&&cut[0]<=prev[1]+E){prev[1]=Math.max(prev[1],cut[1]);prev[2]=prev[2]&&cut[2];}else merged.push([...cut]);}
    const intervals=[];let start=left,startAtPillar=false;
    for(const [a,b,pillarOnly]of merged){if(a>start+E)intervals.push([start,a,{skipStartAccess:startAtPillar,skipEndAccess:pillarOnly}]);start=Math.max(start,b);startAtPillar=pillarOnly;}if(start<right-E)intervals.push([start,right,{skipStartAccess:startAtPillar,skipEndAccess:false}]);
    // Pillar breaks use their own clearance; other breaks retain cross-access.
    return intervals.map(([a,b,ends])=>[a+(a>left+E&&!ends.skipStartAccess?gap:0),b-(b<right-E&&!ends.skipEndAccess?gap:0),ends]).filter(([a,b])=>b>a+E);
  }
  async function placeGroundLanes(input,env,settings,options,orientation,groups,unplaced){
    let remaining=input.map(row=>({...row,objects:row.objects.map(o=>({...o}))})),serial=1;
    const gap=settings.gangwayWidth,clearance=settings.floorPalletClearance||0,left=env.inner.minX+gap,right=env.inner.maxX-gap,bottom=env.inner.minY+gap,top=env.inner.maxY-gap,physicalDepth=Math.floor(Math.max(0,(top-bottom)/2)*S)/S;
    const limit=settings.maxFloorRowDepth>0?settings.maxFloorRowDepth:Infinity;
    const angle=buildingAngle(env.poly.map(p=>toWorld(p,env.frame))),side=orientation==='vertical'?options.groundStartVertical:options.groundStartHorizontal,v=side==='right'?[1,0]:side==='left'?[-1,0]:side==='top'?[0,1]:[0,-1],c=Math.cos(angle),sn=Math.sin(angle),direction=toLocal([v[0]*c-v[1]*sn,v[0]*sn+v[1]*c],env.frame)[1];
    while(remaining.length){
      await tick();let chosen=null;
      const actualDepths=remaining.map(r=>(remaining.length===1?Math.ceil(r.objects.length/2):r.objects.length)*(r.objects[0].h+clearance)),singleDepths=remaining.map(r=>r.objects[0].h+clearance),maximum=Math.min(limit,physicalDepth,Math.max(...actualDepths)),depths=[...new Set([maximum,Math.min(maximum,Math.max(...singleDepths)),Math.min(maximum,Math.min(...singleDepths))])].filter(d=>d>0);
      searchLane:for(const depth of depths){
        const {usable,oversize}=splitGroundRows(remaining,depth,clearance,settings.groundAllowRotation===true);if(!usable.length)continue;
        const occupied=[...env.obstacles.map(o=>o.bounds),...env.doors.map(o=>o.bounds),...groups.map(groupRect)],ys=[bottom,top-2*depth,...occupied.flatMap(r=>[r.y+r.h+gap,r.y-2*depth-gap]),...env.boundary.flatMap(points).flatMap(p=>[p[1]+gap,p[1]-2*depth-gap])].filter(y=>y>=bottom-E&&y+2*depth<=top+E).sort((a,b)=>direction>0?b-a:a-b);
        for(const y of [...new Set(ys)]){
          await tick();for(const [x,end,ends]of groundLaneIntervals(y,depth,left,right,groups,env,settings)){
            const filled=fillGroundLane(usable,end-x,depth,env,serial,settings.groundAllowRotation===true,clearance);if(!filled)continue;
            const group={...filled.group,...ends,x,y};if(placementError(group,groups,env,settings))continue;
            chosen={group,remaining:[...usable.filter(row=>!filled.used.has(row.id)),...oversize]};break searchLane;
          }
        }
      }
      if(!chosen)break;
      groups.push(chosen.group);remaining=chosen.remaining;serial++;
    }
    for(const row of remaining){const reservation=fillGroundLane([row],row.w,row.h,env,'unplaced:'+serial++).group;unplaced.push({...reservation,unplacedReason:'No remaining continuous ground lane fits this row and both full-width gangways.'});}
  }
  function makeBlocks(source,env,settings,options,rowFraction){
    if(options.allowWallStorage&&options.racksAroundWalls&&(!options.wallRackMode||options.wallRackMode==='all')){
      const wallRacks=source.groups.filter(g=>g.kind==='rack').flatMap(g=>g.objects),depths=wallRacks.length?wallRacks.map(o=>o.h):source.groups.filter(g=>g.kind==='ground').map(g=>g.h);
      if(depths.length){const actual=Math.max(...depths),d=settings.maxFloorRowDepth>0?Math.max(settings.maxFloorRowDepth,wallRacks.length?actual:0):actual,b=env.box,c=options.wallClearance;
        env.wallCornerClearance=d;if(!wallRacks.length)env.groundCornerClearance=d;
        const corners=intersect([rect({x:b.minX+c,y:b.minY+c,w:d,h:d}),rect({x:b.maxX-c-d,y:b.minY+c,w:d,h:d}),rect({x:b.minX+c,y:b.maxY-c-d,w:d,h:d}),rect({x:b.maxX-c-d,y:b.maxY-c-d,w:d,h:d})],env.boundary);
        env.zone=diff(env.zone,corners);env.wallSafety=union([...env.wallSafety,...corners]);
      }
    }
    if((options.storageMode==='ground'||!source.groups.some(g=>g.kind==='rack'))&&options.allowWallStorage&&options.racksAroundWalls){
      const rows=source.groups.filter(g=>g.kind==='ground'),units=rows.map(g=>({id:g.id,typeId:'ground-wall',w:g.w,h:g.h,maxRunLength:100000000,sourceRow:g}));
      const wall=allWallBlocks(units,env,settings,options,1),used=new Set(wall.flatMap(g=>g.objects.map(o=>o.id)));
      const placed=wall.map(g=>({...g,kind:'ground',groundRows:g.objects.map(unit=>({id:unit.id,x:unit.dx,y:0,w:unit.sourceRow.w,h:g.h,side:'wall',objectIds:unit.sourceRow.objects.map(o=>o.id)})),objects:g.objects.flatMap(unit=>unit.sourceRow.objects.map(o=>({...o,dx:unit.dx+o.dx,dy:unit.dy+o.dy,groundRowId:unit.id,groundFace:'wall'}))),frame:env.frame}));
      return [...placed,...rows.filter(g=>!used.has(g.id)).map(row=>({...row,groundPending:true,frame:env.frame}))];
    }
    const allRack=source.groups.filter(g=>g.kind==='rack').flatMap(g=>g.objects),wallRows=options.allowWallStorage&&options.racksAroundWalls?allWallBlocks(allRack,env,settings,options,rowFraction):[],used=new Set(wallRows.flatMap(g=>g.objects.map(o=>o.id))),rack=allRack.filter(o=>!used.has(o.id)),byType=new Map(),blocks=[];let index=0;
    for(const o of rack){if(!byType.has(o.typeId))byType.set(o.typeId,[]);byType.get(o.typeId).push(o);}
    const approved=options.suitableWallEdges||[],automatic=approved.length===0;
    for(const originalBays of byType.values()){
      const bays=[...originalBays],sample=bays[0],maxRun=sample.maxRunLength||source.groups.find(g=>g.objects.some(o=>o.id===sample.id)).w;
      const row=chunk=>{let x=0;return {w:chunk.reduce((n,o)=>n+o.w,0),h:sample.h,objects:chunk.map(o=>{const q={...o,dx:x,dy:0};x+=o.w;return q;})};};
      if(options.allowWallStorage&&!options.racksAroundWalls&&wallRows.length===0){
        for(const side of ['bottom','top']){
          const y=side==='bottom'?env.box.minY:env.box.maxY,edge=env.poly.findIndex((p,i)=>{const q=env.poly[(i+1)%env.poly.length];return (automatic||approved.includes(i))&&Math.abs(p[1]-y)<E&&Math.abs(q[1]-y)<E;});
          if(edge<0)continue;
          const wallWidth=env.box.maxX-env.box.minX-2*options.wallClearance,n=Math.floor(Math.min(maxRun,wallWidth)/sample.w);
          if(n<1)continue;
          const first=row(bays.splice(0,Math.max(1,Math.floor(n*rowFraction))));wallRows.push({...first,id:'wall:'+side+':'+first.objects[0].id,kind:'rack',wallSide:side,wallEdge:edge,wallOffset:0,wallStart:0,paired:false});break;
        }
      }
      const usable=env.box.maxX-env.margin-env.spine.x-env.spine.w,n=Math.max(1,Math.floor(Math.max(1,Math.floor(Math.min(maxRun,usable)/sample.w))*rowFraction)),rows=[];
      for(let i=0;i<bays.length;i+=n)rows.push(row(bays.slice(i,i+n)));
      while(rows.length){const a=rows.shift(),b=rows.shift(),gap=b?options.backToBackSeparation:0;blocks.push({id:'block:'+a.objects[0].id,kind:'rack',w:Math.max(a.w,b?.w||0),h:a.h+gap+(b?.h||0),objects:[...a.objects,...(b?b.objects.map(o=>({...o,dy:a.h+gap})):[])],paired:!!b,separation:gap,backY:a.h,rows:b?2:1});}
    }
    blocks.sort((a,b)=>b.objects.reduce((n,o)=>n+o.pallets,0)-a.objects.reduce((n,o)=>n+o.pallets,0)||b.w-a.w);
    return [...wallRows,...blocks,...source.groups.filter(g=>g.kind==='ground').map(row=>({...row,groundPending:true}))].map(g=>({...g,frame:env.frame,ordinal:++index}));
  }
  function wallAccess(env,blocks,options,settings){
    const b=env.wallBox||env.box,g=settings.gangwayWidth,c=options.allowWallStorage?options.wallClearance+(env.analysis?options.obstacleClearance:0):0,depth=side=>Math.max(0,...blocks.filter(v=>v.wallSide===side).map(v=>v.h));
    env.inner={minX:b.minX+c+depth('left'),maxX:b.maxX-c-depth('right'),minY:b.minY+c+depth('bottom'),maxY:b.maxY-c-depth('top')};
    if(env.complex)return;
    if(!options.allowWallStorage)return;
    const z=env.inner;env.spine={x:z.minX,y:z.minY,w:g,h:Math.max(0,z.maxY-z.minY)};
    const right={x:z.maxX-g,y:z.minY,w:g,h:Math.max(0,z.maxY-z.minY)},bottom={x:z.minX,y:z.minY,w:Math.max(0,z.maxX-z.minX),h:g},routes=[env.spine,right,bottom].filter(v=>v.w>0&&v.h>0).map(rect);
    if(options.racksAroundWalls)routes.push(rect({x:z.minX,y:z.maxY-g,w:Math.max(0,z.maxX-z.minX),h:g}));
    for(const d of env.doors){const r=d.bounds,cx=r.x+r.w/2,cy=Math.max(z.minY,Math.min(z.maxY-g,r.y+r.h/2-g/2));routes.push(rect({x:Math.min(z.minX,cx),y:cy,w:Math.max(z.minX+g,cx)-Math.min(z.minX,cx),h:g}));}
    env.baseAccess=union(routes);env.errors=[];
    if(z.maxX-z.minX<2*g||z.maxY-z.minY<g||area(diff(env.baseAccess,env.boundary))>E||area(intersect(env.baseAccess,env.blocked))>E)env.errors.push({pn:'Circulation',message:'The wall racks leave insufficient connected access or a route crosses blocked geometry.'});
  }
  function groupRect(g){return {x:g.x,y:g.y,w:g.rotated?g.h:g.w,h:g.rotated?g.w:g.h};}
  function localObjectRect(g,o){return {x:g.x+(g.rotated?g.h-o.dy-o.h:o.dx),y:g.y+(g.rotated?o.dx:o.dy),w:g.rotated?o.h:o.w,h:g.rotated?o.w:o.h};}
  function accessFor(g,env,width){const r=groupRect(g),z=env.inner||env.box,x=env.complex?r.x-width:z.minX,w=env.complex?r.w+2*width:z.maxX-z.minX;
    if(g.wallSide){const horizontal=g.wallSide==='bottom'||g.wallSide==='top',lo=horizontal?z.minX:z.minY,hi=horizontal?z.maxX:z.maxY;return (g.kind==='ground'&&g.groundRows?g.groundRows.map(o=>({...o,dx:o.x,dy:o.y})):g.objects).map(o=>{const v=localObjectRect(g,o),a=Math.max(horizontal?v.x:v.y,lo),b=Math.min(horizontal?v.x+v.w:v.y+v.h,hi);if(g.wallSide==='bottom')return {x:a,y:v.y+v.h,w:b-a,h:z.minY+width-v.y-v.h};if(g.wallSide==='top')return {x:a,y:z.maxY-width,w:b-a,h:v.y-z.maxY+width};if(g.wallSide==='left')return {x:v.x+v.w,y:a,w:z.minX+width-v.x-v.w,h:b-a};return {x:z.maxX-width,y:a,w:v.x-z.maxX+width,h:b-a};}).filter(v=>v.w>E&&v.h>E);}
    if(g.groundLane)return [{x:r.x,y:r.y-width,w:r.w,h:width},{x:r.x,y:r.y+r.h,w:r.w,h:width},...(!g.skipStartAccess?[{x:r.x-width,y:r.y,w:width,h:r.h}]:[]),...(!g.skipEndAccess?[{x:r.x+r.w,y:r.y,w:width,h:r.h}]:[])];
    const bottom={x,y:r.y-width,w,h:width},top={x,y:r.y+r.h,w,h:width};return g.paired?[bottom,top]:[bottom];
  }
  function endGangways(layout){
    const z=layout.env.inner||layout.env.box,rects=layout.groups.filter(g=>!g.wallSide).map(groupRect),cuts=[...new Set(rects.flatMap(r=>[r.y,r.y+r.h]))].sort((a,b)=>a-b),out=[];
    for(let i=1;i<cuts.length;i++){const y=cuts[i-1],h=cuts[i]-y,active=rects.filter(r=>r.y<y+h-E&&r.y+r.h>y+E);if(!active.length)continue;const left=Math.min(...active.map(r=>r.x)),right=Math.max(...active.map(r=>r.x+r.w));for(const r of [{x:z.minX,y,w:left-z.minX,h},{x:right,y,w:z.maxX-right,h}])if(r.w>E&&fits(r,layout.env.boundary)&&!collide(r,layout.env.blocked))out.push(rect(r));}
    return out;
  }
  function sharedRowError(a,b,gangway){
    const ground=a.kind==='ground'?a:b.kind==='ground'?b:null,rack=a.kind==='rack'?a:b.kind==='rack'?b:null;
    if(!ground||!rack||!!ground.rotated!==!!rack.rotated)return false;
    const r=groupRect(ground),vertical=!!rack.rotated;
    for(const o of rack.objects){const v=localObjectRect(rack,o),start=vertical?r.x:r.y,end=start+(vertical?r.w:r.h),low=vertical?v.x:v.y,high=low+(vertical?v.w:v.h),gap=vertical?Math.max(v.y-r.y-r.h,r.y-v.y-v.h):Math.max(v.x-r.x-r.w,r.x-v.x-v.w);
      if(gap>=-E&&gap<gangway-E&&start<high-E&&end>low+E&&(start<low-E||end>high+E))return true;
    }
    return false;
  }
  const placedGeometry=new WeakMap();
  function cachedPlacement(g,env,width){let byGroup=placedGeometry.get(env);if(!byGroup){byGroup=new WeakMap();placedGeometry.set(env,byGroup);}const signature=[g.x,g.y,g.w,g.h,g.rotated,g.wallSide,g.kind,g.paired,g.groundLane,g.backY,g.skipStartAccess,g.skipEndAccess,width,env.inner?.minX,env.inner?.maxX,env.inner?.minY,env.inner?.maxY].join(':');let value=byGroup.get(g);if(!value||value.signature!==signature||value.objects!==g.objects){value={signature,objects:g.objects,r:groupRect(g),access:accessFor(g,env,width)};byGroup.set(g,value);}return value;}
  function placementError(g,placed,env,settings){
    const r=groupRect(g),access=accessFor(g,env,settings.gangwayWidth);
    if(env.requireGroundPairs&&g.kind==='ground'&&!g.paired){const b=env.wallBox||env.box,c=(env.wallClearance||0)+(env.analysis?(env.optionsObstacleClearance||0):0),touch=g.wallSide==='left'?Math.abs(r.x-b.minX-c)<E:g.wallSide==='right'?Math.abs(r.x+r.w-b.maxX+c)<E:g.wallSide==='bottom'?Math.abs(r.y-b.minY-c)<E:g.wallSide==='top'?Math.abs(r.y+r.h-b.maxY+c)<E:false;if(!env.allowWallStorage||!touch)return 'Single ground rows must stay against an approved wall. Interior ground storage must stay back-to-back.';}
    if(!fits(r,env.zone))return 'Storage crosses the storage zone, boundary or mandatory clearance.';
    if(collide(r,env.baseAccess))return 'Storage blocks a circulation route.';
    for(const a of access)if(!fits(a,env.boundary)||collide(a,env.blocked))return 'A full-width access gangway is obstructed or leaves the warehouse.';
    for(const other of placed){if(other.id===g.id)continue;const fixed=cachedPlacement(other,env,settings.gangwayWidth),rr=fixed.r;if(sharedRowError(g,other,settings.gangwayWidth))return 'Ground storage beside a rack must fit within its row depth. Start a separate row for deeper ground storage.';if(core.overlaps(r,rr)||access.some(a=>core.overlaps(a,rr))||fixed.access.some(a=>core.overlaps(a,r)))return 'Storage or its required accessible face overlaps another storage block.';}
    return null;
  }
  // Adjacent ground sections share one line, rather than reserving an aisle between them.
  // A door, obstacle or main circulation route still prevents a join.
  function compactGroundGroups(groups,env,settings){
    let changed=true;
    while(changed){changed=false;
      search:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
        const a=groups[i],b=groups[j];
        if(a.kind!=='ground'||b.kind!=='ground'||!!a.rotated!==!!b.rotated||a.wallSide!==b.wallSide||!!a.groundLane!==!!b.groundLane||!a.groundRows?.length||!b.groundRows?.length)continue;
        if(!a.wallSide&&!a.groundLane)continue;
        const rotated=!!a.rotated,cross=g=>rotated?g.x:g.y,along=g=>rotated?g.y:g.x;
        // Different pallet depths can give sections different envelopes and center lines.
        // They still belong to the same band when their depth envelopes overlap.
        if(Math.min(cross(a)+a.h,cross(b)+b.h)-Math.max(cross(a),cross(b))<=E)continue;
        const depth=a.groundLane?Math.max(a.backY,b.backY,a.h-a.backY,b.h-b.backY):0,h=a.groundLane?2*depth:Math.max(a.h,b.h);
        const ordered=[a,b].sort((u,v)=>along(u)-along(v)),cursor={front:0,back:0,wall:0},groundRows=[],objects=[];
        for(const g of ordered){const byRow=new Map();for(const o of g.objects){if(!byRow.has(o.groundRowId))byRow.set(o.groundRowId,[]);byRow.get(o.groundRowId).push(o);}
          for(const row of [...g.groundRows].sort((u,v)=>u.x-v.x)){const x=cursor[row.side],items=byRow.get(row.id)||[];if(x===undefined||!items.length)continue;
            const y=a.groundLane?(row.side==='front'?depth-row.h:depth):row.y+(a.wallSide==='top'||a.wallSide==='left'?h-g.h:0);
            groundRows.push({...row,x,y});for(const o of items)objects.push({...o,dx:o.dx-row.x+x,dy:o.dy-row.y+y});cursor[row.side]+=row.w;
          }
        }
        if(objects.length!==a.objects.length+b.objects.length)continue;
        const w=Math.max(...Object.values(cursor)),reverse=a.wallSide&&a.wallReverse,start=reverse?Math.max(along(a)+a.w,along(b)+b.w)-w:Math.min(along(a),along(b));
        const merged={...a,w,h,objects,groundRows,[rotated?'y':'x']:start,...(a.groundLane?{backY:depth,centerLine:[[0,depth],[w,depth]],reservedBackRow:!cursor.front||!cursor.back,skipStartAccess:ordered[0].skipStartAccess,skipEndAccess:ordered.at(-1).skipEndAccess}:{})};
        const other=groups.filter((_,k)=>k!==i&&k!==j);
        const axis=rotated?'x':'y',origins=a.groundLane?[a.y+a.backY-depth,b.y+b.backY-depth,Math.min(a.y,b.y),Math.max(a.y+a.h,b.y+b.h)-h]:[a.wallSide==='top'||a.wallSide==='right'?Math.max(cross(a)+a.h,cross(b)+b.h)-h:Math.min(cross(a),cross(b))];
        let fitted=false;for(const origin of [...new Set(origins)]){merged[axis]=origin;if(!placementError(merged,other,env,settings)){fitted=true;break;}}
        if(!fitted)continue;
        groups.splice(j,1);groups[i]=merged;changed=true;break search;
      }
    }
  }
  function compactGround(layout,plan,settings){
    if(layout.version!==2)throw new Error('Ground line compaction requires a generated greenfield layout.');
    compactGroundGroups(layout.groups,layout.env,settings);Object.assign(layout,validate(layout,plan,settings));return layout;
  }
  function freeRackIntervals(block,y,left,right,groups,env,settings){
    const g=settings.gangwayWidth,storage=rect({x:left,y,w:right-left,h:block.h}),faces=[rect({x:left-g,y:y-g,w:right-left+2*g,h:g})];
    if(block.paired)faces.push(rect({x:left-g,y:y+block.h,w:right-left+2*g,h:g}));
    const bad=[...diff([storage],env.zone),...intersect([storage],env.baseAccess),...diff(faces,env.boundary),...intersect(faces,env.blocked)];
    for(const other of groups){const fixed=cachedPlacement(other,env,g);bad.push(...intersect([storage],[rect(fixed.r)]),...intersect([storage],fixed.access.map(rect)),...intersect(faces,[rect(fixed.r)]));}
    const cuts=bad.filter(p=>C.Clipper.Area(p)>E*S*S).map(p=>rectBounds(points(p))).map(b=>[Math.max(left,b.x),Math.min(right,b.x+b.w)]).filter(([a,b])=>b>a+E).sort((a,b)=>a[0]-b[0]),merged=[];
    for(const cut of cuts){const prev=merged.at(-1);if(prev&&cut[0]<=prev[1]+E)prev[1]=Math.max(prev[1],cut[1]);else merged.push([...cut]);}
    const free=[];let start=left;for(const [a,b]of merged){if(a-start>=block.w-E)free.push([start,a]);start=Math.max(start,b);}if(right-start>=block.w-E)free.push([start,right]);return free;
  }
  async function findRackPose(block,groups,env,settings){
    const gap=settings.gangwayWidth,regions=(env.regions||[{points:env.poly}]).map(r=>L.bounds(r.points)).sort((a,b)=>a.minY-b.minY||a.minX-b.minX),occupied=[...env.obstacles.map(o=>o.bounds),...groups.map(groupRect)];
    for(const b of regions){if(b.maxX-b.minX<block.w-E||b.maxY-b.minY<block.h+gap-E)continue;
      const ys=[b.minY+gap,b.maxY-block.h-gap,...occupied.flatMap(r=>[r.y+r.h+gap,r.y-block.h-gap]),...env.zone.flatMap(points).flatMap(p=>[p[1]+gap,p[1]-block.h-gap])];
      for(let y=b.minY+gap;y+block.h+gap<=b.maxY+E;y+=block.h+gap)ys.push(y);
      for(const y of [...new Set(ys.map(v=>Math.round(v*S)/S))].filter(y=>y>=b.minY-E&&y+block.h<=b.maxY+E).sort((a,b)=>a-b)){
        for(const [left,right]of freeRackIntervals(block,y,b.minX,b.maxX,groups,env,settings))for(const x of [...new Set([left,left+gap,right-block.w,right-block.w-gap])]){
          if(x<left-E||x+block.w>right+E)continue;const trial={...block,x,y,wallSide:null};if(!placementError(trial,groups,env,settings))return trial;
        }
      }
      await tick();
    }return null;
  }
  async function recoverRackBays(unplaced,groups,env,settings,options){
    const pending=unplaced.filter(g=>g.kind==='rack').flatMap(g=>g.objects);if(!pending.length)return;
    for(let i=unplaced.length-1;i>=0;i--)if(unplaced[i].kind==='rack')unplaced.splice(i,1);
    while(pending.length){const first=pending.shift(),next=pending[0],canPair=next&&next.typeId===first.typeId&&Math.abs(next.h-first.h)<E,separation=options.backToBackSeparation||0;
      const single={id:'rack-fit:'+first.id,kind:'rack',frame:env.frame,w:first.w,h:first.h,paired:false,rows:1,separation:0,backY:0,objects:[{...first,dx:0,dy:0}]};
      let placed=null;if(canPair){const pair={...single,h:first.h+separation+next.h,paired:true,rows:2,separation,backY:first.h,objects:[single.objects[0],{...next,dx:0,dy:first.h+separation}]};placed=await findRackPose(pair,groups,env,settings);if(placed)pending.shift();}
      if(!placed)placed=await findRackPose(single,groups,env,settings);
      if(placed)groups.push(placed);else unplaced.push({...single,unplacedReason:'No remaining shelf footprint and loading aisle fit outside the configured clearances in any usable region.'});
    }
  }
  async function pack(plan,settings,geometry,options,orientation,sx,sy,fraction,startOffset,source=L.makeObjects(plan,settings)){
    const env=environment(geometry,options,settings,orientation,sx,sy),groups=[],unplaced=[],blocks=makeBlocks(source,env,settings,options,fraction),g=settings.gangwayWidth;
    wallAccess(env,blocks,options,settings);
    const pendingGround=blocks.filter(block=>block.groundPending);for(let i=blocks.length-1;i>=0;i--)if(blocks[i].groundPending)blocks.splice(i,1);
    const wallDepth=Math.max(0,...blocks.filter(b=>b.wallSide==='bottom').map(b=>b.h));
    let y=env.inner.minY+g+(wallDepth||options.racksAroundWalls?0:startOffset),x=env.inner.minX+g,band=0;
    const left=x,right=env.inner.maxX-g,top=env.inner.maxY,rejected=new Map();let lastYield=Date.now();
    for(let i=0;i<blocks.length;i++){
      if(i%32===0)await tick();const block=blocks[i];let result=null,lastError="No remaining valid storage band.";
      if(block.wallSide&&options.racksAroundWalls){const trial=wallPose(block,env,options);lastError=placementError(trial,groups,env,settings);if(!lastError)result=trial;}else if(block.wallSide){const starts=[env.box.minX+options.wallClearance,env.box.maxX-options.wallClearance-block.w,...env.obstacles.map(o=>o.bounds.x+o.bounds.w+options.obstacleClearance)];for(const wallX of starts){const trial={...block,x:wallX,y:block.wallSide==='bottom'?env.box.minY+options.wallClearance:env.box.maxY-options.wallClearance-block.h};lastError=placementError(trial,groups,env,settings);if(!lastError){result=trial;break;}}}
      const groundSide=orientation==='vertical'?options.groundStartVertical:options.groundStartHorizontal;
      if(!result&&!block.wallSide&&block.kind==='ground'&&groundSide){
        const angle=buildingAngle(env.poly.map(p=>toWorld(p,env.frame))),v=groundSide==='right'?[1,0]:groundSide==='left'?[-1,0]:groundSide==='top'?[0,1]:[0,-1],c=Math.cos(angle),sn=Math.sin(angle),direction=toLocal([v[0]*c-v[1]*sn,v[0]*sn+v[1]*c],env.frame)[1],occupied=[...env.obstacles.map(o=>o.bounds),...env.doors.map(o=>o.bounds),...groups.map(groupRect)],ys=[env.inner.minY+g,top-block.h-g,...occupied.flatMap(r=>[r.y,r.y+r.h-block.h,r.y+r.h+g,r.y-block.h-g])].filter(v=>v>=env.inner.minY+g-E&&v+block.h<=top-g+E).sort((a,b)=>direction>0?b-a:a-b),xs=[left,...occupied.flatMap(r=>[r.x+r.w+options.obstacleClearance,r.x+r.w+g,r.x-block.w-g])].filter(v=>v>=left-E&&v+block.w<=right+E).sort((a,b)=>a-b);
        const uniqueXs=[...new Set(xs)],uniqueYs=[...new Set(ys)];
        searchGround:for(const py of uniqueYs)for(const px of uniqueXs){if(Date.now()-lastYield>20){await tick();lastYield=Date.now();}const trial={...block,wallSide:null,x:px,y:py},key=[block.w,block.h,!!block.rotated,px,py].join(':');lastError=rejected.get(key)||placementError(trial,groups,env,settings);if(!lastError){result=trial;break searchGround;}if(rejected.size<100000)rejected.set(key,lastError);} // Failed non-wall ground poses stay invalid as occupied storage only grows.
      }
      if(!result&&!block.wallSide&&!(block.kind==='ground'&&groundSide)){let px=x,py=y,depth=band,attempt=0;
        while(py+block.h+(block.paired?g:0)<=top+E&&attempt++<160){
          if(px+block.w>right+E){py+=Math.max(depth,block.h)+g;px=left;depth=0;continue;}
          const trial={...block,wallSide:null,x:px,y:py};
          lastError=placementError(trial,groups,env,settings);if(!lastError){result=trial;x=px+block.w;y=py;band=Math.max(depth,block.h);break;}
          const occupied=[...env.obstacles.map(o=>o.bounds),...env.doors.map(o=>o.bounds),...groups.map(groupRect)],next=occupied.filter(o=>o.y<py+block.h+g&&o.y+o.h>py-g&&o.x+o.w>px+E).map(o=>o.x+o.w+options.obstacleClearance).sort((a,b)=>a-b)[0];
          if(next&&next+block.w<=right+E)px=next;else{const obstacleTop=env.obstacles.filter(o=>o.bounds.y<=py+block.h+g&&o.bounds.y+o.bounds.h>py).map(o=>o.bounds.y+o.bounds.h+options.obstacleClearance+g).sort((a,b)=>a-b)[0];py=Math.max(py+Math.max(depth,block.h)+g,obstacleTop??-Infinity);px=left;depth=0;}
        }
      }
      if(result){groups.push(result);if(result.wallSide==='bottom'&&!options.racksAroundWalls){y=Math.max(y,result.y+result.h+g);x=left;band=0;}}else if(block.paired&&block.kind==='rack'){const a=block.objects.filter(o=>o.dy===0),b=block.objects.filter(o=>o.dy>0);for(const row of [a,b])if(row.length)blocks.push({...block,id:'single:'+row[0].id,paired:false,rows:1,separation:0,backY:0,h:row[0].h,w:row.reduce((n,o)=>n+o.w,0),objects:row.map(o=>({...o,dy:0})),wallSide:null});}else unplaced.push({...block,unplacedReason:lastError});
    }
    if(env.analysis)await recoverRackBays(unplaced,groups,env,settings,options);
    await placeGroundLanes(pendingGround,env,settings,options,orientation,groups,unplaced);
    compactGroundGroups(groups,env,settings);
    const layout={version:2,orientation,groups,unplaced,env,options:{...options},issues:[...source.issues,...env.errors],rackRequired:source.rackRequired,groundRequired:source.groundRequired,search:{sx,sy,rowFraction:fraction,startOffset},buildingAngle:buildingAngle(geometry.entities.find(e=>e.id===options.boundaryId).points),geometryUnverified:geometry.unreadableEntities||0};
    Object.assign(layout,validate(layout,plan,settings,source));return layout;
  }
  function placedObjects(g){
    return g.objects.map(o=>{const x=g.x+(g.rotated?g.h-o.dy-o.h:o.dx),y=g.y+(g.rotated?o.dx:o.dy),w=g.rotated?o.h:o.w,h=g.rotated?o.w:o.h,p=L.corners({x,y,w,h}).map(p=>toWorld(p,g.frame)),center=toWorld([x+w/2,y+h/2],g.frame),origin=p[0];
      const localAngle=g.rotated?Math.PI/2:0,drawAngle=(g.frame.angle+Math.atan2(g.frame.sy*Math.sin(localAngle),g.frame.sx*Math.cos(localAngle)))*180/Math.PI;
      const frameLines=o.kind==='rack'?[o.structuralLength/2,o.w-o.structuralLength/2].map(dx=>{const a=[o.dx+dx,o.dy],b=[o.dx+dx,o.dy+o.h];return [a,b].map(([u,v])=>toWorld([g.x+(g.rotated?g.h-v:u),g.y+(g.rotated?u:v)],g.frame));}):[];
      return {...o,x:origin[0],y:origin[1],w,h,points:p,center,drawAngle,rotation:(o.rotation+drawAngle+360)%360,frameLines,groupId:g.id};});
  }
  function regionShapes(ps,frame,kind,prefix){return ps.map((p,i)=>({id:prefix+':'+i,kind,points:points(p).map(p=>toWorld(p,frame)),...rectBounds(points(p).map(p=>toWorld(p,frame))),hole:C.Clipper.Area(p)<0}));}
  function connected(ps){const tree=new C.PolyTree(),c=new C.Clipper();if(!ps.length)return false;c.AddPaths(ps,C.PolyType.ptSubject,true);c.Execute(C.ClipType.ctUnion,tree,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);return tree.Childs().length===1;}
  function groundMarkings(layout){
    if(layout.version===3)return [];
    const horizontal=new Map(),vertical=new Map(),frame=layout.env.frame||{angle:0,sx:1,sy:1};
    function line(a,b){const flat=Math.abs(a[1]-b[1])<E,map=flat?horizontal:vertical,key=Math.round((flat?a[1]:a[0])*S),u=flat?0:1;if(!map.has(key))map.set(key,[]);map.get(key).push([Math.round(Math.min(a[u],b[u])*S),Math.round(Math.max(a[u],b[u])*S)]);}
    for(const g of layout.groups.filter(g=>g.kind==='ground')){
      const at=([x,y])=>[g.x+(g.rotated?g.h-y:x),g.y+(g.rotated?x:y)],outline=[[0,0],[g.w,0],[g.w,g.h],[0,g.h]];
      outline.forEach((p,i)=>line(at(p),at(outline[(i+1)%4])));
      if(g.centerLine)line(at(g.centerLine[0]),at(g.centerLine[1]));
      for(const row of g.groundRows||[{x:0,y:0,w:g.w,h:g.h,objectIds:g.objects.map(o=>o.id)}]){
        const edges=[[row.x,row.y],[row.x+row.w,row.y],[row.x+row.w,row.y+row.h],[row.x,row.y+row.h]];edges.forEach((p,i)=>line(at(p),at(edges[(i+1)%4])));
        const ids=new Set(row.objectIds),objects=g.objects.filter(o=>ids.has(o.id)).sort((a,b)=>a.dy-b.dy);
        for(let i=1;i<objects.length;i++){const before=objects[i-1],after=objects[i],y=(before.dy+before.h+after.dy)/2;line(at([row.x,y]),at([row.x+row.w,y]));}
      }
    }
    const result=[];
    for(const [map,flat]of [[horizontal,true],[vertical,false]])for(const [key,ranges]of [...map.entries()].sort((a,b)=>a[0]-b[0])){
      const merged=[];for(const r of ranges.sort((a,b)=>a[0]-b[0])){const prev=merged[merged.length-1];if(prev&&r[0]<=prev[1]+1)prev[1]=Math.max(prev[1],r[1]);else merged.push([...r]);}
      for(const [a,b]of merged){if(b<=a)continue;const p=(flat?[[a/S,key/S],[b/S,key/S]]:[[key/S,a/S],[key/S,b/S]]).map(v=>toWorld(v,frame)),bounds=rectBounds(p);result.push({id:'ground-marking:'+result.length,kind:'marking',points:p,...bounds,w:Math.max(0.1,bounds.w),h:Math.max(0.1,bounds.h)});}
    }
    return result;
  }
  function shortage(layout,plan,settings,validGroups=null,source=null){
    if(layout.version===3)return scope.LogEnExistingLayout.summary(layout,plan,settings).shortage;
    const valid=validGroups||layout.groups.filter(g=>layout.version!==2||!placementError(g,layout.groups,layout.env,settings)),placed=new Set(),quantities=new Map(),areas=new Map(),represented=new Map();
    for(const g of valid)for(const o of g.objects){placed.add(o.id);if(o.kind==='rack')for(const a of o.allocations)quantities.set(a.pn,(quantities.get(a.pn)||0)+1);else quantities.set(o.pn,(quantities.get(o.pn)||0)+o.quantity);}
    const contribute=(pn,qty,area)=>{areas.set(pn,(areas.get(pn)||0)+area);represented.set(pn,(represented.get(pn)||0)+qty);};
    for(const g of (source||L.makeObjects(plan,settings)).groups){
      if(g.kind==='rack'){for(const o of g.objects){if(placed.has(o.id)||!o.allocations.length)continue;const counts=new Map();for(const a of o.allocations)counts.set(a.pn,(counts.get(a.pn)||0)+1);for(const [pn,n]of counts)contribute(pn,n,o.w*o.h/1e6*n/o.allocations.length);}}
      else{const missing=g.objects.filter(o=>!placed.has(o.id));if(missing.length){const byPN=new Map();for(const o of missing)byPN.set(o.pn,(byPN.get(o.pn)||0)+o.quantity);const total=missing.reduce((n,o)=>n+o.quantity,0),area=g.w*g.h/1e6*missing.length/g.objects.length;for(const [pn,n]of byPN)contribute(pn,n,area*n/total);}}
    }
    const rows=[];
    for(const r of plan.rows){const n=r.required===null?null:Math.max(0,r.required-(quantities.get(r.input.partNumber)||0));if(n===0)continue;const areaKnown=n!==null&&(represented.get(r.input.partNumber)||0)>=n;rows.push({pn:r.input.partNumber,required:r.required,placed:quantities.get(r.input.partNumber)||0,missingPallets:n,areaWithoutGangways:areas.get(r.input.partNumber)||0,areaKnown,reason:r.errors.join(' ')});}
    const unique=new Map();for(const row of rows){if(unique.has(row.pn)){const prior=unique.get(row.pn);unique.set(row.pn,{...prior,required:null,missingPallets:null,areaKnown:false,reason:'Duplicate part number: quantity requires review. '+prior.reason});}else unique.set(row.pn,row);}rows.splice(0,rows.length,...unique.values());
    return {partNumbers:rows.length,pallets:rows.reduce((n,r)=>n+(r.missingPallets||0),0),unknownQuantityPartNumbers:rows.filter(r=>r.missingPallets===null).length,areaWithoutGangways:rows.reduce((n,r)=>n+r.areaWithoutGangways,0),unknownAreaPartNumbers:rows.filter(r=>!r.areaKnown).length,rows};
  }
  function metrics(layout,settings){
    const e=layout.env,rack=union(layout.groups.filter(g=>g.kind==='rack').flatMap(g=>g.objects.map(o=>rect(localObjectRect(g,o))))),ground=union(layout.groups.filter(g=>g.kind==='ground').map(g=>rect(groupRect(g)))),storage=union([...rack,...ground]),access=union([...e.baseAccess,...endGangways(layout),...layout.groups.flatMap(g=>accessFor(g,e,settings.gangwayWidth).map(rect))]);
    const safety=diff(union([...diff(e.blocked,e.physical),...e.wallSafety,...(e.storageBlocked||[]),...e.doorZones,...layout.groups.filter(g=>g.paired&&g.separation>0).map(g=>rect({x:g.x,y:g.y+g.backY,w:g.w,h:g.separation}))]),union([...access,...storage]));
    const free=diff(e.boundary,union([...storage,...access,...safety,...e.physical]));
    // Component areas use polygon clipping, including holes. Fit probes classify remaining components conservatively.
    const templateSizes=new Set();
    const outer=free.filter(p=>C.Clipper.Area(p)>0),holes=free.filter(p=>C.Clipper.Area(p)<0),templates=layout.groups.concat(layout.unplaced).flatMap(g=>g.objects.map(o=>({w:o.w,h:o.h}))).filter(v=>{const key=v.w+':'+v.h;if(templateSizes.has(key))return false;templateSizes.add(key);return true;}).sort((a,b)=>a.w*a.h-b.w*b.h).slice(0,6);
    let unusable=0;
    for(const p of (templates.length?outer:[])){const region=[p,...holes.filter(h=>C.Clipper.PointInPolygon(h[0],p)!==0)],b=regionBounds([p]),probes=points(p);let usable=false;
      for(const t of templates){if(t.w>b.maxX-b.minX+E||t.h>b.maxY-b.minY+E)continue;const xs=[b.minX,b.maxX-t.w,(b.minX+b.maxX-t.w)/2,...probes.map(v=>v[0])],ys=[b.minY,b.maxY-t.h,(b.minY+b.maxY-t.h)/2,...probes.map(v=>v[1])];for(const x of xs.slice(0,8)){for(const y of ys.slice(0,8))if(fits({x,y,w:t.w,h:t.h},region)){usable=true;break;}if(usable)break;}if(usable)break;}
      if(!usable)unusable+=area(region);
    }
    const footprint=polygonArea(storage),total=polygonArea(e.boundary),clearance=polygonArea(safety),gangway=polygonArea(access),obstacle=polygonArea(e.physical),unused=polygonArea(free),sep=layout.groups.reduce((n,g)=>n+(g.paired?g.w*g.separation:0),0)/1e6;
    return {newGangwayArea:polygonArea(diff(access,e.existingAccess||[])),placedStorageArea:footprint,remainingUnoccupiedArea:unused,grossIdentifiedArea:e.analysis?.grossArea??total,excludedArea:e.analysis?.excludedArea??polygonArea(e.physical),netStorageEligibleArea:e.analysis?.netArea??polygonArea(e.zone),detectedRegions:e.analysis?.regionCount??1,totalWarehouseArea:total,availableStorageArea:polygonArea(diff(e.zone,e.baseAccess)),rackFootprint:polygonArea(rack),groundFootprint:polygonArea(ground),gangwayArea:gangway,mandatoryClearanceArea:clearance,obstacleArea:obstacle,unusedUsableArea:Math.max(0,unused-unusable/1e6),unusableArea:unusable/1e6,wallRackBays:layout.groups.filter(g=>g.wallSide&&g.kind==='rack').reduce((n,g)=>n+g.objects.length,0),racks:layout.groups.filter(g=>g.kind==='rack').reduce((n,g)=>n+g.objects.length,0),rackPositions:layout.generatedRack,groundPositions:layout.generatedGround,accommodatedPallets:layout.accommodatedPallets,requiredPallets:layout.requiredPallets,utilizationPercent:total>0?footprint/total*100:0,connected:connected(access),accessPaths:access,clearancePaths:safety,freePaths:free};
  }
  function validate(layout,plan,settings,source=null){
    const errors=[...layout.issues],valid=[],ids=new Set(),objectIds=new Set(),expected=new Set((source||L.makeObjects(plan,settings)).groups.flatMap(g=>g.objects.map(o=>o.id)));
    for(const g of layout.groups){let error=placementError(g,layout.groups,layout.env,settings);for(const o of g.objects){if(objectIds.has(o.id)||(!expected.has(o.id)&&!o.manualEmpty))error='Duplicate or unknown storage object.';objectIds.add(o.id);}if(ids.has(g.id)||error)errors.push({pn:g.objects.map(o=>o.pn||o.typeName).join(', '),message:error||'Duplicate block identity.'});else valid.push(g);ids.add(g.id);}
    const rack=new Map(),ground=new Map();let generatedRack=0,generatedGround=0,groundPallets=0;
    for(const g of valid)for(const o of g.objects){if(o.kind==='rack')for(const a of o.allocations){generatedRack++;rack.set(a.pn,(rack.get(a.pn)||0)+1);}else if(!o.manualEmpty){generatedGround++;groundPallets+=o.quantity;ground.set(o.pn,(ground.get(o.pn)||0)+o.quantity);}}
    const affected=plan.rows.filter(r=>r.required===null||r.errors.length||(rack.get(r.input.partNumber)||0)!==r.rackPallets||(ground.get(r.input.partNumber)||0)!==r.groundPallets).map(r=>({pn:r.input.partNumber,message:r.errors.join(' ')||`Rack pallets ${rack.get(r.input.partNumber)||0}/${r.rackPallets}; ground pallets ${ground.get(r.input.partNumber)||0}/${r.groundPallets}`}));
    const result={generatedRack,generatedGround,unplacedRack:Math.max(0,layout.rackRequired-generatedRack),unplacedGround:Math.max(0,layout.groundRequired-generatedGround),affected,validationErrors:errors,accommodatedPallets:generatedRack+groundPallets,requiredPallets:plan.rows.reduce((n,r)=>n+(r.required||0),0)};
    Object.assign(layout,result);const m=metrics(layout,settings);if(!m.connected&&(layout.env.analysis?.regionCount||1)===1)errors.push({pn:'Circulation',message:'Forklift circulation is disconnected. This candidate is invalid.'});
    const baseSafety=m.connected&&!!layout.options.constraintsConfirmed&&!!layout.options.geometryReviewed&&!layout.geometryUnverified&&!(layout.env.analysis?.warnings.length);
    Object.assign(result,{metrics:m,accessValid:errors.length===0,safetyVerified:baseSafety,complete:!affected.length&&!errors.length&&!layout.unplaced.length,aisles:regionShapes(m.accessPaths,layout.env.frame,'aisle','aisle'),clearances:regionShapes(m.clearancePaths,layout.env.frame,'clearance','clearance'),shortage:shortage(layout,plan,settings,valid,source),markings:groundMarkings(layout)});
    return result;
  }
  const rank=l=>[l.accessValid?1:0,l.accommodatedPallets,l.complete?1:0,l.options.racksAroundWalls?l.metrics.wallRackBays:0,-l.metrics.unusableArea,-l.metrics.gangwayArea,-l.groups.length];
  function better(a,b){if(!b)return true;const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++){if(Math.abs(x[i]-y[i])>1e-5)return x[i]>y[i];}return false;}
  async function optimize(plan,settings,geometry,rawOptions,onProgress=()=>{}){
    if(!plan.available)throw new Error(plan.errors.join(' '));if(!(settings.gangwayWidth>0))throw new Error('Enter a positive gangway width.');
    if(rawOptions.existingMode)return scope.LogEnExistingLayout.generate(plan,settings,geometry,rawOptions,onProgress);
    const options=normalizedOptions(rawOptions),source=L.makeObjects(plan,settings);if(source.groups.reduce((n,g)=>n+g.objects.length,0)>10000)throw new Error('Select a category to keep the drawing within 10,000 objects.');
    const alternatives={};let n=0;const hasRacks=source.groups.some(g=>g.kind==='rack'),fractions=hasRacks?[1,0.5]:[1],shifts=options.racksAroundWalls?[0]:[0,settings.gangwayWidth/2],jobs=[];
    for(const orientation of ['horizontal','vertical']){let best=null;const side=options.allowWallStorage&&options.wallRackMode!=='all'?options.wallRackMode:null,starts=[[1,1],[-1,1],[1,-1],[-1,-1]].filter(([sx,sy])=>!side||(orientation==='horizontal'?(side==='left'?sx===1:side==='right'?sx===-1:side==='top'?sy===-1:sy===1):(side==='left'?sy===-1:side==='right'?sy===1:side==='top'?sx===-1:sx===1)));for(const [sx,sy]of starts)for(const fraction of fractions)for(const shift of side?[0]:shifts)jobs.push({orientation,sx,sy,fraction,shift});}
    for(const job of jobs){onProgress(++n,jobs.length,job);await tick();const {orientation,sx,sy,fraction,shift}=job,candidate=await pack(plan,settings,geometry,options,orientation,sx,sy,fraction,shift,source);if(better(candidate,alternatives[orientation]))alternatives[orientation]=candidate;}
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
  scope.LogEnOptimizer=Object.freeze({optimize,recommend,validate,move,compactGround,placedObjects,groundMarkings,shortage,toWorld,toLocal,geometry:Object.freeze({path,points,area,union,diff,intersect,offset,fits}),buildingAngle});
})(globalThis);
