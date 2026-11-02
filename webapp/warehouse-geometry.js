/* CAD interpretation is independent of inventory and footprint formulas. All paths use mm. */
(function(scope){
  'use strict';
  const S=10,EPS=.11;
  const roles=['boundary','usable','void','wall','pillar','door','pedestrian','gangway','restricted','existing-rack','existing-ground','crossing','obstacle','reference'];
  const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const rules=[['pedestrian',/pedestrian|walkways?|footpaths?|chodnik/],['crossing',/crossings?|crosswalk/],['gangway',/forklift|industrial aisle|gangways?|traffic aisle/],['existing-ground',/ground storage|floor storage|pallet positions?/],['existing-rack',/racks?|shelving|regal/],['usable',/usable|storage eligible|storage area/],['boundary',/warehouse boundary|external boundary|building outline|perimeter|source boundary|^boundary$/],['pillar',/pillars?|columns?|stl[pb]/],['door',/doors?|entrance|exit|loading gate/],['wall',/walls?|partition/],['restricted',/restricted|no storage|blocked|machinery|technical|exclusion/],['reference',/annotation|dimension|text|reference|title|defpoints/]];
  function role(e,o={}){const ids=String(e.id||'').split('/');let inherited;for(let n=ids.length-1;n>0;n--)if(o.entityRoles?.[ids.slice(0,n).join('/')]){inherited=o.entityRoles[ids.slice(0,n).join('/')];break;}const explicit=o.entityRoles?.[e.id]||inherited||o.layerRoles?.[e.layer];if(explicit)return explicit;const alias=Object.entries(o.layerAliases||{}).find(([name])=>normalize(name)===normalize(e.layer));if(alias&&roles.includes(alias[1]))return alias[1];if(e.semanticRole)return e.semanticRole;if(e.type==='POINT'&&rules.find(([,r])=>r.test(normalize(e.layer)))?.[0]==='pillar')return 'pillar';if(['TEXT','MTEXT','DIMENSION','POINT'].includes(e.type))return 'reference';return rules.find(([,r])=>r.test((normalize(e.layer)+' '+normalize(e.blockName)).trim()))?.[0]||'obstacle';}
  const path=pts=>pts.map(([x,y])=>({X:Math.round(x*S),Y:Math.round(y*S)}));
  const points=p=>p.map(v=>[v.X/S,v.Y/S]);
  function operation(a,b,type){const C=scope.ClipperLib;if(!a.length)return [];const c=new C.Clipper(),out=[];c.AddPaths(a,C.PolyType.ptSubject,true);if(b.length)c.AddPaths(b,C.PolyType.ptClip,true);c.Execute(type,out,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);return out;}
  const union=a=>operation(a,[],scope.ClipperLib.ClipType.ctUnion),diff=(a,b)=>b.length?operation(a,b,scope.ClipperLib.ClipType.ctDifference):a,intersect=(a,b)=>operation(a,b,scope.ClipperLib.ClipType.ctIntersection);
  const area=ps=>Math.abs(ps.reduce((n,p)=>n+scope.ClipperLib.Clipper.Area(p),0))/S/S/1e6;
  function ring(pts,hole=false){const p=path(pts);if(scope.ClipperLib.Clipper.Orientation(p)===hole)p.reverse();return p;}
  function offset(ps,n,open=false){if(!ps.length)return [];if(!n&&!open)return ps;const C=scope.ClipperLib,o=new C.ClipperOffset(2,.1*S),out=[];o.AddPaths(ps,C.JoinType.jtMiter,open?C.EndType.etOpenSquare:C.EndType.etClosedPolygon);o.Execute(out,n*S);return out;}
  const bounds=pts=>scope.LogEnLayout.bounds(pts);
  function loops(entities,tolerance){
    const nodes=[],edges=[],buckets=new Map(),step=tolerance||1e-8;
    function node(p){const x=Math.floor(p[0]/step),y=Math.floor(p[1]/step);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of buckets.get((x+dx)+':'+(y+dy))||[])if(Math.hypot(nodes[i].p[0]-p[0],nodes[i].p[1]-p[1])<=tolerance)return i;const i=nodes.length;nodes.push({p,edges:[]});const key=x+':'+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);return i;}
    for(const e of entities)for(let i=1;i<e.points.length;i++){const a=node(e.points[i-1]),b=node(e.points[i]);if(a===b)continue;const j=edges.length;edges.push({a,b,id:e.id});nodes[a].edges.push(j);nodes[b].edges.push(j);}
    const used=new Set(),out=[];
    for(let start=0;start<edges.length;start++){if(used.has(start))continue;const initial=edges[start];if(nodes[initial.a].edges.length!==2||nodes[initial.b].edges.length!==2)continue;const pts=[],ids=[],seen=new Set();let edge=start,at=initial.a,closed=false;
      while(!seen.has(edge)){seen.add(edge);pts.push(nodes[at].p);const e=edges[edge];ids.push(e.id);at=e.a===at?e.b:e.a;if(at===initial.a){closed=true;break;}if(nodes[at].edges.length!==2)break;edge=nodes[at].edges.find(n=>n!==edge);}
      seen.forEach(i=>used.add(i));if(closed&&scope.LogEnLayout.core.validPolygon(pts))out.push({points:pts,sourceIds:[...new Set(ids)]});
    }return out;
  }
  function prepare(input,o={}){
    const original=input.entities.filter(e=>!e.interpreted),entities=original.map(e=>({...e,points:(e.points||[]).filter(p=>p?.length>=2&&p.slice(0,2).every(Number.isFinite)).map(p=>p.slice(0,2))}));
    const scale=o.scale||({4:1,5:10,6:1000,1:25.4,2:304.8}[input.units])||1,tolerance=Math.max(0,o.geometryTolerance??1)/scale;
    for(const layer of [...new Set(entities.map(e=>e.layer))]){
      const lines=entities.filter(e=>e.layer===layer&&!e.closed&&['LINE','LWPOLYLINE','POLYLINE'].includes(e.type));
      for(const [i,loop]of loops(lines,tolerance).entries()){const b=bounds(loop.points);entities.push({...loop,id:'enclosure:'+layer+':'+i,type:'LWPOLYLINE',layer,closed:true,boundaryEligible:true,bounds:[b.minX,b.minY,b.maxX,b.maxY],interpreted:true,enclosureOfWalls:role({layer},o)==='wall',semanticRole:role({layer},o)==='wall'?'boundary':undefined});}
    }
    const valid=e=>e.closed&&scope.LogEnLayout.core.validPolygon(e.points);
    let selected=entities.filter(e=>['usable','boundary'].includes(role(e,o))&&valid(e));
    if(!selected.length){const candidates=entities.filter(e=>valid(e)&&role(e,o)==='obstacle');const outer=candidates.filter(e=>!candidates.some(v=>v!==e&&e.points.every(p=>scope.LogEnLayout.core.inside(p,v.points))));if(outer.length)selected=outer;}
    const usable=selected.filter(e=>role(e,o)==='usable');if(usable.length)selected=usable;
    if(selected.length){const pts=selected.flatMap(e=>e.points),b=bounds(pts);entities.push({id:'detected:regions',type:'LWPOLYLINE',layer:'Detected usable regions',semanticRole:'boundary',interpreted:true,closed:true,boundaryEligible:true,points:scope.LogEnLayout.corners({x:b.minX,y:b.minY,w:b.maxX-b.minX,h:b.maxY-b.minY}),bounds:[b.minX,b.minY,b.maxX,b.maxY],regionsUncertain:selected.some(e=>role(e,o)==='obstacle'),regionIds:selected.map(e=>e.id)});}
    return {...input,entities,interpretationVersion:1};
  }
  function analyze(input,o,settings={}){
    const geometry=prepare(input,o),L=scope.LogEnLayout,C=scope.ClipperLib,errors=[],warnings=[],counts={},scale=o.scale;
    if(!(Number.isFinite(scale)&&scale>0))throw new Error('Choose drawing units before geometry analysis.');
    const selected=geometry.entities.find(e=>e.id===(o.boundaryId||'detected:regions'));
    if(!selected)throw new Error('No reliable enclosed usable region was identified. Classify a boundary/usable-area layer or select a closed outline.');
    if(selected.regionsUncertain&&!o.regionsConfirmed)errors.push('Detected enclosures have no usable-area layer classification. Confirm the candidate regions or classify their source layer before generating storage.');
    const definedUsable=!selected.regionIds&&role(selected,o)!=='usable'?geometry.entities.filter(e=>!e.interpreted&&role(e,o)==='usable'&&e.closed&&L.core.validPolygon(e.points)&&e.points.every(p=>L.core.inside(p,selected.points))):[];
    const regionEntities=selected.regionIds?selected.regionIds.map(id=>geometry.entities.find(e=>e.id===id)):definedUsable.length?definedUsable:[selected],excluded=new Set(regionEntities.flatMap(e=>[e.id,...(e.enclosureOfWalls?[]:e.sourceIds||[])]));excluded.add('detected:regions');excluded.add(selected.id);
    const world=e=>e.points.map(p=>p.map(n=>n*scale));
    const outers=regionEntities.map(e=>world(e));for(const p of outers)if(!L.core.validPolygon(p))errors.push('An identified usable region is invalid or self-intersecting.');
    let gross=union(outers.filter(p=>L.core.validPolygon(p)).map(p=>ring(p))),physical=[],voids=[],noStorage=[],movement=[],pedestrians=[],forklifts=[],crossings=[],zones=[],doors=[],unclassified=0;
    const add=(array,ps)=>array.push(...ps);
    for(const e of geometry.entities){if(excluded.has(e.id)||e.interpreted&&!e.sourceIds)continue;let r=role(e,o);counts[r]=(counts[r]||0)+1;if(r==='reference'||r==='boundary'||r==='usable')continue;
      if(e.interpreted&&e.sourceIds?.some(id=>excluded.has(id)))continue;
      const pts=world(e);if(pts.length<2){if(['wall','pillar'].includes(r))errors.push(e.id+': physical footprint is missing. Supply a closed outline, or classify the marker as reference and add the actual reserved footprint.');else warnings.push(e.id+': geometry unavailable.');continue;}
      const closed=e.closed&&L.core.validPolygon(pts);let ps=[];
      if(e.closed&&!closed){errors.push(e.id+': invalid/self-intersecting polygon.');continue;}
      if(closed)ps=[ring(pts)];else if(r==='wall'){
        if(!(o.wallThickness>0)){errors.push(e.id+': enter an explicit wall thickness for line/open wall geometry.');continue;}ps=offset([path(pts)],o.wallThickness/2+(e.curveError||0)*scale,true);
      }else{const b=bounds(pts);ps=[ring(L.corners({x:b.minX,y:b.minY,w:Math.max(.1,b.maxX-b.minX),h:Math.max(.1,b.maxY-b.minY)}))];if(r!=='door')warnings.push(e.id+': open/unclassified geometry uses a conservative bounding envelope.');}
      if(r==='void'){gross=diff(gross,ps);voids.push(...ps);continue;}
      if(r==='crossing'){crossings.push({id:e.id,paths:ps});continue;}
      const shape={id:e.id,role:r,paths:ps,points:pts,closed};zones.push(shape);
      if(r==='door'){const type=o.doorTypes?.[e.id]||'unknown';doors.push({...shape,type,forklift:['forklift','loading'].includes(type)});if(!['forklift','loading'].includes(type))movement.push(...ps);if(type==='unknown')warnings.push(e.id+': classify the door type; forklift access is not assumed.');ps=offset(ps,o.doorClearance??settings.gangwayWidth??0);}
      if(r==='pedestrian')pedestrians.push(shape);if(r==='gangway')forklifts.push(shape);
      if(r==='obstacle'){unclassified++;warnings.push(e.id+': unclassified; storage and movement are conservatively blocked.');}
      if(['wall','pillar','obstacle'].includes(r))add(physical,ps);
      if(['wall','pillar','obstacle','restricted'].includes(r))add(movement,ps);
      // Installed infrastructure is handled separately by Existing Layout allocation.
      if(!(o.existingMode&&['existing-rack','existing-ground'].includes(r)))add(noStorage,ps);
    }
    for(const [i,r]of(o.manualObstacles||[]).entries()){if(![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0){errors.push('Invalid reserved area '+i);continue;}const p=ring(L.corners(r));physical.push(p);movement.push(p);noStorage.push(p);}
    physical=union(physical);const clearance=Math.max(0,o.obstacleClearance||0);noStorage=union([...noStorage,...offset(physical,clearance)]);movement=union([...movement,...offset(physical,clearance)]);
    const pedestrian=union(pedestrians.flatMap(e=>e.paths)),crossingCandidates=[];let approved=[];
    for(const p of pedestrians)for(const f of [...forklifts,...crossings]){const overlap=intersect(p.paths,f.paths);if(!area(overlap))continue;const id=p.id+'::'+f.id,b=bounds(overlap.flatMap(points)),pb=bounds(p.paths.flatMap(points)),longX=pb.maxX-pb.minX>=pb.maxY-pb.minY,along=longX?b.maxX-b.minX:b.maxY-b.minY,valid=along<=(settings.gangwayWidth||0)+.1&&!area(intersect(overlap,physical));const ok=valid&&o.approvedCrossings?.[id]===true;crossingCandidates.push({id,pedestrian:p.id,route:f.id,valid,approved:ok,paths:overlap});if(ok)approved.push(...overlap);else warnings.push(id+': pedestrian/forklift crossing requires site safety review'+(valid?'.':' and has insufficient geometry/clearance.'));}
    movement=union([...movement,...diff(pedestrian,union(approved))]);
    const pedestrianFree=diff(pedestrian,physical);
    if(o.minimumPedestrianWidth>0)for(const p of pedestrians){const free=diff(p.paths,physical),eroded=offset(free,-o.minimumPedestrianWidth/2);if(!eroded.length||components(eroded)>components(p.paths))warnings.push(p.id+': unobstructed passage may be narrower than the configured pedestrian minimum. Review the pillar clearance.');}
    const namedBoundary=geometry.entities.filter(e=>!e.interpreted&&role(e,o)==='boundary'&&e.closed&&L.core.validPolygon(world(e))).map(e=>ring(world(e))),warehouse=namedBoundary.length?diff(union(namedBoundary),union(voids)):gross;if(area(diff(gross,warehouse))>1e-7)errors.push('A usable region leaves the classified warehouse boundary. Correct the regions or boundary before generation.');
    const net=diff(gross,noStorage),regionCount=components(gross);for(const n of input.notifications||[])warnings.push('CAD reader: '+n);
    if(!gross.length)errors.push('No valid usable area remains.');if(input.unreadableEntities)warnings.push(input.unreadableEntities+' source entities could not be interpreted; add their restrictions before confirming geometry.');
    return {geometry,warehouse,regions:regionEntities.map(e=>({id:e.id,points:world(e),area:area(intersect(gross,[ring(world(e))]))})),gross,physical,noStorage:intersect(noStorage,gross),movementBlocked:intersect(movement,gross),net,pedestrian,pedestrianFree,approvedCrossings:union(approved),crossingCandidates,zones,doors,errors,warnings,counts,unclassified,regionCount,grossArea:area(gross),excludedArea:area(gross)-area(net),netArea:area(net)};
  }
  function components(ps){if(!ps.length)return 0;const C=scope.ClipperLib,c=new C.Clipper(),tree=new C.PolyTree();c.AddPaths(ps,C.PolyType.ptSubject,true);c.Execute(C.ClipType.ctUnion,tree,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);return tree.Childs().length;}
  scope.LogEnWarehouseGeometry=Object.freeze({roles,role,normalize,prepare,analyze,path,points,ring,union,diff,intersect,offset,area,components});
})(globalThis);
