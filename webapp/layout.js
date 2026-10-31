/* Physical layout uses the Warehouse Designer result, never a new demand formula. */
(function(scope){
  'use strict';
  const EPS=0.001;
  const positive=v=>Number.isFinite(v)&&v>0;
  const bounds=points=>({minX:Math.min(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxX:Math.max(...points.map(p=>p[0])),maxY:Math.max(...points.map(p=>p[1]))});
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
  function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if(distance(p,a,b)<EPS)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  const edges=poly=>poly.map((a,i)=>[a,poly[(i+1)%poly.length]]);
  const properCross=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS;
  function intersectsPolygon(r,poly){const pts=corners(r);return pts.some(p=>inside(p,poly))||poly.some(p=>inside(p,pts))||edges(pts).some(([a,b])=>edges(poly).some(([c,d])=>properCross(a,b,c,d)));}
  function validPolygon(poly){return Array.isArray(poly)&&poly.length>=3&&poly.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite))&&Math.abs(poly.reduce((n,p,i)=>n+p[0]*poly[(i+1)%poly.length][1]-p[1]*poly[(i+1)%poly.length][0],0))>EPS&&!edges(poly).some(([a,b],i)=>edges(poly).some(([c,d],j)=>j>i+1&&!(i===0&&j===poly.length-1)&&properCross(a,b,c,d)));}
  function corners(r){return [[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]];}
  function contained(r,poly,margin=0){
    const pts=corners(r);if(!pts.every(p=>inside(p,poly)))return false;
    if(poly.some(p=>p[0]>r.x+EPS&&p[0]<r.x+r.w-EPS&&p[1]>r.y+EPS&&p[1]<r.y+r.h-EPS))return false;
    for(const [a,b] of edges(pts)){
      const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy||1;
      const cuts=[0,1,...poly.filter(p=>distance(p,a,b)<EPS).map(p=>((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)].sort((x,y)=>x-y);
      for(let i=1;i<cuts.length;i++){const t=(cuts[i-1]+cuts[i])/2;if(!inside([a[0]+dx*t,a[1]+dy*t],poly))return false;}
      for(const [c,d] of edges(poly)){if(properCross(a,b,c,d))return false;if(margin>EPS&&Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<margin-EPS)return false;}
    }
    return true;
  }
  const overlaps=(a,b,g=0)=>a.x<b.x+b.w+g-EPS&&a.x+a.w+g>b.x+EPS&&a.y<b.y+b.h+g-EPS&&a.y+a.h+g>b.y+EPS;
  const expand=(r,g)=>({x:r.x-g,y:r.y-g,w:r.w+2*g,h:r.h+2*g});
  const rectFromBounds=b=>({x:b.minX,y:b.minY,w:Math.max(EPS,b.maxX-b.minX),h:Math.max(EPS,b.maxY-b.minY)});
  function sourceKey(plan,settings,config,stamp){return JSON.stringify({stamp,rows:plan.rows.map(r=>[r.input,r.required,r.rackPallets,r.groundPallets,r.ground]),rack:plan.rack.bayLayouts?.map(b=>[b.typeId,b.settings,b.shelves.map(sh=>sh.placements)]),settings,wall:!!config.allowWallStorage,optimizer:3,orientation:config.warehouseOrientation||"auto",backToBackSeparation:config.backToBackSeparation||0,wallClearance:config.wallClearance||0});}
  function makeObjects(plan,settings){
    const groups=[],issues=[];let rackRequired=0,groundRequired=0;
    for(const row of plan.rows){if(row.errors.length||row.required===null)issues.push({pn:row.input.partNumber,message:row.errors.join(' ')||'Required quantity is unavailable.'});rackRequired+=row.rackPallets||0;}
    if(!plan.rack.available&&rackRequired)issues.push({pn:'Rack allocation',message:plan.rack.error||'An explicit rack position allocation is required.'});
    let run=null;const ordinals=new Map();
    for(const bay of plan.rack.bayLayouts||[]){
      const t=bay.settings,w=t.rackSlotLength+t.rackStructuralLength,h=t.rackSlotDepth+t.rackStructuralDepth;
      if(![w,h,t.maxRackRunLength,t.rackLevels].every(positive)){issues.push({pn:bay.typeName,message:'Invalid rack dimensions or levels.'});continue;}
      if(w>t.maxRackRunLength+EPS){issues.push({pn:bay.typeName,message:'A rack bay exceeds its maximum run length.'});continue;}
      const n=(ordinals.get(bay.typeId)||0)+1;ordinals.set(bay.typeId,n);
      if(!run||run.typeId!==bay.typeId||run.w+w>t.maxRackRunLength+EPS){run={id:`run:${bay.typeId}:${n}`,kind:'rack',typeId:bay.typeId,w:0,h,objects:[]};groups.push(run);}
      const allocations=bay.shelves.flatMap(sh=>sh.placements.map((p,i)=>({pn:p.partNumber,level:sh.level,position:i+1,length:p.length,depth:p.depth,x:p.x,y:p.y,z:p.z,height:p.height,depthRow:p.depthRow||1,stackLayer:p.stackLayer||1})));
      run.objects.push({id:`rack:${bay.typeId}:${n}`,kind:'rack',dx:run.w,dy:0,w,h,rotation:0,bayNumber:bay.number,typeName:bay.typeName,typeId:bay.typeId,maxRunLength:t.maxRackRunLength,levels:t.rackLevels,structuralLength:t.rackStructuralLength,structuralDepth:t.rackStructuralDepth,allocations,pallets:allocations.length});run.w+=w;
    }
    for(const row of plan.rows){
      if(!row.groundPallets)continue;
      const f=row.ground,p=row.input;
      if(row.errors.length||!f||![p.length,p.width,p.height,f.floorLength,f.floorWidth,f.effectiveStacking,f.palletsPerRow].every(positive)||!Number.isSafeInteger(f.positions)){issues.push({pn:p.partNumber,message:'Ground dimensions, positions or stacking are unavailable.'});continue;}
      groundRequired+=f.positions;
      const objectWidth=f.floorRotated?p.length:p.width,objectDepth=f.floorRotated?p.width:p.length;
      let pallets=row.groundPallets,index=0;
      while(index<f.positions){const count=Math.min(f.palletsPerRow,f.positions-index),g={id:`ground-row:${p.partNumber}:${index+1}`,kind:'ground',w:f.floorWidth,h:f.rowDepth*1000,objects:[]};
        for(let k=0;k<count;k++){const qty=Math.min(f.effectiveStacking,pallets);pallets-=qty;g.objects.push({id:`ground:${p.partNumber}:${index+1}`,kind:'ground',pn:p.partNumber,dx:(f.floorWidth-objectWidth)/2,dy:k*f.floorLength+(f.floorLength-objectDepth)/2,w:objectWidth,h:objectDepth,rotation:f.floorRotated?0:90,length:p.length,width:p.width,height:p.height,quantity:qty,stacking:f.effectiveStacking,position:index+1});index++;}
        if(settings.maxFloorRowDepth>0&&g.h>settings.maxFloorRowDepth+EPS)issues.push({pn:p.partNumber,message:'Ground row exceeds maximum row depth.'});else groups.push(g);
      }
    }
    return {groups,issues,rackRequired,groundRequired};
  }
  function environment(geometry,options){
    const scale=options.scale,entity=geometry.entities.find(e=>e.id===options.boundaryId);
    if(!positive(scale)||!entity?.boundaryEligible)throw new Error('Select drawing units and a closed, straight 2D warehouse boundary.');
    const poly=entity.points.map(p=>[p[0]*scale,p[1]*scale]);if(!validPolygon(poly))throw new Error('The selected boundary is invalid or self-intersecting.');
    const box=bounds(poly),obstacles=[],doors=[];
    for(const e of geometry.entities){if(e.id===entity.id)continue;const role=options.entityRoles?.[e.id]||options.layerRoles?.[e.layer]||'obstacle';if(role==='reference')continue;
      const r=rectFromBounds({minX:e.bounds[0]*scale,minY:e.bounds[1]*scale,maxX:e.bounds[2]*scale,maxY:e.bounds[3]*scale});
      (role==='door'?doors:obstacles).push({...r,id:e.id});
    }
    for(const [i,r] of (options.manualObstacles||[]).entries()){if(![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0)throw new Error('Reserved areas need valid coordinates and positive dimensions in mm.');obstacles.push({...r,id:'reserved:'+i});}
    if(!Number.isFinite(options.obstacleClearance)||options.obstacleClearance<0)throw new Error('Enter a non-negative obstacle clearance.');
    return {poly,box,obstacles,doors,scale,boundaryId:entity.id};
  }
  function placedObjects(group){if(group.frame)return scope.LogEnOptimizer.placedObjects(group);return group.objects.map(o=>({...o,x:group.x+(group.rotated?group.h-o.dy-o.h:o.dx),y:group.y+(group.rotated?o.dx:o.dy),w:group.rotated?o.h:o.w,h:group.rotated?o.w:o.h,rotation:(o.rotation+(group.rotated?90:0))%360,groupId:group.id}));}
  const groupRect=g=>({x:g.x,y:g.y,w:g.rotated?g.h:g.w,h:g.rotated?g.w:g.h});
  function aisleFor(g,env,gangway){const r=groupRect(g);return {x:env.spine.x+env.spine.w,y:g.y-gangway,w:Math.max(0,r.x+r.w-env.spine.x-env.spine.w),h:gangway};}
  function placementError(group,placed,env,settings,options){
    const r=groupRect(group),margin=options.allowWallStorage?0:settings.gangwayWidth,a=aisleFor(group,env,settings.gangwayWidth);
    if(!contained(r,env.poly,margin))return 'Storage crosses the warehouse boundary or perimeter gangway.';
    if(r.x<env.spine.x+env.spine.w-EPS)return 'Storage blocks the main access gangway.';
    if(!contained(a,env.poly))return 'The access gangway leaves the warehouse boundary.';
    const spine={x:env.spine.x,y:Math.min(env.spine.y,a.y),w:env.spine.w,h:Math.max(a.y+a.h-env.spine.y,env.spine.h)};
    if(!contained(spine,env.poly))return 'The main access gangway is interrupted by the warehouse boundary.';
    for(const route of env.routes||[])if(overlaps(r,route))return 'Storage blocks a reserved door or exit access route.';
    for(const obstacle of env.obstacles)if(overlaps(r,obstacle,options.obstacleClearance)||overlaps(a,obstacle,options.obstacleClearance)||overlaps(spine,obstacle,options.obstacleClearance))return 'Storage or its access gangway intersects an obstacle clearance.';
    for(const door of env.doors)if(overlaps(r,door,Math.max(settings.gangwayWidth,options.obstacleClearance)))return 'Storage blocks a door, exit or its access clearance.';
    if(overlaps(r,env.spine))return 'Storage intersects the main gangway.';
    for(const other of placed){if(other.id===group.id)continue;const rr=groupRect(other),aa=aisleFor(other,env,settings.gangwayWidth);if(overlaps(r,rr)||overlaps(r,aa)||overlaps(a,rr))return 'Storage overlaps another row/run or a reserved gangway.';}
    return null;
  }
  function generate(plan,settings,geometry,options,previous=null){
    if(!plan.available)throw new Error(plan.errors.join(' '));if(!(settings.gangwayWidth>0))throw new Error('Physical layout needs a gangway width greater than zero.');
    const env=environment(geometry,options),source=makeObjects(plan,settings),g=settings.gangwayWidth,margin=options.allowWallStorage?0:g;
    env.spine={x:env.box.minX+margin,y:env.box.minY,w:g,h:0};
    env.routes=[];
    if(env.doors.length){
      env.spine.h=env.box.maxY-env.box.minY;
      for(const door of env.doors){const cx=door.x+door.w/2,y=Math.max(env.box.minY,Math.min(env.box.maxY-g,door.y+door.h/2-g/2)),left=Math.min(cx,env.spine.x),right=Math.max(cx,env.spine.x+g);env.routes.push({x:left,y,w:right-left,h:g,id:'aisle:door:'+door.id,kind:'aisle'});}
      for(const route of [env.spine,...env.routes])if(!contained(route,env.poly)||env.obstacles.some(o=>overlaps(route,o,options.obstacleClearance)))source.issues.push({pn:'Door / exit access',message:'A connected access route crosses an obstacle or leaves the boundary. Review drawing roles and reserved areas; this arrangement cannot be marked complete.'});
    }
    if(!options.allowWallStorage&&env.obstacles.some(o=>intersectsPolygon(o,env.poly)&&!contained(o,env.poly,g+options.obstacleClearance)))source.issues.push({pn:'Perimeter gangway',message:'An existing obstacle interrupts the reserved perimeter gangway. Review the DWG roles or revise the warehouse boundary before this arrangement can be marked complete.'});
    if(source.groups.reduce((n,g)=>n+g.objects.length,0)>10000)throw new Error('This layout exceeds the 10,000-object drawing limit. Select a category to create a smaller layout.');
    // A spine plus full-width connected access strips keeps storage out of aisles.
    const placed=[],unplaced=[],old=new Map((previous?.groups||[]).map(v=>[v.id,v]));
    const startX=env.spine.x+g,startY=env.box.minY+margin+g,endX=env.box.maxX-margin,endY=env.box.maxY-margin;
    let rowY=startY,cursorX=startX,rowDepth=0;
    const ordered=[...source.groups.filter(v=>v.kind==='rack'),...source.groups.filter(v=>v.kind==='ground')];
    let attempts=0;
    for(const group of ordered){
      const prior=old.get(group.id);let candidate=prior?{...group,x:prior.x,y:prior.y,rotated:!!prior.rotated}:null;
      if(candidate&&placementError(candidate,placed,env,settings,options))candidate=null;
      if(!candidate){
        for(let pass=0;pass<2&&!candidate;pass++){
          const rotated=pass===1,w=rotated?group.h:group.w,h=rotated?group.w:group.h;
          // Run orientation is physical row rotation, not pallet rotation within shelves.
          let y=rowY,x=cursorX,depth=rowDepth;
          while(y+h<=endY+EPS&&attempts++<150000){
            if(x+w>endX+EPS){y+=depth+g;x=startX;depth=0;continue;}
            const test={...group,x,y,rotated};
            if(!placementError(test,placed,env,settings,options)){candidate=test;cursorX=x+w;rowY=y;rowDepth=Math.max(depth,h);break;}
            // Try the next actual obstacle edge, preserving real object dimensions.
            const blockers=env.obstacles.concat(env.doors,env.routes,placed.map(groupRect)).filter(o=>o.y<y+h&&o.y+o.h>y-g&&o.x+o.w>x);
            const next=blockers.map(o=>o.x+o.w+Math.max(options.obstacleClearance,g)).filter(v=>v>x+EPS).sort((a,b)=>a-b)[0];
            if(next&&next+w<=endX+EPS)x=next;else{y+=Math.max(depth,h)+g;x=startX;depth=0;}
          }
        }
      }
      if(candidate){placed.push(candidate);const r=groupRect(candidate);env.spine.h=Math.max(env.spine.h,r.y-env.spine.y);}
      else unplaced.push(group);
    }
    const layout={version:1,groups:placed,unplaced,env,options:{...options},issues:source.issues,rackRequired:source.rackRequired,groundRequired:source.groundRequired};
    return {...layout,...validate(layout,plan,settings)};
  }
  function validate(layout,plan,settings){
    if(layout.version===2)return scope.LogEnOptimizer.validate(layout,plan,settings);
    const errors=[...layout.issues],unplaced=layout.unplaced.slice(),valid=[];
    const expected=makeObjects(plan,settings),expectedGroups=new Map(expected.groups.map(g=>[g.id,g]));
    for(const group of layout.groups){const expectedGroup=expectedGroups.get(group.id);if(!expectedGroup){errors.push({pn:group.id,message:'Object is no longer in the Parts List.'});continue;}
      const error=placementError(group,layout.groups,layout.env,settings,layout.options);
      if(error){errors.push({pn:group.objects.map(o=>o.pn||o.typeName).join(', '),message:error});unplaced.push(group);}else valid.push(group);
    }
    const rackByPN=new Map(),groundByPN=new Map();let generatedRack=0,generatedGround=0;
    for(const group of valid)for(const o of group.objects){if(o.kind==='rack'){for(const a of o.allocations){generatedRack++;rackByPN.set(a.pn,(rackByPN.get(a.pn)||0)+1);}}else{generatedGround++;groundByPN.set(o.pn,(groundByPN.get(o.pn)||0)+o.quantity);}}
    const affected=[];
    for(const row of plan.rows){if(row.required===null||row.errors.length){affected.push({pn:row.input.partNumber,message:row.errors.join(' ')||'Unknown demand'});continue;}
      const placedRack=rackByPN.get(row.input.partNumber)||0,placedGround=groundByPN.get(row.input.partNumber)||0;
      if(placedRack!==row.rackPallets||placedGround!==row.groundPallets)affected.push({pn:row.input.partNumber,message:`Rack pallets ${placedRack}/${row.rackPallets}; ground pallets ${placedGround}/${row.groundPallets}`});
    }
    return {generatedRack,generatedGround,unplacedRack:Math.max(0,expected.rackRequired-generatedRack),unplacedGround:Math.max(0,expected.groundRequired-generatedGround),affected,validationErrors:errors,complete:!affected.length&&!errors.length&&!unplaced.length};
  }
  function move(layout,id,x,y,rotated,plan,settings){if(layout.version===2)return scope.LogEnOptimizer.move(layout,id,x,y,rotated,plan,settings);const group=layout.groups.find(g=>g.id===id)||layout.unplaced.find(g=>g.id===id);if(!group)throw new Error('Select a row or rack run.');if(![x,y].every(Number.isFinite))throw new Error('Enter finite coordinates in mm.');const trial={...group,x,y,rotated};const error=placementError(trial,layout.groups,layout.env,settings,layout.options);if(error)throw new Error(error);Object.assign(group,trial);if(!layout.groups.some(g=>g.id===id)){layout.groups.push(group);layout.unplaced=layout.unplaced.filter(g=>g.id!==id);}const rect=groupRect(group);layout.env.spine.h=Math.max(layout.env.spine.h,rect.y-layout.env.spine.y);Object.assign(layout,validate(layout,plan,settings));return layout;}
  function aisles(layout,settings){
    if(layout.version===2)return layout.aisles;
    const list=[{...layout.env.spine,id:'aisle:main',kind:'aisle'},...(layout.env.routes||[]),...layout.groups.map(g=>({...aisleFor(g,layout.env,settings.gangwayWidth),id:'aisle:'+g.id,kind:'aisle'}))];
    const p=layout.env.poly,b=layout.env.box,g=settings.gangwayWidth;
    if(!layout.options.allowWallStorage&&p.length===4&&p.every(v=>(Math.abs(v[0]-b.minX)<EPS||Math.abs(v[0]-b.maxX)<EPS)&&(Math.abs(v[1]-b.minY)<EPS||Math.abs(v[1]-b.maxY)<EPS))){list.push({x:b.minX,y:b.minY,w:b.maxX-b.minX,h:g},{x:b.minX,y:b.maxY-g,w:b.maxX-b.minX,h:g},{x:b.minX,y:b.minY+g,w:g,h:b.maxY-b.minY-2*g},{x:b.maxX-g,y:b.minY+g,w:g,h:b.maxY-b.minY-2*g});list.slice(-4).forEach((a,i)=>{a.id='aisle:perimeter:'+i;a.kind='aisle';});}
    return list.filter(a=>a.w>EPS&&a.h>EPS);
  }
  function cadObjects(layout){return layout.groups.flatMap(placedObjects);}
  scope.LogEnLayout=Object.freeze({core:Object.freeze({contained,overlaps,inside,validPolygon,expand}),generate,validate,move,makeObjects,environment,placedObjects,cadObjects,aisles,sourceKey,bounds,corners});
})(globalThis);
