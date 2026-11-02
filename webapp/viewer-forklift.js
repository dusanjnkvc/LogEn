/* Schematic vehicle routing in the saved aisle polygons; never changes warehouse allocations. */
(function(scope){
  'use strict';
  const O=scope.LogEnOptimizer,G=O.geometry,C=scope.ClipperLib,L=scope.LogEnLayout;
  function plan(model,options={}){
    const vehicle={width:1.2,length:2.8,height:2.15,clearance:.10,...options.vehicle},radius=Math.hypot(vehicle.width,vehicle.length)/2+vehicle.clearance;
    const normalized=(pts,hole=false)=>{const p=G.path(pts);if(C.Clipper.Orientation(p)===hole)p.reverse();return p;};
    const polygon=points=>normalized(points.map(p=>[p[0]*1000,p[2]*1000]));
    const rectangle=o=>{const [x,,z]=o.center,c=Math.cos(o.angle||0),s=Math.sin(o.angle||0);return normalized([[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[(x+u*c*o.w/2+v*s*o.d/2)*1000,(z-u*s*o.w/2+v*c*o.d/2)*1000]));};
    const aisles=G.union(model.surfaces.filter(s=>s.kind==='aisle').map(s=>normalized(s.points.map(p=>[p[0]*1000,p[2]*1000]),s.hole)));
    const failure=reason=>({points:[],length:0,vehicle,radius,reason,componentCount:0,safePaths:[]});
    if(!aisles.length)return failure('No generated gangways are available for the forklift preview.');
    if(model.buildingHeight<vehicle.height)return failure('The displayed building height is lower than the preview forklift.');
    const blocked=G.union([...model.bays.map(rectangle),...model.pallets.filter(p=>p.storageType!=='Rack'&&p.stackLayer===1).map(rectangle),...model.walls.map(rectangle),...model.obstacles.map(o=>polygon(o.points)),...(model.movementRestrictions||[]).map(o=>normalized(o.points.map(p=>[p[0]*1000,p[2]*1000]),o.hole))]);
    const floor=G.union(model.boundaryRegions?model.boundaryRegions.map(r=>normalized(r.points.map(p=>[p[0]*1000,p[2]*1000]),r.hole)):(model.boundaries||[model.boundary]).map(polygon)),walkable=G.diff(G.intersect(aisles,floor),blocked),safe=G.offset(walkable,-radius*1000);
    if(!safe.length)return failure('No continuous gangway has enough clearance for the schematic 1.2 × 2.8 m forklift.');
    const box=L.bounds(safe.flatMap(G.points)),step=Math.max(650,Math.sqrt((box.maxX-box.minX)*(box.maxY-box.minY)/24000)),cols=Math.ceil((box.maxX-box.minX)/step),rows=Math.ceil((box.maxY-box.minY)/step),nodes=[],grid=new Map();
    const inside=(x,y)=>{let winding=0;const point={X:Math.round(x*10),Y:Math.round(y*10)};for(const ring of safe){const value=C.Clipper.PointInPolygon(point,ring);if(value===-1)return false;if(value)winding+=C.Clipper.Orientation(ring)?1:-1;}return winding>0;};
    const validEdge=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),nx=-dy/d,ny=dx/d,path=normalized([[a.x+nx,a.y+ny],[b.x+nx,b.y+ny],[b.x-nx,b.y-ny],[a.x-nx,a.y-ny]]);return G.area(G.diff([path],safe))<.11;};
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const px=box.minX+(x+.5)*step,py=box.minY+(y+.5)*step;if(inside(px,py)){const node={x:px,y:py,id:nodes.length,links:[]};nodes.push(node);grid.set(x+':'+y,node);for(const key of [(x-1)+':'+y,x+':'+(y-1)]){const other=grid.get(key);if(other&&validEdge(node,other)){node.links.push(other.id);other.links.push(node.id);}}}}
    if(nodes.length<2)return failure('Gangway clearance is too limited to build a continuous preview route.');
    const visited=new Set(),components=[];
    function bfs(start,allowed=null){const queue=[start],parents=new Map([[start,-1]]);for(let i=0;i<queue.length;i++)for(const next of nodes[queue[i]].links)if(!parents.has(next)&&(!allowed||allowed.has(next))){parents.set(next,queue[i]);queue.push(next);}return {queue,parents,last:queue[queue.length-1]};}
    for(const node of nodes)if(!visited.has(node.id)){const component=bfs(node.id).queue;component.forEach(id=>visited.add(id));components.push(component);}components.sort((a,b)=>b.length-a.length);
    // Traverse every reachable aisle branch rather than only a single diameter.
    const allowed=new Set(components[0]),seen=new Set(),path=[],stack=[{id:components[0][0],index:0}];
    seen.add(stack[0].id);path.push(nodes[stack[0].id]);
    while(stack.length){const frame=stack[stack.length-1],links=nodes[frame.id].links;let next;
      while(frame.index<links.length){const candidate=links[frame.index++];if(allowed.has(candidate)&&!seen.has(candidate)){next=candidate;break;}}
      if(next!==undefined){seen.add(next);path.push(nodes[next]);stack.push({id:next,index:0});}
      else{stack.pop();if(stack.length)path.push(nodes[stack[stack.length-1].id]);}
    }
    const points=[];for(const node of path){const p=[node.x/1000,node.y/1000];if(points.length>1){const prev=points[points.length-1],before=points[points.length-2];if(Math.abs((prev[0]-before[0])*(p[1]-prev[1])-(prev[1]-before[1])*(p[0]-prev[0]))<1e-8&&(prev[0]-before[0])*(p[0]-prev[0])+(prev[1]-before[1])*(p[1]-prev[1])>0)points.pop();}points.push(p);}
    let length=0;const distances=[0];for(let i=1;i<points.length;i++){length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);distances.push(length);}
    if(length<2)return failure('The connected gangway section is too short for a driving preview.');
    return {nodes:nodes.map(n=>({x:n.x/1000,z:n.y/1000,links:n.links})),components,points,distances,length,vehicle,radius,walkablePaths:walkable,safePaths:safe,componentCount:components.length,reason:null};
  }
  function sample(route,distance,direction=1){const d=Math.max(0,Math.min(route.length,distance));let lo=1,hi=route.distances.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(route.distances[mid]<d)lo=mid+1;else hi=mid;}const b=route.points[lo],a=route.points[lo-1],length=route.distances[lo]-route.distances[lo-1],t=length?(d-route.distances[lo-1])/length:0;return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,yaw:Math.atan2((b[0]-a[0])*direction,(b[1]-a[1])*direction)};}
  function footprint(route,p){const w=route.vehicle.width/2+.10,d=route.vehicle.length/2+.10,c=Math.cos(p.yaw),s=Math.sin(p.yaw);return [[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>[p.x+x*c+z*s,p.z-x*s+z*c]);}
  function fits(route,p){let path=G.path(footprint(route,p).map(v=>v.map(n=>n*1000)));if(!C.Clipper.Orientation(path))path.reverse();return G.area(G.diff([path],route.walkablePaths||route.safePaths))<.1;}
  function overlaps(route,a,b){const pa=footprint(route,a),pb=footprint(route,b);return [a.yaw,b.yaw].flatMap(t=>[[Math.cos(t),-Math.sin(t)],[Math.sin(t),Math.cos(t)]]).every(axis=>{const aa=pa.map(p=>p[0]*axis[0]+p[1]*axis[1]),bb=pb.map(p=>p[0]*axis[0]+p[1]*axis[1]);return Math.max(...aa)>Math.min(...bb)&&Math.max(...bb)>Math.min(...aa);});}
  function lane(route,d,direction){const p=sample(route,d,direction),offset=.8;const shifted={...p,x:p.x+Math.cos(p.yaw)*offset,z:p.z-Math.sin(p.yaw)*offset};return fits(route,shifted)?shifted:p;}
  function steer(route,current,target,dt,speed,others=[]){const dx=target.x-current.x,dz=target.z-current.z,d=Math.hypot(dx,dz),heading=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(heading-current.yaw),Math.cos(heading-current.yaw));const yaw=current.yaw+Math.max(-dt*1.8,Math.min(dt*1.8,delta));const travel=Math.min(d,speed*dt)*(Math.abs(delta)<.4?1:Math.abs(delta)<1.2?.3:0);const next={x:current.x+Math.sin(yaw)*travel,z:current.z+Math.cos(yaw)*travel,yaw};for(let i=1;i<=4;i++){const f=i/4,p={x:current.x+(next.x-current.x)*f,z:current.z+(next.z-current.z)*f,yaw:current.yaw+(yaw-current.yaw)*f};if(!fits(route,p)||others.some(o=>overlaps(route,p,o)))return null;}return next;}
  function nextLeg(route,start,previous,pose,random=Math.random){
    const nodes=route.nodes||[],origin=nodes[start];if(!origin)return null;
    const choices=origin.links.filter(id=>id!==previous),links=choices.length?choices:origin.links;if(!links.length)return null;
    const score=id=>{const n=nodes[id],dx=n.x-origin.x,dz=n.z-origin.z;return (dx*Math.sin(pose.yaw)+dz*Math.cos(pose.yaw))/Math.hypot(dx,dz);};
    const sorted=[...links].sort((a,b)=>score(b)-score(a));let end=sorted[0];if(links.length>1&&random()<.2)end=links[Math.floor(random()*links.length)];
    let prior=start,dx=nodes[end].x-origin.x,dz=nodes[end].z-origin.z,length=Math.hypot(dx,dz);dx/=length;dz/=length;
    // Drive a useful straight stretch before choosing another direction. Grid nodes
    // are clearance samples, not destinations where a vehicle should turn each time.
    while(length<7){const at=nodes[end],next=at.links.find(id=>id!==prior&&Math.abs((nodes[id].x-at.x)*dz-(nodes[id].z-at.z)*dx)<1e-5&&(nodes[id].x-at.x)*dx+(nodes[id].z-at.z)*dz>0);if(next===undefined)break;length+=Math.hypot(nodes[next].x-at.x,nodes[next].z-at.z);prior=end;end=next;}
    const dest=nodes[end],shifted={x:dest.x+dz*.45,z:dest.z-dx*.45,yaw:Math.atan2(dx,dz)},target=Array.from({length:16},(_,i)=>i*Math.PI/8).every(yaw=>fits(route,{...shifted,yaw}))?shifted:{x:dest.x,z:dest.z};return {end,previous:prior,target};
  }
  scope.LogEnForklift=Object.freeze({plan,sample,footprint,fits,overlaps,lane,steer,nextLeg});
})(globalThis);
