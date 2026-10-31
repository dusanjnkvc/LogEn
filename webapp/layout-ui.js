/* Drawing editor. Inventory and capacities are supplied by Warehouse Designer. */
(function(scope){
  'use strict';
  const L=scope.LogEnLayout,NS='http://www.w3.org/2000/svg';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>Number(v).toLocaleString('en-GB',{maximumFractionDigits:2});
  const el=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
  function open({plan,settings,geometry,options={},saved=null,onSave,onExport,onHelper,name}){
    const dialog=document.createElement('dialog');dialog.className='physical-layout-dialog';
    const defaults={1:25.4,2:304.8,4:1,5:10,6:1000};
    let setup={scale:defaults[geometry.units]||0,boundaryId:'',obstacleClearance:settings.floorPalletClearance,layerRoles:{},entityRoles:{},manualObstacles:[],...options};
    let layout=saved,selected=null,selectedEntity=null,dirty=false,exported=null,drag=null,viewBox=null;
    const candidates=geometry.entities.filter(e=>e.boundaryEligible).sort((a,b)=>(b.bounds[2]-b.bounds[0])*(b.bounds[3]-b.bounds[1])-(a.bounds[2]-a.bounds[0])*(a.bounds[3]-a.bounds[1]));
    const layers=[...new Set(geometry.entities.map(e=>e.layer))].sort();
    const roleOptions=value=>[['obstacle','Blocked area'],['door','Door / exit'],['reference','Reference only']].map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('');
    dialog.innerHTML=`<div class="dialog-head physical-layout-heading"><div><div class="eyebrow">WAREHOUSE DESIGNER · ${esc(name)}</div><h2>Create Layout</h2></div><button class="btn btn-secondary" data-layout-close>Close</button></div><div class="physical-layout-body"><aside class="layout-setup"><h3>Drawing setup</h3><label class="field"><span>DWG units</span><select data-layout-units aria-label="DWG units"><option value="0">Choose drawing units</option>${[[1,'Millimetres'],[10,'Centimetres'],[1000,'Metres'],[25.4,'Inches'],[304.8,'Feet']].map(([v,t])=>`<option value="${v}" ${setup.scale===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="field"><span>Warehouse boundary</span><select data-layout-boundary aria-label="Warehouse boundary"><option value="">Choose closed outline</option>${candidates.map(e=>`<option value="${esc(e.id)}" ${e.id===setup.boundaryId?'selected':''}>${esc(e.layer)} · ${esc(e.id)} · ${fmt(e.bounds[2]-e.bounds[0])} × ${fmt(e.bounds[3]-e.bounds[1])} units</option>`).join('')}</select></label>${!candidates.length?'<p class="notice error">No closed straight 2D polyline was found. Add a closed warehouse outline in AutoCAD and upload the DWG again.</p>':''}<p class="muted">Gangway: <strong>${fmt(settings.gangwayWidth)} mm</strong><br>${setup.allowWallStorage?'Wall storage allowed; no perimeter aisle is reserved.':'A full-width perimeter gangway is reserved.'}</p><label class="field"><span>Obstacle clearance (mm)</span><input type="number" min="0" step="1" data-layout-clearance value="${esc(setup.obstacleClearance)}"></label><details open><summary>Drawing layers & access</summary><p class="muted">Classify layers, then click individual drawing objects to override their role. The selected boundary is excluded from obstacles.</p><div class="layout-layer-list">${layers.map((v,i)=>`<label class="field"><span title="${esc(v)}">${esc(v)}</span><select data-layout-layer="${i}" aria-label="Role of layer ${esc(v)}">${roleOptions(setup.layerRoles?.[v]||'obstacle')}</select></label>`).join('')}</div></details>${geometry.unreadableEntities?`<p class="notice error">${fmt(geometry.unreadableEntities)} drawing entities could not be read. Review them in AutoCAD and add any missing blocked areas below. They remain in the exported original drawing.</p>`:''}<details><summary>Add a reserved area</summary><p class="muted">Use drawing coordinates converted to mm. Add areas that must remain clear.</p><div class="layout-coordinate-grid">${[['x','X'],['y','Y'],['w','Length'],['h','Depth']].map(([k,t])=>`<label class="field"><span>${t} (mm)</span><input type="number" data-reserved="${k}" aria-label="Reserved ${t}"></label>`).join('')}</div><button class="btn btn-secondary small" data-add-reserved>Add area</button><div data-reserved-list></div></details><label class="checkbox-field layout-review"><input type="checkbox" data-layout-reviewed><span>I have checked the boundary, units, doors, exits and all blocked areas against the DWG.</span></label><button class="btn btn-primary" data-layout-generate>Generate from Parts List</button>${onHelper?'<details><summary>CAD connection</summary><button class="btn btn-secondary small" data-layout-helper>Download AutoCAD helper</button></details>':''}<p class="muted small-note">Uses the current Warehouse Designer allocation. Full physical aisles can require more area than the dashboard’s allocated estimates. Placement is a planning arrangement; it does not certify fire access or an optimized design.</p></aside><section class="layout-drawing-pane"><div class="layout-toolbar"><span class="layout-legend"><i class="rack-key"></i>Racks <i class="ground-key"></i>Ground <i class="aisle-key"></i>Gangways</span><div class="actions"><button class="btn btn-secondary small" data-layout-zoom="in" aria-label="Zoom in">+</button><button class="btn btn-secondary small" data-layout-zoom="out" aria-label="Zoom out">−</button><button class="btn btn-secondary small" data-layout-storage>Storage</button><button class="btn btn-secondary small" data-layout-fit>Fit</button></div></div><div class="layout-canvas-wrap"><svg class="layout-canvas" role="group" aria-label="Warehouse floor layout" tabindex="0"></svg></div><p class="muted small-note">Select a storage object to inspect its assignments. Drag a row or run, or use its coordinates below. Dimensions stay fixed. Use + / − to zoom; drag empty space to pan.</p><div class="layout-properties" data-layout-properties></div><div class="layout-inline-error notice error" role="alert" hidden></div><div data-layout-report></div></section></div><div class="dialog-actions"><span class="layout-save-status muted" aria-live="polite"></span><button class="btn btn-secondary" data-layout-save>Save layout</button><button class="btn btn-primary" data-layout-export ${layout?'':'disabled'}>Download Output data</button><button class="btn btn-secondary" data-layout-pdf hidden>Download layout PDF</button></div>`;
    const q=s=>dialog.querySelector(s),svg=q('svg.layout-canvas'),properties=q('[data-layout-properties]'),report=q('[data-layout-report]');
    const message=(text='')=>{q('.layout-inline-error').textContent=text;q('.layout-inline-error').hidden=!text;};
    const role=e=>setup.entityRoles?.[e.id]||setup.layerRoles?.[e.layer]||'obstacle';
    function changed(){dirty=true;q('[data-layout-reviewed]').checked=false;exported=null;q('[data-layout-export]').disabled=true;q('[data-layout-pdf]').hidden=true;q('.layout-save-status').textContent='Setup changed · regenerate the layout';draw();}
    function setupValues(){setup.scale=Number(q('[data-layout-units]').value);setup.boundaryId=q('[data-layout-boundary]').value;setup.obstacleClearance=Number(q('[data-layout-clearance]').value);}
    function saveLabel(text){q('.layout-save-status').textContent=text;}
    async function persist(){await onSave({options:setup,layout:dirty?null:layout});saveLabel(dirty?'Drawing setup saved; regenerate to update positions.':'Layout saved on this device.');}
    function fit(){
      const boundary=geometry.entities.find(e=>e.id===setup.boundaryId),points=(boundary?[boundary]:geometry.entities).flatMap(e=>e.points||[]),s=setup.scale||1;
      if(!points.length){viewBox=[0,0,100,100];return;}
      const b=L.bounds(points),w=(b.maxX-b.minX)*s||100,h=(b.maxY-b.minY)*s||100,p=Math.max(w,h)*0.04;
      viewBox=[b.minX*s-p,-b.maxY*s-p,w+2*p,h+2*p];
    }
    function rect(r,attrs={}){return el('rect',{x:r.x,y:-r.y-r.h,width:r.w,height:r.h,...attrs});}
    function draw(){
      if(!viewBox)fit();svg.setAttribute('viewBox',viewBox.join(' '));svg.replaceChildren();
      const stroke=Math.max(viewBox[2],viewBox[3])/1000,s=setup.scale||1;
      for(const e of geometry.entities){if(!e.points?.length)continue;const isBoundary=e.id===setup.boundaryId,r=role(e),pts=e.points.map(p=>`${p[0]*s},${-p[1]*s}`).join(' '),attrs={points:pts,fill:e.closed&&!isBoundary&&r!=='reference'?(r==='door'?'#ca8a0433':'#e05c6633'):'none',stroke:isBoundary?'#d8e0eb':r==='door'?'#ffb64d':r==='reference'?'#45505d':'#c16a75','stroke-width':selectedEntity===e.id?stroke*4:isBoundary?stroke*2:stroke,'data-geometry':e.id,'pointer-events':'stroke'};
        svg.append(el(e.closed?'polygon':'polyline',attrs));
      }
      if(!dirty&&layout){
        if(!setup.allowWallStorage){svg.append(el('polygon',{points:layout.env.poly.map(p=>`${p[0]},${-p[1]}`).join(' '),fill:'none',stroke:'#8394a92a','stroke-width':settings.gangwayWidth*2,'pointer-events':'none','clip-path':'url(#logen-boundary-clip)'}));const defs=el('defs'),clip=el('clipPath',{id:'logen-boundary-clip'});clip.append(el('polygon',{points:layout.env.poly.map(p=>`${p[0]},${-p[1]}`).join(' ')}));defs.append(clip);svg.append(defs);}
        for(const a of L.aisles(layout,settings))svg.append(rect(a,{fill:'#849bb524',stroke:'#849bb54a','stroke-width':stroke,'pointer-events':'none'}));
        for(const group of layout.groups)for(const o of L.placedObjects(group)){
          const rack=o.kind==='rack',active=selected===group.id;
          const shape=rect(o,{fill:rack?'#1d3443':'#e8bd22',stroke:active?'#ffffff':rack?'#8ab7ce':'#fada54','stroke-width':active?stroke*4:stroke*2,'data-storage':group.id,'data-object':o.id,tabindex:'0',role:'button','aria-label':rack?`Rack bay ${o.bayNumber}`:`Ground ${o.pn}, position ${o.position}, ${o.quantity} pallets`});svg.append(shape);
          if(rack){for(const offset of [o.structuralLength/2,(o.rotation%180===0?o.w:o.h)-o.structuralLength/2])svg.append(el('line',o.rotation%180===0?{x1:o.x+offset,y1:-o.y,x2:o.x+offset,y2:-o.y-o.h,stroke:'#8ab7ce','stroke-width':stroke*2,'pointer-events':'none'}:{x1:o.x,y1:-o.y-offset,x2:o.x+o.w,y2:-o.y-offset,stroke:'#8ab7ce','stroke-width':stroke*2,'pointer-events':'none'}));}
          else{const labels=[`PN: ${o.pn}`,`Size: ${fmt(o.length)} × ${fmt(o.width)} × ${fmt(o.height)} mm`,`QTY: ${fmt(o.quantity)}`,`Stacking: ${fmt(o.stacking)}`],size=Math.min(o.h/7,o.w/(Math.max(...labels.map(t=>t.length))*0.65+3));labels.forEach((text,i)=>svg.append(el('text',{x:o.x+o.w/2,y:-o.y-o.h/2+(i-1.5)*size*1.4,'font-family':'Arial, sans-serif','font-size':size,'text-anchor':'middle','dominant-baseline':'central',fill:'#161b22','pointer-events':'none'},text)));}
        }
      }
      for(const [i,r]of (setup.manualObstacles||[]).entries())svg.append(rect(r,{fill:'#ec6b7540',stroke:'#ec6b75','stroke-width':stroke*2,'pointer-events':'none'}));
    }
    function showReserved(){q('[data-reserved-list]').innerHTML=(setup.manualObstacles||[]).map((r,i)=>`<p class="layout-reserved-row">${fmt(r.w)} × ${fmt(r.h)} mm <button class="text-link" data-remove-reserved="${i}">Remove</button></p>`).join('');}
    function showReport(){
      if(!layout){report.innerHTML='<p class="muted">Choose the drawing setup, then generate positions from the existing Parts List.</p>';return;}
      const metric=(label,required,generated,missing)=>`<div><span>${label}</span><strong>${fmt(generated)} / ${fmt(required)}</strong><small>${fmt(missing)} unplaced</small></div>`;
      report.innerHTML=`<div class="layout-validation-head ${layout.complete?'layout-complete':'layout-partial'}"><strong>${dirty?'Setup changed · regenerate':layout.complete?'All Parts List positions placed':'Partial layout · positions need attention'}</strong></div><div class="layout-counts">${metric('Rack pallet positions',layout.rackRequired,layout.generatedRack,layout.unplacedRack)}${metric('Ground storage positions',layout.groundRequired,layout.generatedGround,layout.unplacedGround)}</div>${layout.affected.length||layout.validationErrors.length?`<details open class="layout-issues"><summary>Affected Part Numbers & validation</summary><ul>${[...layout.affected,...layout.validationErrors].map(v=>`<li><strong>${esc(v.pn)}</strong>: ${esc(v.message)}</li>`).join('')}</ul></details>`:''}${layout.unplaced.length?`<details class="layout-issues"><summary>Unplaced rows / runs · select to position manually</summary><div class="layout-unplaced-list">${layout.unplaced.map(g=>`<button class="btn btn-secondary small" data-unplaced="${esc(g.id)}">${esc(g.kind==='rack'?'Rack run '+g.objects[0]?.typeName:'Ground '+g.objects[0]?.pn)} · ${fmt(g.w)} × ${fmt(g.h)} mm</button>`).join('')}</div></details>`:''}`;
    }
    function showProperties(objectId=null){
      if(selectedEntity){const entity=geometry.entities.find(e=>e.id===selectedEntity);properties.innerHTML=`<h3>Drawing object</h3><p>${esc(entity.layer)} · ${esc(entity.type)} · ${esc(entity.id)}</p><label class="field"><span>Role</span><select data-entity-role aria-label="Selected drawing object role">${roleOptions(role(entity))}</select></label>${entity.boundaryEligible?'<button class="btn btn-secondary small" data-use-boundary>Use as warehouse boundary</button>':''}`;return;}
      const group=layout?.groups.find(g=>g.id===selected)||layout?.unplaced.find(g=>g.id===selected);
      if(!group){properties.innerHTML='<p class="muted">Click a rack bay, ground position or original drawing object to inspect it.</p>';return;}
      const o=group.objects.find(o=>o.id===objectId)||group.objects[0],unplaced=!layout.groups.some(g=>g.id===group.id),assignments=new Map();
      for(const a of o.allocations||[])assignments.set(`${a.pn} · L${a.level}`,(assignments.get(`${a.pn} · L${a.level}`)||0)+1);
      properties.innerHTML=`<h3>${o.kind==='rack'?`Rack bay ${fmt(o.bayNumber)} · ${esc(o.typeName)}`:`Ground position ${fmt(o.position)} · ${esc(o.pn)}`}</h3><p class="muted">Object ${esc(o.id)}<br>${o.kind==='rack'?`${fmt(o.w)} × ${fmt(o.h)} mm · ${fmt(o.levels)} levels · ${fmt(o.pallets)} assigned pallets`:`Size ${fmt(o.length)} × ${fmt(o.width)} × ${fmt(o.height)} mm · QTY ${fmt(o.quantity)} · stacking ${fmt(o.stacking)}`}</p>${o.kind==='rack'?`<details><summary>Assigned pallet positions</summary><ul>${[...assignments].map(([pn,qty])=>`<li>${esc(pn)} · ${fmt(qty)} pallets</li>`).join('')||'<li>Empty bay</li>'}</ul></details>`:''}<button class="btn btn-secondary small" data-focus-object="${esc(o.id)}" ${unplaced?'disabled':''}>Zoom to position</button><h4>${unplaced?'Place':'Move'} ${o.kind==='rack'?'rack run':'ground row'}</h4><p class="muted small-note">${fmt(group.objects.length)} ${o.kind==='rack'?'bays':'positions'} move together, keeping their configured clearances and access gangway.</p><div class="layout-coordinate-grid"><label class="field"><span>X (mm)</span><input type="number" step="1" data-move-x value="${Math.round(group.x??layout.env.box.minX)}"></label><label class="field"><span>Y (mm)</span><input type="number" step="1" data-move-y value="${Math.round(group.y??layout.env.box.minY)}"></label></div><label class="checkbox-field"><input type="checkbox" data-move-rotate ${group.rotated?'checked':''}><span>Rotate row / run 90°</span></label><button class="btn btn-secondary small" data-apply-move>${unplaced?'Place':'Apply position'}</button>`;
    }
    function selectStorage(id,objectId){selected=id;selectedEntity=null;showProperties(objectId);draw();}
    function applyMove(x,y,rotated){
      try{if(dirty)throw new Error('Regenerate after changing drawing setup.');L.move(layout,selected,x,y,rotated,plan,settings);message();exported=null;q('[data-layout-pdf]').hidden=true;draw();showProperties();showReport();saveLabel('Position updated · save to keep edits');}catch(error){message(error.message);draw();}
    }
    q('[data-layout-generate]').addEventListener('click',async()=>{
      try{setupValues();if(!q('[data-layout-reviewed]').checked)throw new Error('Review the boundary, units, doors, exits and blocked areas first.');layout=L.generate(plan,settings,geometry,setup,layout);dirty=false;selected=null;selectedEntity=null;exported=null;fit();draw();showProperties();showReport();message();q('[data-layout-export]').disabled=false;await persist();}catch(error){message(error.message);}
    });
    q('[data-layout-save]').addEventListener('click',()=>persist().catch(e=>message(e.message)));
    q('[data-layout-export]').addEventListener('click',async()=>{
      if(!layout||dirty)return;
      if(!layout.complete&&!window.confirm(`This is a partial layout: ${layout.unplacedRack} rack pallet positions and ${layout.unplacedGround} ground positions remain unplaced. Export only the placed objects?`))return;
      const button=q('[data-layout-export]');button.disabled=true;saveLabel('AutoCAD is creating the layout DWG and PDF on this PC…');message();
      try{await persist();exported=await onExport(layout);saveLabel(exported.pdf?'DWG + Excel ZIP downloaded · PDF ready.':'DWG + Excel ZIP downloaded. '+(exported.pdfError||''));q('[data-layout-pdf]').hidden=!exported.pdf;}catch(error){message(error.message);saveLabel('Export did not finish.');}finally{button.disabled=false;}
    });
    q('[data-layout-pdf]').addEventListener('click',()=>exported?.downloadPDF());
    q('[data-layout-units]').addEventListener('change',()=>{setupValues();fit();changed();});
    q('[data-layout-boundary]').addEventListener('change',()=>{setupValues();fit();changed();});
    q('[data-layout-clearance]').addEventListener('change',()=>{setupValues();changed();});
    dialog.addEventListener('change',event=>{
      if(event.target.matches('[data-layout-layer]')){setup.layerRoles={...setup.layerRoles,[layers[Number(event.target.dataset.layoutLayer)]]:event.target.value};changed();}
      if(event.target.matches('[data-entity-role]')){setup.entityRoles={...setup.entityRoles,[selectedEntity]:event.target.value};changed();}
    });
    dialog.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.matches('[data-layout-close]'))dialog.close();
      if(b.matches('[data-layout-helper]'))onHelper?.();
      if(b.matches('[data-focus-object]')&&layout&&!dirty){const o=L.cadObjects(layout).find(o=>o.id===b.dataset.focusObject);if(o){const pad=Math.max(o.w,o.h)*0.12;viewBox=[o.x-pad,-o.y-o.h-pad,o.w+2*pad,o.h+2*pad];draw();}}
      if(b.matches('[data-layout-fit]')){fit();draw();}
      if(b.matches('[data-layout-storage]')&&layout&&!dirty){const objects=L.cadObjects(layout);if(objects.length){const box=L.bounds(objects.flatMap(L.corners)),pad=Math.max(settings.gangwayWidth,(box.maxX-box.minX)*0.12);viewBox=[box.minX-pad,-box.maxY-pad,box.maxX-box.minX+2*pad,box.maxY-box.minY+2*pad];draw();}}
      if(b.matches('[data-layout-zoom]')){const k=b.dataset.layoutZoom==='in'?0.7:1/0.7;viewBox=[viewBox[0]+viewBox[2]*(1-k)/2,viewBox[1]+viewBox[3]*(1-k)/2,viewBox[2]*k,viewBox[3]*k];draw();}
      if(b.matches('[data-use-boundary]')){setup.boundaryId=selectedEntity;q('[data-layout-boundary]').value=selectedEntity;fit();changed();}
      if(b.matches('[data-add-reserved]')){const r={};for(const n of dialog.querySelectorAll('[data-reserved]'))r[n.dataset.reserved]=n.value===''?NaN:Number(n.value);if(!Object.values(r).every(Number.isFinite)||r.w<=0||r.h<=0){message('Enter reserved area coordinates and positive dimensions in mm.');return;}setup.manualObstacles=[...(setup.manualObstacles||[]),r];showReserved();changed();message();}
      if(b.matches('[data-remove-reserved]')){setup.manualObstacles.splice(Number(b.dataset.removeReserved),1);showReserved();changed();}
      if(b.matches('[data-unplaced]'))selectStorage(b.dataset.unplaced);
      if(b.matches('[data-apply-move]'))applyMove(Number(q('[data-move-x]').value),Number(q('[data-move-y]').value),q('[data-move-rotate]').checked);
    });
    function svgPoint(event){const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(svg.getScreenCTM().inverse());}
    svg.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;const node=event.target.closest('[data-storage]'),entity=event.target.closest('[data-geometry]'),point=svgPoint(event);
      if(node&&!dirty){selectStorage(node.dataset.storage,node.dataset.object);const group=layout.groups.find(g=>g.id===selected);drag={kind:'storage',point,x:group.x,y:group.y,rotated:group.rotated,id:group.id};}
      else if(entity){selectedEntity=entity.dataset.geometry;selected=null;showProperties();draw();return;}
      else drag={kind:'pan',point,viewBox:viewBox.slice()};
      svg.setPointerCapture(event.pointerId);event.preventDefault();
    });
    svg.addEventListener('pointermove',event=>{if(drag?.kind!=='pan')return;const p=svgPoint(event);viewBox[0]-=p.x-drag.point.x;viewBox[1]-=p.y-drag.point.y;svg.setAttribute('viewBox',viewBox.join(' '));});
    svg.addEventListener('pointerup',event=>{if(!drag)return;const p=svgPoint(event);if(drag.kind==='storage'&&Math.hypot(p.x-drag.point.x,p.y-drag.point.y)>Math.max(viewBox[2],viewBox[3])/1000)applyMove(Math.round(drag.x+p.x-drag.point.x),Math.round(drag.y-p.y+drag.point.y),!!drag.rotated);drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);});
    svg.addEventListener('pointercancel',()=>{drag=null;});
    svg.addEventListener('keydown',event=>{const node=event.target.closest('[data-storage]');if(node&&(event.key==='Enter'||event.key===' ')){selectStorage(node.dataset.storage,node.dataset.object);event.preventDefault();}});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);showReserved();showReport();showProperties();draw();dialog.showModal();return dialog;
  }
  scope.LogEnLayoutUI=Object.freeze({open});
})(globalThis);
