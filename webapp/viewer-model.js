/* Read-only 3D scene description. CAD coordinates/demand remain in millimetres. */
(function(scope){
  'use strict';
  const L=scope.LogEnLayout,O=scope.LogEnOptimizer,D=scope.LogEnDomain;
  const positive=v=>Number.isFinite(v)&&v>0;
  const number=v=>Number(v).toLocaleString('en-GB',{maximumFractionDigits:1});
  function warn(p,message){p.invalid=true;p.placementWarnings=p.placementWarnings||[];if(!p.placementWarnings.includes(message))p.placementWarnings.push(message);}
  function build({layout,geometry,parts,settings,generatedAt}){
    const partMap=new Map(parts.map(p=>[p.partNumber,p])),types=D.configuredRackTypes(settings),pallets=[],bays=[],shelves=[],empty=[],structures=[],walls=[],obstacles=[],doors=[],surfaces=[],warnings=[];
    const drawingBoundary=geometry?.entities.find(e=>e.id===layout.options.boundaryId),boundary=drawingBoundary?drawingBoundary.points.map(p=>p.map(n=>n*layout.options.scale)):layout.env.frame?layout.env.poly.map(p=>O.toWorld(p,layout.env.frame)):layout.env.poly,box=L.bounds(boundary),origin=[(box.minX+box.maxX)/2,(box.minY+box.maxY)/2],buildingHeight=settings.maxFloorStackHeight||settings.maxFloorStackingHeight||5000;
    const world=p=>[(p[0]-origin[0])/1000,p[2]/1000,-(p[1]-origin[1])/1000];
    const role=e=>layout.options.entityRoles?.[e.id]||layout.options.layerRoles?.[e.layer]||'obstacle';
    function at(g,u,v){if(g.frame)return O.toWorld([g.x+(g.rotated?g.h-v:u),g.y+(g.rotated?u:v)],g.frame);return [g.x+(g.rotated?g.h-v:u),g.y+(g.rotated?u:v)];}
    function primitive(g,u,v,w,d,h,elevation=0){const center=at(g,u+w/2,v+d/2),a=at(g,u,v),b=at(g,u+w,v);return {center:world([center[0],center[1],elevation+h/2]),w:w/1000,d:d/1000,h:h/1000,angle:Math.atan2(b[1]-a[1],b[0]-a[0]),cadCenter:center,elevation,points:[[u,v],[u+w,v],[u+w,v+d],[u,v+d]].map(p=>at(g,...p))};}
    function pallet(g,u,v,w,d,h,elevation,data){if(![w,d,h].every(positive)){warnings.push('Missing pallet dimensions: '+data.pn);return;}const p={...primitive(g,u,v,w,d,h,elevation),...data,id:'pallet:'+data.id,status:'Occupied',placementWarnings:[],quantityParts:null,capacityParts:positive(data.input?.qtyBox)&&positive(data.input?.qtyOnPallet)?data.input.qtyBox*data.input.qtyOnPallet:null};pallets.push(p);return p;}
    const groups=layout.groups||[];
    groups.forEach((g,runIndex)=>{
      const rackNumber='R'+String(runIndex+1).padStart(3,'0');
      for(const o of g.objects){
        if(o.kind==='rack'){
          const t=types.find(t=>t.id===o.typeId)||layout.infrastructure?.find(v=>v.type?.id===o.typeId)?.type||settings,levels=o.levels||t.rackLevels,sl=t.rackSlotLength,sd=t.rackSlotDepth,sh=t.rackSlotHeight,structural=t.rackStructuralHeight||0,pitch=sh+structural,totalHeight=levels*pitch;
          const bayId='bay:'+o.id,loc=rackNumber+'-B'+String(o.bayNumber||1).padStart(2,'0'),bay={...primitive(g,o.dx,o.dy,o.w,o.h,totalHeight),id:bayId,kind:'rack',rackNumber,bayNumber:o.bayNumber||1,location:loc,levels,typeName:o.typeName,existing:!!g.existing,allocated:0,palletIds:[],emptyIds:[],status:'Rack overview',capacity:null,specs:{usableLength:sl,usableDepth:sd,usableHeight:sh,structuralLength:t.rackStructuralLength,structuralDepth:t.rackStructuralDepth,structuralHeight:structural,betweenBoxesAllowance:t.betweenBoxesAllowance,maxRunLength:t.maxRackRunLength,rotationAllowed:!!t.rackAllowRotation,stackingAllowed:!!t.rackAllowStacking,twoDeepAllowed:!!t.rackAllowDepthRows,outerLength:o.w,outerDepth:o.h,overallHeight:totalHeight}};bays.push(bay);
          const upright=Math.max(20,Math.min(100,(o.structuralLength||100)/2)),depthOffset=(o.h-sd)/2,lengthOffset=(o.w-sl)/2;
          for(const u of [o.dx,o.dx+o.w-upright])for(const v of [o.dy,o.dy+o.h-upright])structures.push({...primitive(g,u,v,upright,upright,totalHeight),kind:'upright',id:'upright:'+o.id+':'+u+':'+v,bayId});
          for(let level=1;level<=levels;level++){
            const deck=(level-1)*pitch+structural;
            const shelfId='shelf:'+o.id+':'+level;shelves.push({...primitive(g,o.dx+lengthOffset,o.dy+depthOffset,sl,sd,20,Math.max(0,deck-20)),id:shelfId,kind:'shelf',bayId,rackNumber,bayNumber:bay.bayNumber,level,location:loc+'-L'+String(level).padStart(2,'0'),usableLength:sl,usableDepth:sd,usableHeight:sh,elevationMm:deck,existing:!!g.existing});
            for(const v of [o.dy+depthOffset,o.dy+depthOffset+sd-65])structures.push({...primitive(g,o.dx+lengthOffset,v,sl,65,Math.max(35,structural),Math.max(0,deck-Math.max(35,structural))),kind:'beam',id:'beam:'+o.id+':'+level+':'+v,bayId,shelfId,level});
          }
          for(const [index,a]of (o.allocations||[]).entries()){
            const input=partMap.get(a.pn),slot=o.slots?.find(s=>s.id===a.slotId),positions=layout.infrastructure?.find(v=>v.id===a.slotId?.split(':')[0])?.positionsPerLevel||Math.max(1,...(o.slots||[]).map(v=>v.position)),cell=slot?.cellLength;
            const width=a.length||input?.length,depth=a.depth||input?.width,h=a.height||input?.height;
            let ax=a.x,ay=a.y;
            if(!Number.isFinite(ax)&&slot){const gap=t.betweenBoxesAllowance||0;ax=gap+(slot.position-1)*((cell||((sl-(positions+1)*gap)/positions))+gap);ay=(sd-depth)/2;}
            if(!Number.isFinite(ax)||!Number.isFinite(ay)){warnings.push('Rack assignment has no retained position coordinates: '+a.pn+' ('+loc+'). Regenerate the layout.');continue;}
            const level=a.level||1,stackLayer=a.stackLayer||1,z=Number.isFinite(a.z)?a.z:(stackLayer-1)*(h||0),location=loc+'-L'+String(level).padStart(2,'0')+'-P'+String(a.position||index+1).padStart(2,'0');
            const p=pallet(g,o.dx+lengthOffset+ax,o.dy+depthOffset+ay,width,depth,h,(level-1)*pitch+structural+z,{id:o.id+':'+index,pn:a.pn,input,storageType:'Rack',location,locationBase:loc+'-L'+String(level).padStart(2,'0'),rackNumber,bayNumber:bay.bayNumber,level,position:a.position||index+1,stackLayer,bayId,existing:!!g.existing});
            if(p){bay.palletIds.push(p.id);bay.allocated++;
              if(ax<-.1||ax+width>sl+.1)warn(p,`Pallet frontage ends at ${number(ax+width)} mm; usable shelf length is ${number(sl)} mm. Go to Warehouse settings → rack type → Rack usable slot length / Between boxes allowance, or correct L/W in Part details, then regenerate the layout.`);
              if(ay<-.1||ay+depth>sd+.1)warn(p,`Pallet depth ends at ${number(ay+depth)} mm; usable shelf depth is ${number(sd)} mm. Go to Warehouse settings → rack type → Rack usable slot depth, or correct L/W in Part details, then regenerate the layout.`);
              if(z+h>sh+.1)warn(p,`Pallet / stack height is ${number(z+h)} mm; usable slot height is ${number(sh)} mm. Go to Warehouse settings → rack type → Rack usable slot height / rack stacking options, or correct H in Part details, then regenerate the layout.`);
            }
          }
          if(o.slots){
            bay.capacity=o.slots.length;
            for(const slot of o.slots.filter(s=>s.status!=='ALLOCATED')){const gap=t.betweenBoxesAllowance||0,width=slot.cellLength,depth=slot.cellDepth,x=gap+(slot.position-1)*(width+gap),level=slot.level,id='empty:'+slot.id,item={...primitive(g,o.dx+lengthOffset+x,o.dy+depthOffset,width,depth,15,(level-1)*pitch+structural+8),id,kind:'empty',status:slot.status==='EMPTY'?'Empty Location':slot.status,location:loc+'-L'+String(level).padStart(2,'0')+'-P'+String(slot.position).padStart(2,'0'),rackNumber,bayNumber:bay.bayNumber,level,bayId};empty.push(item);bay.emptyIds.push(id);}
          }else{
            // Free shelf rectangles come from the same packing result, not decorative inventory.
            const sourceBay=o.shelves?{shelves:o.shelves}:layout.version===3?null:layout.viewerRackBays?.find(b=>b.typeId===o.typeId&&b.number===o.bayNumber);
            for(let level=1;level<=levels;level++){
              const shelf=sourceBay?.shelves.find(s=>s.level===level),allocated=(o.allocations||[]).some(a=>a.level===level),free=shelf?.free||(!allocated?[{x:t.betweenBoxesAllowance||0,y:0,w:sl-2*(t.betweenBoxesAllowance||0),d:sd}]:[]);
              for(const [i,f]of free.entries()){if(f.w<=0||f.d<=0)continue;const id='empty:'+o.id+':'+level+':'+i,item={...primitive(g,o.dx+lengthOffset+f.x,o.dy+depthOffset+f.y,f.w,f.d,15,(level-1)*pitch+structural+8),id,kind:'empty',status:'Empty Location',location:loc+'-L'+String(level).padStart(2,'0')+'-FREE'+(i+1),rackNumber,bayNumber:bay.bayNumber,level,bayId,freeShelfArea:f.w*f.d/1e6};empty.push(item);bay.emptyIds.push(id);}
            }
          }
        }else if(o.kind==='ground'){
          const input=partMap.get(o.pn),qty=o.quantity||0,height=o.height||input?.height,position=o.position||1,location='G'+String(runIndex+1).padStart(3,'0')+'-P'+String(position).padStart(3,'0');
          for(let layer=0;layer<qty;layer++)pallet(g,o.dx,o.dy,o.w,o.h,height,layer*height,{id:o.id+':'+layer,pn:o.pn,input,storageType:'Ground storage',location:location+'-S'+(layer+1),locationBase:location,row:g.id,position,stackLayer:layer+1,existing:!!g.existing});
        }
      }
    });
    const byLocation=new Map();for(const p of pallets){const key=p.locationBase;byLocation.set(key,(byLocation.get(key)||0)+1);}for(const p of pallets)p.palletsInLocation=byLocation.get(p.locationBase);
    for(const a of L.aisles(layout,settings))surfaces.push({kind:'aisle',existing:!!a.existing,points:(a.points||L.corners(a)).map(p=>world([p[0],p[1],10])),hole:!!a.hole});
    for(const a of layout.clearances||[])surfaces.push({kind:'clearance',points:(a.points||L.corners(a)).map(p=>world([p[0],p[1],15])),hole:!!a.hole});
    for(const p of layout.infrastructure||[])if(p.kind==='existing-ground')surfaces.push({kind:'zone',existing:true,points:p.points.map(p=>world([p[0],p[1],18]))});
    function wallSegment(a,b,height,kind,id,thickness=120){const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)return;const center=world([(a[0]+b[0])/2,(a[1]+b[1])/2,height/2]);(kind==='door'?doors:walls).push({id,kind,center,w:len/1000,d:thickness/1000,h:height/1000,angle:Math.atan2(b[1]-a[1],b[0]-a[0])});}
    const doorPolygons=(geometry?.entities||[]).filter(e=>role(e)==='door').map(e=>e.points.map(p=>p.map(n=>n*layout.options.scale)));
    function cutWall(a,b,height,kind,id){const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)return;const u=[(b[0]-a[0])/len,(b[1]-a[1])/len],cuts=[];for(const points of doorPolygons){const normal=points.map(p=>(p[0]-a[0])*(-u[1])+(p[1]-a[1])*u[0]);if(Math.min(...normal)>150||Math.max(...normal)<-150)continue;const positions=points.map(p=>(p[0]-a[0])*u[0]+(p[1]-a[1])*u[1]);cuts.push([Math.max(0,Math.min(...positions)),Math.min(len,Math.max(...positions))]);}let start=0;for(const [lo,hi]of cuts.filter(v=>v[1]>v[0]).sort((a,b)=>a[0]-b[0])){if(lo>start)wallSegment([a[0]+u[0]*start,a[1]+u[1]*start],[a[0]+u[0]*lo,a[1]+u[1]*lo],height,kind,id+':'+start);start=Math.max(start,hi);}if(start<len)wallSegment([a[0]+u[0]*start,a[1]+u[1]*start],b,height,kind,id+':'+start);}
    for(let i=0;i<boundary.length;i++)cutWall(boundary[i],boundary[(i+1)%boundary.length],buildingHeight,'external-wall','wall:'+i);
    for(const e of geometry?.entities||[]){if(e.id===layout.options.boundaryId)continue;const r=role(e),pts=e.points.map(p=>p.map(n=>n*layout.options.scale));if(['existing-rack','existing-ground','gangway','reference'].includes(r))continue;
      const height=positive(e.height)?e.height*layout.options.scale:buildingHeight;
      if(r==='door'){if(pts.length>=2){let longest=[pts[0],pts[1]];for(let i=1;i<pts.length;i++)if(Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1])>Math.hypot(longest[1][0]-longest[0][0],longest[1][1]-longest[0][1]))longest=[pts[i-1],pts[i]];wallSegment(longest[0],longest[1],Math.min(height,2800),'door',e.id,80);}continue;}
      if(!e.closed||e.type==='LINE'){for(let i=1;i<pts.length;i++)cutWall(pts[i-1],pts[i],height,'internal-wall',e.id+':'+i);}
      else obstacles.push({id:e.id,kind:'obstacle',points:pts.map(p=>world([p[0],p[1],0])),height:height/1000,schematicHeight:!positive(e.height)});
    }
    for(const [i,r]of (layout.options.manualObstacles||[]).entries())obstacles.push({id:'reserved:'+i,kind:'restricted',points:L.corners(r).map(p=>world([p[0],p[1],0])),height:.08});
    // Spatial buckets keep pairwise pallet validation bounded for large models.
    const buckets=new Map(),axes=p=>[[Math.cos(p.angle),-Math.sin(p.angle)],[Math.sin(p.angle),Math.cos(p.angle)]],sat=(a,b)=>{
      if(Math.abs(a.center[1]-b.center[1])>=(a.h+b.h)/2-.0001)return false;
      const aa=axes(a),bb=axes(b),delta=[b.center[0]-a.center[0],b.center[2]-a.center[2]];
      return [...aa,...bb].every(v=>Math.abs(delta[0]*v[0]+delta[1]*v[1])<(Math.abs(aa[0][0]*v[0]+aa[0][1]*v[1])*a.w+Math.abs(aa[1][0]*v[0]+aa[1][1]*v[1])*a.d+Math.abs(bb[0][0]*v[0]+bb[0][1]*v[1])*b.w+Math.abs(bb[1][0]*v[0]+bb[1][1]*v[1])*b.d)/2-.0001);
    };
    for(const p of pallets){if(!p.points.every(v=>L.core.inside(v,boundary)))warn(p,'Pallet footprint extends outside the selected warehouse boundary. Go to Warehouse Designer → Create Layout → Warehouse boundary / DWG units, correct the drawing setup or position and regenerate the layout.');
      if(p.elevation+p.h*1000>buildingHeight+.1)warn(p,`Pallet top reaches ${number(p.elevation+p.h*1000)} mm, above the building-height limit of ${number(buildingHeight)} mm. The 3D viewer uses Maximum floor stacking height as the building height. Go to Warehouse settings → Floor storage & gangways → Maximum floor stacking height. Set the actual building height, then regenerate the layout.`);const b=L.bounds(p.points),seen=new Set();for(let x=Math.floor(b.minX/5000);x<=Math.floor(b.maxX/5000);x++)for(let y=Math.floor(b.minY/5000);y<=Math.floor(b.maxY/5000);y++){const key=x+':'+y,list=buckets.get(key)||[];for(const other of list)if(!seen.has(other.id)){seen.add(other.id);if(sat(p,other)){warn(p,`Overlaps Part Number ${other.pn} at ${other.location}. Go to Warehouse Designer → Create Layout and adjust the affected row/run or regenerate the layout after checking dimensions and clearances in Warehouse settings.`);warn(other,`Overlaps Part Number ${p.pn} at ${p.location}. Go to Warehouse Designer → Create Layout and adjust the affected row/run or regenerate the layout after checking dimensions and clearances in Warehouse settings.`);}}list.push(p);buckets.set(key,list);}}
    const invalid=pallets.filter(p=>p.invalid).length;if(invalid)warnings.push(invalid+' pallets have a boundary, height, shelf-fit or overlap warning. These are shown red; 3D does not adjust allocations.');
    warnings.push('2D CAD does not provide verified wall/obstacle heights. Display height uses Maximum floor stacking height; wall thickness and door frame appearance are schematic.');
    return {version:1,boundary:boundary.map(p=>world([p[0],p[1],0])),origin,buildingHeight:buildingHeight/1000,pallets,bays,shelves,empty,structures,walls,obstacles,doors,surfaces,warnings,generatedAt,mode:layout.version===3?'Existing Layout':'Greenfield',partial:!layout.complete,invalidCount:invalid};
  }
  scope.LogEnViewerModel=Object.freeze({build});
})(globalThis);
