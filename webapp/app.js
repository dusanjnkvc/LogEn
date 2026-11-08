/* LogEn — local-only application controller. CAD jobs use the loopback helper. */
(async () => {
  'use strict';
  if(globalThis.LogEnAccess)await globalThis.LogEnAccess.ready;
  const D = globalThis.LogEnDomain;
  const W = new globalThis.LogEnWorkbook();
  const E = globalThis.LogEnEditors;
  const KEY = 'logen.offline.workspace.v1';
  const BACKUP = `${KEY}.previous`;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const area = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const count = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-GB') : '—';
  const decimal = n => {
    if(typeof n!=='number'||!Number.isFinite(n))return '—';
    const magnitude=Math.abs(n);
    if(magnitude>0&&magnitude<1e-8)return n.toExponential(4);
    return n.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:magnitude>0&&magnitude<0.0001?8:4});
  };
  const signed = n => typeof n === 'number' && Number.isFinite(n) ? `${n>0?'+':''}${decimal(n)}` : '—';
  const encode = value => JSON.stringify(value, (_, item) => typeof item === 'number' && !Number.isFinite(item) ? {$logenNumber: String(item)} : item);
  const decode = text => JSON.parse(text, (_, item) => item && typeof item === 'object' && Object.keys(item).length === 1 && '$logenNumber' in item ? Number(item.$logenNumber) : item);
  let state = { version: 3, projects: [], deletedProjects: [], activeId: null };
  let view = 'dashboard', query = '', invalidOnly = false, page = 0, busy = false, loadError = null, saveError = false;
  let toastTimer;
  let viewerController=null,viewerRenderToken=0;
  let productionDrafts = {};
  let mismatchesOnly = false;
  const PAGE_SIZE = 30;
  const project = () => state.projects.find(p => p.id === state.activeId) || state.projects[0];
  let selectedCategory=null, categoryProject=null;
  const calc = () => {if(categoryProject!==project().id){selectedCategory=null;categoryProject=project().id;}return D.calculateProject(project().parts, project().settings,selectedCategory);};
  function categorySelector(){const values=[...new Set(project().parts.map(p=>String(p.category||'').trim()))].sort();return `<label class="field category-filter"><span>Category</span><select id="category-filter" aria-label="Category"><option value="null" ${selectedCategory===null?'selected':''}>All categories</option>${values.map(v=>`<option value="${escape(JSON.stringify(v))}" ${selectedCategory===v?'selected':''}>${escape(v||'Uncategorized')}</option>`).join('')}</select></label>`;}

  function exampleProject() {
    const rows = [
      ['LE-1001',20,7,40,1000,5,1200,800,1000,3],
      ['LE-1002',12,24,48,1800,8,1200,800,900,4],
      ['LE-1003',24,16,30,1400,7,1000,800,950,3],
      ['LE-1004',10,32,60,2500,10,1200,1000,1000,2],
      ['LE-1005',50,12,24,2000,6,1200,800,850,4],
      ['LE-1006',16,18,40,1600,9,1000,1000,1000,3],
    ];
    return { id: 'example-warehouse', name: 'Example warehouse', parts: rows.map(v => ({partNumber:v[0],qtyBox:v[1],qtyOnPallet:v[3],consumptionPerShift:v[4]/2,doh:v[5],length:v[6],width:v[7],height:v[8],stacking:v[9],inputErrors:[]})), settings: D.createDefaultSettings(), sourceName: 'Example inventory', rawInputRows: null, updatedAt: new Date().toISOString() };
  }
  function validateWorkspace(value) {
    if (!value || ![1,2,3].includes(value.version) || !Array.isArray(value.projects) || !value.projects.length) throw new Error('This is not a LogEn workspace backup.');
    const ids = new Set();
    if(value.deletedProjects!==undefined&&!Array.isArray(value.deletedProjects))throw new Error('The deleted project structure is invalid.');
    value.deletedProjects=value.deletedProjects||[];
    for (const p of [...value.projects,...value.deletedProjects]) {
      if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.parts) || !p.settings || typeof p.settings !== 'object') throw new Error('The saved project structure is invalid.');
      ids.add(p.id);
      const hadStackability = Object.prototype.hasOwnProperty.call(p.settings,'stackabilityEnabled');
      p.settings = { ...D.createDefaultSettings(), ...p.settings, buildingHeight:p.settings.buildingHeight===undefined?(p.settings.maxFloorStackingHeight??5000):p.settings.buildingHeight };
      if(!hadStackability)p.settings.stackabilityEnabled=p.parts.some(part=>part&&Number(part.stacking)>1);
      for (const part of p.parts) {
        if (!part || typeof part.partNumber !== 'string') throw new Error('A saved part is missing its part number.');
        part.inputErrors = Array.isArray(part.inputErrors) ? part.inputErrors.map(String) : [];
      }
      p.parts = p.parts.map(part => {
        const legacy = !Object.prototype.hasOwnProperty.call(part,'consumptionPerShift');
        return {...D.normalizePart(part,p.settings),shiftModelMigrated:part.shiftModelMigrated || legacy};
      });
      if(p.settings.coverageMode==='24h'){p.settings.coverageMode='custom';p.settings.customCoverageDays=1;}
      if(p.settings.coverageMode==='48h'){p.settings.coverageMode='custom';p.settings.customCoverageDays=2;}
      p.settings.stockMode='consumption';
    }
    value.version=3;
    if (!value.projects.some(p=>p.id===value.activeId)) value.activeId = value.projects[0].id;
    return value;
  }
  function save() {
    try {
      const serialized = encode(state);
      const previous = localStorage.getItem(KEY);
      if (previous) localStorage.setItem(BACKUP, previous);
      localStorage.setItem(KEY, serialized);
      saveError = false;
      $('save-status').textContent = 'Saved locally';
    } catch (error) {
      saveError = true;
      $('save-status').textContent = 'Unsaved changes';
      toast('Browser storage is unavailable or full. Download a workspace backup to keep your changes.', true);
    }
  }
  function update(changes, preserveFocus=false) {
    const active=preserveFocus ? document.activeElement : null;
    const focusId=active?.id;
    const selection=active?.type==='text' ? [active.selectionStart,active.selectionEnd] : null;
    const p = project();
    Object.assign(p, changes, { updatedAt: new Date().toISOString() });
    save(); render();
    if(focusId && $(focusId)) {$(focusId).focus({preventScroll:true});if(selection)$(focusId).setSelectionRange(...selection);}
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').className = `show${error ? ' toast-error' : ''}`;
    toastTimer = setTimeout(() => $('toast').className = '', error ? 8000 : 4500);
  }
  function download(bytes, filename, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const blob = new Blob([bytes], {type});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function safeName(name) { return name.replace(/[^a-z0-9 _-]/gi,'').trim().replace(/\s+/g,'_') || 'LogEn'; }
  async function work(label, action) {
    if (busy) return;
    busy = true;
    const overlay = document.createElement('div'); overlay.className = 'busy-indicator'; overlay.setAttribute('role','status');
    overlay.innerHTML = `<span class="spinner"></span><span>${escape(label)}</span>`; document.body.append(overlay);
    try { await new Promise(resolve => setTimeout(resolve, 30)); await action(); }
    catch (error) { console.error(error); toast(error.message || 'The operation could not be completed.', true); }
    finally { busy = false; overlay.remove(); }
  }
  function modal({ title, eyebrow = 'LOGEN', body, confirm = 'Continue', danger = false, cancel = 'Cancel' }) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.innerHTML = `<div class="dialog-head"><div class="eyebrow">${escape(eyebrow)}</div><h2>${escape(title)}</h2></div><div class="dialog-body">${body}</div><div class="dialog-actions">${cancel ? `<button class="btn btn-secondary" data-cancel>${escape(cancel)}</button>` : ''}<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escape(confirm)}</button></div>`;
      document.body.append(dialog);
      dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-confirm]').addEventListener('click', () => dialog.close('ok'));
      dialog.addEventListener('close', () => {const accepted = dialog.returnValue === 'ok'; dialog.remove(); resolve(accepted);}, {once:true});
      dialog.showModal();
    });
  }
  function heading(eyebrow, title, subtitle, actions = '') {
    return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></section>`;
  }
  function importButtons() {
    return `<div class="warehouse-heading-actions"><button class="improve-warehouse" data-action="improve-warehouse" aria-label="✦ Improve Warehouse →"><span class="ai-sparkle" aria-hidden="true">✦</span><span>Improve Warehouse</span><span aria-hidden="true">→</span></button><div class="import-actions"><button class="btn btn-secondary" data-action="template">${icon('download')}Download template</button><button class="btn btn-primary" data-action="import">${icon('upload')}Import Excel</button></div></div>`;
  }
  async function improveWarehouse(){
    const p=project(),dialog=document.createElement('dialog');
    const initial=Number.isSafeInteger(p.improvementThreshold)&&p.improvementThreshold>=0?p.improvementThreshold:2;
    const category=selectedCategory===null?'All categories':selectedCategory||'Uncategorized';
    dialog.className='warehouse-improvement-dialog';
    dialog.innerHTML=`<div class="dialog-head"><div class="eyebrow">MIXED STORAGE PLANNING</div><h2>Improve Warehouse</h2><p class="muted">${escape(p.name)} · ${escape(category)}</p></div><div class="dialog-body"><label class="field"><span>Maximum pallets per part number stored in racks</span><input id="rack-planning-threshold" type="number" min="0" step="1" value="${initial}" aria-describedby="rack-threshold-rule"></label><p id="rack-threshold-rule" class="muted">Parts needing this quantity or fewer go in racks. Parts above it go on the ground. All required pallets for each PN stay together.</p><section id="storage-split-results" aria-live="polite"></section></div><div class="dialog-actions"><button class="btn btn-secondary" data-split-settings>Warehouse settings</button><button class="btn btn-primary" data-split-close>Close</button></div>`;
    const input=dialog.querySelector('input'),results=dialog.querySelector('#storage-split-results');
    function refresh(){
      const threshold=input.value.trim()===''?NaN:Number(input.value);
      if(!Number.isSafeInteger(threshold)||threshold<0){input.setAttribute('aria-invalid','true');results.innerHTML='<div class="notice error">Enter a whole number of at least 0.</div>';return;}
      input.removeAttribute('aria-invalid');p.improvementThreshold=threshold;save();
      const plan=D.calculateStorageSplit(p.parts,p.settings,threshold,selectedCategory),r=plan.rack;
      if(plan.settingsErrors.length){results.innerHTML=`<div class="notice error">${plan.settingsErrors.map(escape).join('<br>')}</div>`;return;}
      const metric=(label,value)=>`<div><span>${label}</span><strong>${area(value)} m²</strong></div>`;
      const failures=[...plan.unassigned.map(row=>({row,reason:'Demand unavailable — unassigned'})),...plan.groundInvalid.map(row=>({row,reason:'Ground calculation invalid'})),...plan.rackInvalid.map(row=>({row,reason:'Assigned to racks but does not fit or needs review'}))];
      const assignmentRows=[...plan.rackRows.map(row=>({row,storage:'rack'})),...plan.groundRows.map(row=>({row,storage:'ground'})),...plan.unassigned.map(row=>({row,storage:'unassigned'}))];
      results.innerHTML=`<p><strong>≤ ${count(threshold)} pallets → racks</strong> · ${count(plan.rackRows.length)} PNs / ${count(plan.rackPallets)} pallets<br><strong>&gt; ${count(threshold)} pallets → ground</strong> · ${count(plan.groundRows.length)} PNs / ${count(plan.groundPallets)} pallets</p><div class="improvement-metrics split-metrics">${metric('Racks — without gangways',r.rackWithoutGangways)}${metric('Racks — with allocated gangways',r.rackWithGangways)}${metric('Ground — without gangways',plan.groundWithoutGangways)}${metric('Ground — with allocated gangways',plan.groundWithGangways)}</div><div class="notice"><strong>Combined footprint</strong><br>Without gangways: ${area(r.rackWithoutGangways+plan.groundWithoutGangways)} m²<br>With allocated gangways: ${area(r.rackWithGangways+plan.groundWithGangways)} m²</div>${failures.length?`<div class="notice error"><strong>Partial totals · ${count(failures.length)} PNs need review</strong><p>These assigned quantities are excluded from their storage areas until corrected.</p><ul>${failures.map(({row,reason})=>`<li>${escape(row.input.partNumber||'(blank PN)')} · ${row.isPlanningValid?count(row.requiredPallets)+' pallets':'Quantity unavailable'} · ${escape(reason)}</li>`).join('')}</ul></div>`:''}${!r.sharedRack?.available?`<div class="notice error">${escape(r.sharedRack?.error||'Shared rack layout unavailable.')} Rack totals use standalone estimates.</div>`:''}<details><summary>Part assignment list (${count(assignmentRows.length)})</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Part Number</th><th>Required pallets</th><th>Storage</th></tr></thead><tbody>${assignmentRows.map(({row,storage})=>`<tr data-improvement-pn="${escape(row.input.partNumber)}" data-improvement-storage="${storage}"><td>${escape(row.input.partNumber)}</td><td>${row.isPlanningValid?count(row.requiredPallets):'Unavailable'}</td><td>${storage==='rack'?'Rack storage':storage==='ground'?'Ground storage':'Unassigned'}</td></tr>`).join('')}</tbody></table></div></details><p class="muted">Automatic / Improve Warehouse in Warehouse Designer uses this same list. Manual per-part assignments are a separate mode. Rack PNs share shelves using the configured rack types and storage rules. This scenario follows the selected category and does not change the four comparison cards. Gangway-inclusive areas are allocated estimates.</p>`;
    }
    input.addEventListener('input',refresh);
    dialog.querySelector('[data-split-close]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('[data-split-settings]').addEventListener('click',()=>{dialog.close();settings();});
    dialog.addEventListener('close',()=>{dialog.remove();if(view==='implementation')renderImplementation();},{once:true});document.body.append(dialog);refresh();dialog.showModal();input.focus();
  }
  function validationBanner(c) {
    if (c.settingsErrors?.length) return `<div class="notice error"><strong>Warehouse settings need attention.</strong> Results are unavailable until these are corrected.<ul class="validation-list">${c.settingsErrors.map(e => `<li>${escape(e)}</li>`).join('')}</ul><button class="btn btn-secondary small" data-action="settings">Review settings</button></div>`;
    if (c.invalidCount) return `<div class="notice error"><strong>Partial totals · ${count(c.invalidCount)} invalid part ${c.invalidCount === 1 ? 'number' : 'numbers'}.</strong> Floor totals include ${count(c.floorValidCount)} calculable parts; rack totals include ${count(c.rackValidCount)}. A rack-fit error does not exclude valid floor storage. Invalid rows remain visible for correction. <button class="btn btn-ghost small" data-action="invalid">Review invalid rows ${icon('arrow')}</button></div>`;
    return '';
  }
  function kpi(title, value, rack, allocated, unavailable, breakdown = '') {
    return `<article class="kpi-card ${!rack ? 'accent' : ''}"><div class="kpi-top"><button class="kpi-icon ${rack ? 'rack' : ''}" data-action="${rack?'rack-overview':'parts'}" aria-label="${rack?'Open shared rack shelf overview':'Open part details'}" ${!rack&&!allocated&&!unavailable?`title="${count(Math.ceil(value/33.32))} trucks · ROUNDUP(${area(value)} m² ÷ 33.32)"`:''}>${icon(rack ? 'rack' : 'box')}</button><span class="kpi-tag">${allocated ? 'ALLOCATED FOOTPRINT' : 'STORAGE ONLY'}</span></div><h2>${title}</h2><div class="kpi-value">${unavailable ? '—' : area(value)}<small>m²</small></div><div class="kpi-description">${allocated ? (rack ? 'Rack storage + half-shared gangway allocation' : 'GS net + half-shared gangway allocation') : rack ? escape(breakdown || 'Ground area · all rack levels included') : 'Sum of Floor storage m²'}</div></article>`;
  }
  function savingsItem(label, value, percent) {
    const unavailable = typeof value !== 'number' || !Number.isFinite(value);
    const positive = value >= 0;
    return `<div class="saving-item"><span class="saving-label">${label}</span><div class="saving-number ${unavailable ? '' : positive ? 'positive' : 'negative'}">${area(value)} <small>m²</small></div><div class="saving-bottom"><span>${unavailable ? 'Results unavailable' : value === 0 ? 'Same floor area in both scenarios' : positive ? 'Less floor space with racks' : 'More floor space with racks'}</span><span class="saving-percent ${!unavailable && !positive ? 'negative' : ''}">${percent == null ? '— %' : `${percent.toFixed(1)}% ${positive ? 'saving' : 'increase'}`}</span></div></div>`;
  }
  function coverageTargetLabel(s) {
    return s.coverageMode==='custom' ? `${decimal(s.customCoverageDays)} DOH override` : 'DOH from each part';
  }
  function coverageBanner(c) {
    const migrated=project().parts.some(p=>p.shiftModelMigrated);
    const inferred=project().parts.some(p=>p.packagingInferred);
    return migrated||inferred ? `<div class="notice">Saved inputs have been converted to per-shift consumption using their previous production settings. ${inferred?'Where box quantities were unavailable, pallet capacity is represented as one box per pallet; review QTY in Box and QTY boxes per Pallet. ':''}Pallet demand is multiplied by the selected shifts, then multiplied by DOH; only the final required pallets round up.</div>` : '';
  }
  function productionPanel(c) {
    const s=project().settings;
    const valid=c.results.filter(r=>r.isPlanningValid).map(r=>r.planning);
    const sum=key=>valid.reduce((total,p)=>total+(Number.isFinite(p[key])?p[key]:0),0);
    const field=(key,label,unit)=>`<label class="field"><span>${label}</span><div class="input-unit"><input type="text" inputmode="decimal" id="production-${key}" data-production="${key}" aria-label="${label}" value="${escape(productionDrafts[key] ?? (Number.isFinite(s[key])?String(s[key]):''))}" autocomplete="off"><span class="field-unit muted">${unit}</span></div></label>`;
    const totals=[['Consumption per shift',sum('shiftConsumption'),'parts / shift'],['Daily consumption',sum('dailyConsumption'),'parts / day'],['Planning demand',sum('plannedPalletsPerDay'),'pallets / day'],['Pallets per shift',sum('palletsPerShift'),'pallets / shift'],['Required storage pallets',c.totalRequiredPallets,'pallets']];
    return `<section class="panel production-panel"><div class="panel-head"><div><h2>Shifts & days on hand</h2><p>Keep decimals through shifts and DOH; round up only the final pallets</p></div><button class="text-link" data-action="consumption">View calculation details ${icon('arrow')}</button></div><div class="production-controls shift-controls"><label class="field"><span>Number of shifts per day</span><select id="production-shiftsPerDay" data-production="shiftsPerDay" aria-label="Number of shifts per day">${![1,2,3].includes(s.shiftsPerDay)?`<option selected disabled value="${escape(s.shiftsPerDay)}">Invalid: choose 1–3</option>`:''}${[1,2,3].map(n=>`<option value="${n}" ${s.shiftsPerDay===n?'selected':''}>${n} ${n===1?'shift':'shifts'} per day</option>`).join('')}</select></label><label class="field"><span>DOH source</span><select id="production-coverageMode" data-production-coverage aria-label="DOH source">${[['input','Use DOH from each part'],['custom','Use DOH override for all parts']].map(([value,label])=>`<option value="${value}" ${s.coverageMode===value?'selected':''}>${label}</option>`).join('')}</select></label>${field('customCoverageDays','DOH override','days')}</div><div class="production-totals">${totals.map(([label,value,unit],i)=>`<div>${label==='Required storage pallets'?'<button class="metric-drilldown" data-action="required-pallets" aria-label="Show required pallets rack fit">':''}<span>${label}</span><strong>${c.settingsErrors?.length?'—':i>=2?count(value):decimal(value)}</strong><small>${unit}</small>${label==='Required storage pallets'?'</button>':''}</div>`).join('')}${categorySelector()}</div></section>`;
  }
  function coverageCell(p) {
    if(!p)return '—';
    if(p.noConsumption)return '<span class="badge">No consumption</span>';
    return `<span class="${p.coverageMismatch?'coverage-difference':''}">${signed(p.coverageDifferenceDays)}</span>${p.coverageMismatch?'<small class="difference-caption">actual − input</small>':'<span class="badge good">Match</span>'}`;
  }
  function stackingControl(result) {
    return `<span>${count(result.isFloorValid ? result.floor?.effectiveStacking : null)}</span>`;
  }
  function renderConsumption(c) {
    $('main').innerHTML=heading('PER-SHIFT DEMAND, DECIMAL PALLETS','Shift consumption planning','Packaging quantities, consumption per shift and DOH determine the pallets used in both storage scenarios.',`<button class="btn btn-secondary" data-action="export">${icon('download')}Export results</button><button class="btn btn-primary" data-action="add">${icon('plus')}Add part number</button>`)+validationBanner(c)+coverageBanner(c)+productionPanel(c)+
      `<div class="table-tools consumption-tools"><label class="search-field">${icon('search')}<input id="consumption-search" type="search" aria-label="Search consumption part number" placeholder="Search part number…" value="${escape(query)}"></label><span class="muted small-note">Planning DOH: ${escape(coverageTargetLabel(project().settings))}</span></div><section class="panel" id="consumption-table"></section>`;
    renderConsumptionTable(c);
    $('consumption-search').addEventListener('input',e=>{query=e.target.value;page=0;renderConsumptionTable(calc());});
  }
  function renderConsumptionTable(c) {
    if(!c.results.length){$('consumption-table').innerHTML=emptyInventory();return;}
    const indexed=c.results.map((r,index)=>({r,index})).filter(({r})=>r.input.partNumber.toLowerCase().includes(query.toLowerCase()));
    const pages=Math.max(1,Math.ceil(indexed.length/PAGE_SIZE));page=Math.min(page,pages-1);
    const headers=['Part number','QTY in Box','QTY boxes per Pallet','Parts / pallet','Consumption / shift','Pallets / shift (decimal)','Raw pallets / day','Shifts / day','Input DOH','Used DOH','Parts / day','Consumption pallets / day','Planning pallets / day','Required pallets','Floor storage m²','Rack storage m²','Floor stacking factor','Actions'];
    $('consumption-table').innerHTML=`<div class="table-scroll"><table class="data-table consumption-table"><thead><tr>${headers.map((h,i)=>`<th class="${i>0&&i<16?'numeric':''}">${h}</th>`).join('')}</tr></thead><tbody>${indexed.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(({r,index})=>{
      const p=r.isPlanningValid?r.planning:null;
      const values=[count(r.input.qtyBox),count(r.input.qtyOnPallet),count(p?.partsPerPallet),decimal(r.input.consumptionPerShift),decimal(p?.palletsPerShift),decimal(p?.palletsPerDay),count(project().settings.shiftsPerDay),decimal(r.input.doh),decimal(p?.targetCoverageDays),decimal(p?.dailyConsumption),decimal(p?.palletsPerDay),count(p?.plannedPalletsPerDay),count(r.isPlanningValid?r.requiredPallets:null),area(r.isFloorValid?r.floor?.storageArea:null),area(r.isRackValid?r.rack?.withoutGangways:null)];
      return `<tr><td><button class="part-link" data-detail="${index}">${icon('box')}${escape(r.input.partNumber||'(blank part number)')}</button>${!r.isValid?'<small class="difference-caption error">Review validation</small>':''}</td>${values.map(v=>`<td class="numeric">${v}</td>`).join('')}<td>${stackingControl(r,index)}</td><td><button class="icon-btn" data-edit="${r.sourceIndex??index}" aria-label="Edit ${escape(r.input.partNumber)}" title="Edit part">${icon('edit')}</button></td></tr>`;
    }).join('')||'<tr><td colspan="18" style="text-align:center;padding:35px">No matching part numbers.</td></tr>'}</tbody></table></div><div class="table-footer"><span>${count(indexed.length)} matching parts · Raw pallets × selected shifts → decimal daily demand → multiply by DOH → space calculation</span><span class="project-floor-total">Whole project Floor storage m²: ${c.settingsErrors?.length?'—':area(c.floorWithoutGangways)} m²</span><div class="pagination"><button data-consumption-page="-1" ${page===0?'disabled':''}>Previous</button><span>${page+1} / ${pages}</span><button data-consumption-page="1" ${page===pages-1?'disabled':''}>Next</button></div></div>`;
  }
  function renderDashboard(c) {
    const p = project(), unavailable = c.settingsErrors?.length;
    const values = [c.floorWithoutGangways,c.floorWithGangways,c.rackWithoutGangways,c.rackWithGangways];
    const max = Math.max(...values, 1);
    const chartLabels = [['Floor pallets','Without gangways',''],['Floor pallets','With gangways · allocated','floor-allocated'],['Pallet racks','Without gangways','rack'],['Pallet racks','With gangways · allocated','rack-allocated']];
    const stats = [['Imported part numbers',c.results.length,''],['Required pallets',c.totalRequiredPallets,''],['Floor positions',c.totalFloorPositions,''],['Dedicated floor rows',c.totalFloorRows,''],['Required rack bays',c.totalRackBays,''],['Required rack runs',c.totalRackRuns,''],['Floor gangway area',c.floorGangwayArea,'m²'],['Rack gangway area',c.rackGangwayArea,'m²']];
    const source = p.sourceName || 'Manual inventory';
    const date = new Date(p.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    $('main').innerHTML = heading('PLAN YOUR SPACE', 'Warehouse footprint', 'The same inventory. Four perspectives on your warehouse space.', importButtons()) +
      validationBanner(c) + (saveError ? '<div class="notice error">Changes are in memory only. Download a workspace backup from Projects to keep this work.</div>' : '') +
      `<div class="context-strip"><div class="source-info"><span class="file-icon">${p.sourceName?.endsWith('.xlsx') ? 'XLSX' : 'DATA'}</span><div><strong>${escape(source)} ${source === 'Example inventory' ? '<span class="badge" style="margin-left:7px">SAMPLE DATA</span>' : ''}</strong><small>${count(c.results.length)} part numbers · Updated ${escape(date)} · ${escape(p.name)}</small></div></div><span class="source-check">${icon(c.invalidCount ? 'info' : 'check')}${c.invalidCount ? `${c.invalidCount} need attention` : 'All parts validated'}</span><button class="btn btn-ghost" data-action="export">${icon('download')}Export results</button></div>` +
      coverageBanner(c)+
      `<div class="mode-toolbar"><div class="section-label">Footprint comparison<span>Same required pallets for floor and racks</span></div><span class="badge">${count(p.settings.shiftsPerDay)} shifts/day · ${escape(coverageTargetLabel(p.settings))}</span></div>` +
      `<div class="kpi-grid">${kpi('PALLETS — WITHOUT GANGWAYS',values[0],false,false,unavailable)}${kpi('PALLETS — WITH GANGWAYS',values[1],false,true,unavailable)}${kpi('RACKS — WITHOUT GANGWAYS',values[2],true,false,unavailable, c.sharedRack?.typeUsage?.length>1?`${count(c.totalRackBays)} bays · ${c.sharedRack.typeUsage.length} rack types`:`${count(c.totalRackBays)} bays × ${area(c.totalRackBays?c.rackWithoutGangways/c.totalRackBays:0)} per bay`)}${kpi('RACKS — WITH GANGWAYS',values[3],true,true,unavailable)}</div>` +productionPanel(c)+floorStackingOptions()+(c.sharedRack&&!c.sharedRack.available?`<div class="notice error">${escape(c.sharedRack.error)} Rack figures use standalone estimates.</div>`:'')+
      `<div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Floor vs. rack storage</h2><p>Compare the four footprint scenarios</p></div><span class="unit-tag">m²</span></div><div class="chart" role="img" aria-label="Footprint comparison: ${values.map(area).join(', ')} square meters"><div style="display:${unavailable ? 'block' : 'none'}" class="notice error">Correct warehouse settings to calculate footprints.</div>${chartLabels.map((r,i) => `<div class="chart-row"><div class="chart-label">${r[0]}<small>${r[1]}</small></div><div class="chart-track"><div class="chart-bar ${r[2]}" style="width:${unavailable ? 0 : values[i]/max*100}%"></div></div><span class="chart-number">${unavailable ? '—' : area(values[i])}</span></div>`).join('')}</div><div class="chart-legend"><span><i class="legend-dot"></i>Floor pallets</span><span><i class="legend-dot rack"></i>Pallet racks</span><span>Striped = allocated gangways included</span></div></section><section class="panel savings-panel"><div class="panel-head"><div><h2>Space savings with racks</h2><p>Floor footprint minus rack footprint</p></div>${icon('chart')}</div>${c.results.some(r=>r.isFloorValid!==r.isRackValid)?'<div class="notice">Floor and rack totals cover different parts; savings compare partial inventories.</div>':''}<div class="saving-items">${savingsItem('WITHOUT GANGWAYS',unavailable ? null : c.savingWithoutGangways,unavailable ? null : c.savingWithoutGangwaysPercent)}${savingsItem('WITH ALLOCATED GANGWAYS',unavailable ? null : c.savingWithGangways,unavailable ? null : c.savingWithGangwaysPercent)}</div></section></div>` +
      `<section class="panel stats-panel"><div class="panel-head"><h2>Warehouse at a glance</h2><button class="text-link" data-action="settings">Configure warehouse ${icon('settings')}</button></div><div class="stats-grid">${stats.map(([label,value,unit],i) => `<div class="stat"><span class="stat-label">${label}</span><div class="stat-value-row"><span class="stat-value">${unavailable && i > 0 ? '—' : unit ? area(value) : count(value)}${unit ? `<small>${unit}</small>` : ''}</span>${i===0 && c.invalidCount ? `<span class="badge error">${c.invalidCount} invalid</span>` : ''}</div></div>`).join('')}</div></section>` +

      `<section class="panel table-panel"><div class="panel-head"><div><h2>Part number overview</h2><p>Tap any part number to see the formulas behind it</p></div><button class="text-link" data-action="parts">View all parts ${icon('arrow')}</button></div>${previewTable(c)}<div class="table-footer"><span>Showing ${Math.min(c.results.length,4)} of ${c.results.length} part numbers</span><span>Same required pallets in both scenarios</span></div></section>`;
  }
  function previewTable(c) {
    if (!c.results.length) return emptyInventory();
    return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Part number</th><th class="numeric">Required pallets</th><th class="numeric">Floor · storage m²</th><th class="numeric">Rack · storage m²</th><th>Status</th></tr></thead><tbody>${c.results.slice(0,4).map((r,i) => `<tr><td><button class="part-link" data-detail="${i}">${icon('box')}${escape(r.input.partNumber || '(blank part number)')}</button></td><td class="numeric">${count(r.isPlanningValid?r.requiredPallets:null)}</td><td class="numeric">${area(r.isFloorValid?r.floor?.storageArea:null)}</td><td class="numeric">${area(r.isRackValid?r.rack?.withoutGangways:null)}</td><td><span class="badge ${r.isValid ? 'good' : 'error'}">${r.isValid ? 'Validated' : 'Needs attention'}</span></td></tr>`).join('')}</tbody></table></div>`;
  }
  function emptyInventory() {
    return `<div class="empty-state">${icon('box')}<h2>Your inventory starts here</h2><p>Import an Excel workbook or add parts manually. LogEn calculates floor and rack storage for every part automatically.</p><div class="actions"><button class="btn btn-primary" data-action="import">${icon('upload')}Import Excel</button><button class="btn btn-secondary" data-action="add">${icon('plus')}Add a part</button></div></div>`;
  }
  function floorStackingOptions() {
    const s=project().settings,mode=D.floorStackingMode(s);
    return `<section class="panel floor-stacking-options"><label class="field"><span>Floor stacking mode</span><select id="floor-stacking-mode" data-floor-stacking-mode aria-label="Floor stacking mode">${[['height','Calculate from floor stacking height'],['imported','Use stacking from uploaded file'],['manual','One manual factor for all parts']].map(([key,label])=>`<option value="${key}" ${mode===key?'selected':''}>${label}</option>`).join('')}</select></label>${mode==='manual'?`<label class="field"><span>Stacking factor for all parts</span><input id="manual-floor-stacking" data-manual-floor-stacking type="text" inputmode="numeric" aria-label="Stacking factor for all parts" value="${escape(productionDrafts.manualStacking ?? (s.stackingMode==='manual'?s.manualStacking:1))}"></label>`:''}<p class="muted">${mode==='height'?`ROUNDDOWN(Maximum floor stacking height ÷ loaded pallet H). Ground stacking height limit in Warehouse settings: ${count(s.maxFloorStackingHeight)} mm.`:mode==='imported'?'Uses each part’s imported Stacking factor. Missing Stacking defaults to 1. The eight-column template accepts an optional Stacking column.':'One whole factor applies to all parts.'} All factors are capped by Maximum floor stacking height; pallets taller than this limit show an error.</p></section>`;
  }
  function renderParts(c) {
    $('main').innerHTML = heading('EVERY PART, BOTH SCENARIOS', 'Part details', 'Search your inventory, review validation, and explore each calculation.', `<button class="btn btn-secondary" data-action="export">${icon('download')}Export results</button><button class="btn btn-primary" data-action="add">${icon('plus')}Add part number</button>`) + validationBanner(c) +
      `<div class="input-summary"><span>DOH: <strong>${escape(coverageTargetLabel(project().settings))}</strong></span><span>Shifts/day: <strong>${count(project().settings.shiftsPerDay)}</strong></span><span>Rack types: <strong>${D.configuredRackTypes(project().settings).length}</strong></span></div><div class="table-tools"><label class="search-field">${icon('search')}<input id="part-search" type="search" placeholder="Search part number…" aria-label="Search part number" value="${escape(query)}"></label><label class="toggle-label"><input id="invalid-filter" type="checkbox" ${invalidOnly ? 'checked' : ''}>Only invalid parts</label><div class="actions"><button class="btn btn-secondary" data-action="consumption">${icon('chart')}Shift calculation details</button><button class="btn btn-secondary" data-action="import">${icon('upload')}Import Excel</button><button class="btn btn-ghost" data-action="template">${icon('download')}Template</button></div></div><section class="panel" id="parts-table"></section>`;
    renderPartsTable(c);
    $('part-search').addEventListener('input', e => {query=e.target.value;page=0;renderPartsTable(calc());});
    $('invalid-filter').addEventListener('change', e => {invalidOnly=e.target.checked;page=0;renderPartsTable(calc());});
  }
  function renderPartsTable(c) {
    const indexed = c.results.map((r,index) => ({r,index})).filter(({r}) => r.input.partNumber.toLowerCase().includes(query.toLowerCase()) && (!invalidOnly || !r.isValid));
    const pages = Math.max(1, Math.ceil(indexed.length/PAGE_SIZE)); page=Math.min(page,pages-1);
    const rows = indexed.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
    if (!c.results.length) { $('parts-table').innerHTML=emptyInventory(); return; }
    const headers = ['Part number','Required pallets','Floor stacking','Floor positions','Floor rows','Floor storage m²','Floor allocated m²','Rack Fit','Boxes per Rack Slot','Rack levels','Required Rack Bays','Rack runs','Rack SQM Without Gangways','Rack allocated m²','Unused Rack Surface (m²)','Rack Utilization (%)','Input details','Validation','Actions'];
    $('parts-table').innerHTML = `<div class="rack-fit-summary notice">Rack shelf fit check: ${count(c.nonFittingPallets)} required rack units across ${count(c.nonFittingPartCount)} part numbers do NOT fit. ${count(c.nonFittingUnknownQuantity)} non-fitting part numbers have unavailable pallet quantities. Fit checks all configured rack types using their storage options. Each Required storage pallet is one rack unit. Missing dimensions show N/A.<br>Unused shelf surface: ${area(c.rackUnusedShelfArea)} m² · Available: ${area(c.rackAvailableShelfArea)} m² · Occupied: ${area(c.rackOccupiedShelfArea)} m² · Overall utilization: ${area(c.rackUtilizationPercent)}%. Shelf waste is not warehouse floor space. ${c.sharedRack?.available?'Rack totals share shelves across PNs; part rows show standalone rack estimates.':'Shared layout unavailable; totals use standalone estimates. Open the rack overview for details.'}</div><div class="table-scroll"><table class="data-table"><thead><tr>${headers.map((h,i)=>`<th class="${i>0&&i<13?'numeric':''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(({r,index}) => {
      const numbers = [count(r.isPlanningValid?r.requiredPallets:null),count(r.isFloorValid?r.floor?.effectiveStacking:null),count(r.isFloorValid?r.floor?.positions:null),count(r.isFloorValid?r.floor?.rows:null),area(r.isFloorValid?r.floor?.storageArea:null),area(r.isFloorValid?r.floor?.withGangways:null),r.rackFit||'N/A',count(r.isRackValid?r.rack?.palletsPerSlot:r.rackFit==='NO'?0:null),count(r.isRackValid?r.rack?.levels:null),count(r.isRackValid?r.rack?.bays:r.rackFit==='NO'?0:null),count(r.isRackValid?r.rack?.runs:null),area(r.isRackValid?r.rack?.withoutGangways:null),area(r.isRackValid?r.rack?.withGangways:null),area(r.isRackValid?r.rack?.unusedShelfArea:null),area(r.isRackValid?r.rack?.utilizationPercent:null)];
      return `<tr><td><button class="part-link" data-detail="${index}">${icon('box')}${escape(r.input.partNumber || '(blank part number)')}</button></td>${numbers.map((n,i)=>`<td class="numeric">${i===1?stackingControl(r,index):n}</td>`).join('')}<td><span>${count(r.input.qtyBox)} parts/box × ${count(r.input.qtyOnPallet)} boxes/pallet</span><br><small class="muted">${decimal(r.input.consumptionPerShift)} parts/shift · ${decimal(r.input.doh)} input DOH<br>${count(r.input.length)} × ${count(r.input.width)} × ${count(r.input.height)} mm</small></td><td class="${r.isValid?'':'invalid-cell'}">${r.isValid ? '<span class="badge good">Validated</span>' : escape(r.errors.join(' '))}</td><td><button class="icon-btn" data-edit="${r.sourceIndex??index}" title="Edit ${escape(r.input.partNumber)}" aria-label="Edit ${escape(r.input.partNumber)}">${icon('edit')}</button><button class="icon-btn" data-delete="${r.sourceIndex??index}" title="Delete ${escape(r.input.partNumber)}" aria-label="Delete ${escape(r.input.partNumber)}">${icon('trash')}</button></td></tr>`;
    }).join('') || '<tr><td colspan="19" style="text-align:center;padding:35px">No matching part numbers.</td></tr>'}</tbody><tfoot><tr><th>Whole project totals</th><td>${count(c.totalRequiredPallets)}</td><td></td><td>${count(c.totalFloorPositions)}</td><td>${count(c.totalFloorRows)}</td><td>${area(c.floorWithoutGangways)}</td><td>${area(c.floorWithGangways)}</td><td></td><td></td><td></td><td>${count(c.totalRackBays)}</td><td>${count(c.totalRackRuns)}</td><td>${area(c.rackWithoutGangways)}</td><td>${area(c.rackWithGangways)}</td><td>${area(c.rackUnusedShelfArea)}</td><td>${area(c.rackUtilizationPercent)}</td><td colspan="3"></td></tr></tfoot></table></div><div class="table-footer"><span>${count(indexed.length)} matching part numbers · All areas in m², shown to two decimals</span><span class="project-floor-total">Whole project Floor storage m²: ${c.settingsErrors?.length?'—':area(c.floorWithoutGangways)} m²</span><div class="pagination"><button data-page="-1" ${page===0?'disabled':''}>Previous</button><span>${page+1} / ${pages}</span><button data-page="1" ${page===pages-1?'disabled':''}>Next</button></div></div>`;
  }
  function implementationPlan(){const p=project();return D.calculateImplementation(p.parts,p.settings,{...p.implementation,storageMode:p.implementation?.storageMode||'auto',improvementThreshold:p.improvementThreshold},selectedCategory);}
  function renderImplementation(){
    const config=project().implementation||{},file=config.dwg,types=D.configuredRackTypes(project().settings);
    const rackRows=(config.existingRacks||[]).map((row,index)=>`<div class="existing-rack-row"><label class="field"><span>Rack type</span><select data-existing-type="${index}" aria-label="Rack type ${index+1}">${!types.some(t=>t.id===row.typeId)?'<option value="">Choose rack type</option>':''}${types.map(t=>`<option value="${escape(t.id)}" ${t.id===row.typeId?'selected':''}>${escape(t.name)} · ${count(t.rackSlotLength)} × ${count(t.rackSlotDepth)} × ${count(t.rackSlotHeight)} mm · ${count(t.rackLevels)} levels</option>`).join('')}</select></label><label class="field"><span>Available bays</span><input type="number" min="0" max="1000" step="1" data-existing-bays="${index}" aria-label="Available bays ${index+1}" value="${Number.isSafeInteger(row.bays)?row.bays:''}"></label><button class="btn btn-ghost" data-remove-existing="${index}">Remove</button></div>`).join('');
    $('main').innerHTML=heading('WAREHOUSE PLANNING','Warehouse Designer','Set the warehouse constraints and allocate inventory to available racks and ground storage.')+`<section class="panel implementation-panel"><h2>Warehouse area</h2><label class="field"><span>Storage assignment</span><select id="implementation-storage-mode" aria-label="Storage assignment">${[['auto','Automatic / Improve Warehouse'],['manual','Manual per-part assignments'],['ground','All on ground storage'],['rack','All on Racks']].map(([v,t])=>`<option value="${v}" ${(config.storageMode||'auto')===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="designer-optimizer-settings"><label class="field"><span>Warehouse Orientation</span><select id="implementation-orientation" aria-label="Warehouse Orientation">${[['auto','Automatic — Best Surface Utilization'],['horizontal','Horizontal'],['vertical','Vertical']].map(([v,t])=>`<option value="${v}" ${(config.warehouseOrientation||'auto')===v?'selected':''}>${t}</option>`).join('')}</select></label>${['horizontal','vertical'].includes(config.warehouseOrientation)?`<label class="field"><span>Start ground storage from</span><select id="implementation-ground-start" aria-label="Start ground storage from">${(config.warehouseOrientation==='vertical'?[['right','From Right'],['left','From Left']]:[['top','From Up'],['bottom','From Down']]).map(([v,t],i)=>`<option value="${v}" ${(config.warehouseOrientation==='vertical'?(config.groundStartVertical||'right'):(config.groundStartHorizontal||'top'))===v?'selected':''}>${t}</option>`).join('')}</select></label>`:''}<label class="field"><span>Rack back-to-back separation (mm)</span><input id="implementation-back-to-back" type="number" min="0" value="${escape(config.backToBackSeparation??0)}"></label><label class="field"><span>Wall clearance (mm)</span><input id="implementation-wall-clearance" type="number" min="0" value="${escape(config.wallClearance??0)}"></label></div><label class="checkbox-field"><input id="implementation-greenfield" type="checkbox" ${config.greenfield?'checked':''}><span><strong>Greenfeild</strong><small class="muted">The area is blank, with no existing racks, equipment or other installations.</small></span></label>${config.greenfield?`<label class="checkbox-field implementation-option"><input id="implementation-wall-storage" type="checkbox" ${config.allowWallStorage?'checked':''}><span>Allowed storing on the wall.</span></label>${config.allowWallStorage?`<label class="field implementation-option"><span>${config.storageMode==='ground'?'Wall ground storage placement':'Wall rack placement'}</span><select id="implementation-wall-rack-mode" aria-label="${config.storageMode==='ground'?'Wall ground storage placement':'Wall rack placement'}">${[['all','Racks all around the walls'],['left','Racks only on Left side — Left to Right'],['right','Racks only on Right side — Right to Left'],['top','Racks only on Upper side — Up to Down'],['bottom','Racks only on Down side — Down to Up']].map(([v,t])=>`<option value="${v}" ${(config.wallRackMode||(config.racksAroundWalls?'all':'bottom'))===v?'selected':''}>${config.storageMode==='ground'?t.replace('Racks','Ground storage'):t}</option>`).join('')}</select></label>${(config.wallRackMode||(config.racksAroundWalls?'all':'bottom'))==='all'?`<label class="field implementation-option"><span>${config.storageMode==='ground'?'Start ground storage from':'Start racks from'}</span><select id="implementation-wall-start" aria-label="${config.storageMode==='ground'?'Start ground storage from':'Start racks from'}">${[['left','Left wall'],['right','Right wall'],['bottom','Down wall'],['top','Upper wall']].map(([v,t])=>`<option value="${v}" ${(config.wallStartSide||'left')===v?'selected':''}>${t}</option>`).join('')}</select></label>`:''}`:''}`:`<label class="checkbox-field implementation-option"><input id="implementation-allow-construction" type="checkbox" ${config.allowNewStorageConstruction?'checked':''}><span><strong>Allow New Storage Construction</strong><small class="muted">Allow LogEN to create additional racks or ground-storage areas when existing storage capacity is insufficient.</small></span></label><p class="muted">Create Layout → classify existing rack outlines, ground-storage zones and gangways. Installed infrastructure starts empty and keeps its original geometry.</p><label class="checkbox-field implementation-option"><input id="implementation-existing-racks" type="checkbox" ${config.useExistingRacks?'checked':''}><span>Use existing racks · add rack types and available bays</span></label>${config.useExistingRacks?`<div id="existing-racks">${rackRows||'<p class="muted">Add the rack types and number of bays already present.</p>'}</div><div class="actions"><button class="btn btn-secondary" data-action="add-existing-rack" ${types.length?'':'disabled'}>${icon('plus')}Add existing rack type</button><button class="btn btn-ghost" data-action="settings">Manage rack types and dimensions</button></div><p class="muted">Types and storage options come from Warehouse settings. Inventory comes from Part details. Smallest pallet quantities are placed first; PNs are never split between racks and ground. Enter whole available bays; unused bays still occupy floor area.</p>`:''}`}</section><section class="panel implementation-panel"><h2>Storage allocation</h2>${config.greenfield&&config.storageMode==='ground'?'<p class="muted">Ground storage follows Floor stacking mode in Overview, capped by Maximum floor stacking height. Missing imported Stacking defaults to 1. Unplaced inventory is reported in Create Layout.</p>':''}<p class="muted">${selectedCategory===null?'All categories':escape(selectedCategory||'Uncategorized')} · ${(config.storageMode||'auto')==='auto'?'Uses the same part assignment list as Overview → Improve Warehouse: quantities at or below the saved threshold go to racks; larger quantities go to ground storage.':config.storageMode==='ground'?'All part numbers are assigned to ground storage.':config.storageMode==='rack'?'All part numbers are assigned to racks. Non-fitting pallets are flagged for review.':'Uses your manual per-part storage assignments.'}</p><div id="implementation-results"></div></section><section class="panel implementation-panel"><div class="drawing-heading"><h2>Existing warehouse drawing</h2><button class="improve-warehouse" data-action="create-physical-layout" aria-label="✦ Create Layout →"><span class="ai-sparkle" aria-hidden="true">✦</span><span>Create Layout</span><span aria-hidden="true">→</span></button></div><p class="muted">Upload an AutoCAD .dwg or .dxf file. The original drawing is saved locally for this project.</p><button class="btn btn-primary" data-action="upload-dwg">${icon('upload')}Upload DWG / DXF</button>${file?`<div class="implementation-file"><div><strong>${escape(file.name)}</strong><p class="muted">${decimal(file.size/1024/1024)} MB · Added ${escape(new Date(file.uploadedAt).toLocaleDateString('en-GB'))}</p></div><button class="btn btn-secondary" data-action="download-dwg">${icon('download')}Download DWG</button></div><div class="actions"><button class="btn btn-primary" data-action="convert-dwg-pdf">Download edited PDF</button>${config.pdf?'<button class="btn btn-secondary" data-action="download-dwg-pdf">Download PDF</button>':''}</div>${config.pdf?`<p class="muted">PDF: ${escape(config.pdf.name)}</p>`:''}`:'<p class="muted">No DWG uploaded for this project.</p>'}<div class="layout-output-actions"><button class="btn btn-primary" data-action="download-layout-output">${icon('download')}Download Output data</button><p class="muted small-note">Layout DWG and its Parts List in Excel, together in one ZIP download.</p></div></section>`;
    renderImplementationResults();
  }
  function renderImplementationResults(){
    const target=$('implementation-results');if(!target)return;const plan=implementationPlan();
    if(!plan.available){target.innerHTML=`<div class="notice error">${plan.errors.map(escape).join('<br>')}</div>`;return;}
    const metric=(label,value)=>`<div><span>${label}</span><strong>${area(value)} m²</strong></div>`;
    target.innerHTML=`<div class="improvement-metrics split-metrics">${metric('Total — without gangways',plan.totalWithoutGangways)}${metric('Total — with allocated gangways',plan.totalWithGangways)}${metric('Racks — without gangways',plan.rack.withoutGangways)}${metric('Racks — with allocated gangways',plan.rack.withGangways)}${metric('Ground — without gangways',plan.groundWithoutGangways)}${metric('Ground — with allocated gangways',plan.groundWithGangways)}</div><p><strong>${count(plan.rackPallets)}</strong> ${plan.greenfield||plan.assignmentSource==='improve-warehouse'?'pallets assigned to racks · '+count(plan.rack.bays)+' planned bays':'pallets in '+count(plan.rack.bays)+' existing bays'} · <strong>${count(plan.groundPallets)}</strong> pallets on ground</p>${plan.invalidCount?`<div class="notice error">Partial totals: ${count(plan.invalidCount)} PNs need review. Their invalid areas or quantities are excluded and listed below.</div>`:''}<button class="btn btn-secondary" data-action="implementation-rack-layout" ${plan.rack.bays?'':'disabled'}>View filled racks</button><div class="implementation-table-region"><div class="table-scroll implementation-allocation-table" id="implementation-table-viewport"><table class="data-table"><thead><tr><th>Part Number</th><th>Required pallets</th><th>In racks</th><th>On ground</th><th>Ground storage m²</th><th>Storage assignment / Status</th></tr></thead><tbody>${plan.rows.map(r=>`<tr><td title="${escape(r.input.partNumber)}">${escape(r.input.partNumber)}</td><td>${count(r.required)}</td><td>${count(r.rackPallets)}</td><td>${count(r.groundPallets)}</td><td>${r.groundPallets===0?'0.00':area(r.ground?.withoutGangways)}</td><td><select data-storage-pn="${escape(r.input.partNumber)}" aria-label="Storage for ${escape(r.input.partNumber)}"><option value="ground" ${r.storageType==='Ground storage'?'selected':''}>Ground storage</option><option value="rack" ${r.storageType.startsWith('Rack')?'selected':''}>Rack storage</option></select><strong class="storage-location ${r.groundPallets>0?'has-ground':'rack-only'}">${escape(r.storageType)}</strong>${r.required!==null?`<small class="difference-caption">${count(r.rackPallets)} pallets in racks · ${count(r.groundPallets)} pallets on ground</small>`:''}${r.groundReason?`<small class="difference-caption">${escape(r.groundReason)}</small>`:''}${r.errors.length?`<small class="difference-caption error">${escape(r.errors.join(' '))}</small>`:''}</td></tr>`).join('')}</tbody></table></div><div class="implementation-scrollbar" id="implementation-horizontal-scroll" tabindex="0" role="region" aria-label="Scroll storage allocation table horizontally"><div aria-hidden="true"></div></div></div><p class="muted small-note">${plan.assignmentSource==='improve-warehouse'?'Uses the saved Overview → Improve Warehouse list: '+count(plan.threshold)+' pallets per PN. Existing-layout capacity is checked when Create Layout allocates the drawing. Non-fitting assignments remain flagged for review.':plan.greenfield?'Uses the selected storage assignments. Non-fitting rack assignments remain flagged for review.':'The existing racks remain in the area total even when partly empty.'} Shared gangways use the same allocated planning model as the dashboard. Allocation is a feasible packing estimate.</p>`;
    requestAnimationFrame(bindImplementationScroll);
  }
  function sizeImplementationScroll(){
    const viewport=$('implementation-table-viewport'),bar=$('implementation-horizontal-scroll');if(!viewport||!bar)return;
    bar.style.width=viewport.clientWidth+'px';bar.firstElementChild.style.width=viewport.scrollWidth+'px';bar.scrollLeft=viewport.scrollLeft;
  }
  function bindImplementationScroll(){
    const viewport=$('implementation-table-viewport'),bar=$('implementation-horizontal-scroll');if(!viewport||!bar)return;
    sizeImplementationScroll();
    viewport.addEventListener('scroll',()=>{if(bar.scrollLeft!==viewport.scrollLeft)bar.scrollLeft=viewport.scrollLeft;},{passive:true});
    bar.addEventListener('scroll',()=>{if(viewport.scrollLeft!==bar.scrollLeft)viewport.scrollLeft=bar.scrollLeft;},{passive:true});
  }
  window.addEventListener('resize',sizeImplementationScroll,{passive:true});
  function saveImplementation(changes,rerender=true){const p=project();p.implementation={...p.implementation,...changes};p.updatedAt=new Date().toISOString();save();if(rerender)render();else renderImplementationResults();}
  const physicalLayoutStorageKey=p=>p.id+(!p.implementation?.greenfield?':physical-layout:existing':':physical-layout');
  async function editedDrawingOutput(){
    const p=project(),stored=await drawingStore('readonly',s=>s.get(physicalLayoutStorageKey(p)));
    if(!stored?.layout)throw new Error('Create and save the edited layout first.');
    const file=await drawingStore('readonly',s=>s.get(p.id));if(!file)throw new Error('Upload the source DWG on this device first.');
    if(stored.layout.version>=2&&!stored.layout.safetyVerified&&!await modal({title:'Safety requirements unverified',body:'<p>Download the edited drawing for review? Required safety information has not been fully verified.</p>',confirm:'Download for review'}))throw new Error('Download cancelled.');
    return layoutOutput(p,implementationPlan(),p.settings,file,stored.sourceKey,stored.layout);
  }
  async function convertDrawingPDF(){await downloadDrawingPDF();}
  async function downloadDrawingPDF(){await work('Preparing edited layout PDF…',async()=>{const output=await editedDrawingOutput();if(!output.pdf)throw new Error(output.pdfError||'AutoCAD could not create the edited layout PDF.');download(output.pdf,output.filename+'.pdf','application/pdf');});}
  function downloadCADHelper(){const encoded='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';download(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),'LogEn_AutoCAD_Helper.zip','application/zip');}
  async function cadRequest(path,body,type){
    let response;
    try{response=await fetch('http://127.0.0.1:8765/'+path,{method:'POST',headers:{'Content-Type':type,'X-LogEn-Client':'dwg-converter'},body,signal:AbortSignal.timeout(240000)});}
    catch(error){await offerCADHelper();throw new Error('Start the latest LogEn AutoCAD helper on this PC, then try Create Layout again. '+(error.name==='TimeoutError'?'The CAD job timed out.':''));}
    if(response.status===404){await offerCADHelper();throw new Error('Update and restart the AutoCAD helper, then try Create Layout again.');}
    if(!response.ok){const error=await response.json().catch(()=>({error:'AutoCAD could not finish this drawing job.'}));throw new Error(error.error);}
    return response.json();
  }
  async function offerCADHelper(){if(await modal({title:'Connect AutoCAD on this PC',body:'<p>Layout drawing jobs run locally through the LogEn AutoCAD helper. Extract the latest helper ZIP, stop the previous LogEn helper if it is running, and start the new one. AutoCAD must be installed and licensed on this PC.</p>',confirm:'Download helper',cancel:'Close'}))downloadCADHelper();}
  const base64Bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  function drawingBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read the original DWG.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
  async function createPhysicalLayout(preferHelper=false){
    const p=project();
    const askForDrawing=async()=>{if(await modal({title:'Upload a warehouse drawing',body:'<p>Please upload a DWG or DXF file before creating a layout.</p>',confirm:'Upload DWG / DXF',cancel:'Cancel'}))$('dwg-input').click();};
    if(!p.implementation?.dwg?.uploadedAt){await askForDrawing();return;}
    const file=await drawingStore('readonly',s=>s.get(p.id));
    if(!file){await askForDrawing();return;}

    await work('Reading warehouse geometry locally…',async()=>{
      const plan=implementationPlan(),settings=structuredClone(p.settings),stamp=p.implementation?.dwg?.uploadedAt;
      if(!plan.available)throw new Error(plan.errors.join(' '));
      const cached=await drawingStore('readonly',s=>s.get(p.id+':geometry'));
      const geometryMode=p.implementation.greenfield?'geometry':'geometry-existing';
      let geometry;if(preferHelper)geometry=await cadRequest(geometryMode,file,'application/octet-stream');else if(cached?.stamp===stamp&&cached.readerVersion===3&&(cached.mode||'geometry')===geometryMode)geometry=cached.value;else{try{geometry=await LogEnCADReader.read(file);}catch(error){if(!await modal({title:'Browser CAD reader could not read this drawing',body:'<p>'+escape(error.message)+'</p><p>Try the optional local AutoCAD fallback on Windows?</p>',confirm:'Use Windows fallback',cancel:'Close'}))return;geometry=await cadRequest(geometryMode,file,'application/octet-stream');}}
      geometry=LogEnWarehouseGeometry.prepare(geometry);
      if(!Array.isArray(geometry.entities))throw new Error('The helper did not return drawing geometry. Update and restart the AutoCAD helper.');
      if(p.implementation?.dwg?.uploadedAt!==stamp)throw new Error('The DWG changed. Open Create Layout again.');
      await drawingStore('readwrite',s=>s.put({stamp,readerVersion:3,mode:geometryMode,value:geometry},p.id+':geometry'));
      const sourceKey=LogEnLayout.sourceKey(plan,settings,p.implementation,stamp),stored=await drawingStore('readonly',s=>s.get(physicalLayoutStorageKey(p)));
      const saved=stored?.sourceKey===sourceKey?stored.layout:null;
      if(stored?.layout&&!saved)toast('Inventory, settings or the DWG changed. Generate an updated layout from the Parts List.');
      LogEnLayoutUI.open({plan,settings,geometry,name:p.name,onReadFallback:()=>createPhysicalLayout(true),options:{...(p.implementation.greenfield?(p.implementation.greenfieldLayoutOptions||p.implementation.layoutOptions):(p.implementation.existingLayoutOptions||{})),existingMode:!p.implementation.greenfield,allowNewStorageConstruction:!p.implementation.greenfield&&!!p.implementation.allowNewStorageConstruction,existingRacks:p.implementation.existingRacks||[],storageMode:p.implementation.storageMode||"auto",storageOverrides:p.implementation.storageOverrides||{},allowWallStorage:!!p.implementation.allowWallStorage,racksAroundWalls:!!p.implementation.allowWallStorage,wallRackMode:p.implementation.wallRackMode||(p.implementation.racksAroundWalls?"all":"bottom"),wallStartSide:p.implementation.wallRackMode&&p.implementation.wallRackMode!=="all"?p.implementation.wallRackMode:p.implementation.wallStartSide||"left",groundStartVertical:p.implementation.groundStartVertical||"right",groundStartHorizontal:p.implementation.groundStartHorizontal||"top",warehouseOrientation:p.implementation.warehouseOrientation||'auto',backToBackSeparation:p.implementation.backToBackSeparation??0,wallClearance:p.implementation.wallClearance??0},saved,savedAlternatives:stored?.sourceKey===sourceKey?stored.alternatives:null,
        onSave:async({options,layout,alternatives})=>{
          if(p.implementation?.dwg?.uploadedAt!==stamp)throw new Error('The DWG changed. Reopen Create Layout.');
          if(layout){layout.viewerRackBays=structuredClone(plan.rack.bayLayouts||[]);await drawingStore('readwrite',s=>s.put({sourceKey,layout:structuredClone(layout),optionsKey:JSON.stringify(options),viewerSource:{parts:structuredClone(p.parts),settings:structuredClone(settings),geometry:structuredClone(geometry)},generatedAt:new Date().toISOString()},viewerStorageKey(p)));}
          await drawingStore('readwrite',s=>s.put({sourceKey,layout,alternatives},physicalLayoutStorageKey(p)));
          p.implementation={...p.implementation,...(p.implementation.greenfield?{layoutOptions:options,greenfieldLayoutOptions:options}:{existingLayoutOptions:options})};p.updatedAt=new Date().toISOString();save();
        },
        onHelper:downloadCADHelper,
        onExport:async(layout,format='bundle')=>{
          const output=await layoutOutput(p,plan,settings,file,sourceKey,layout);
          if(format==='dwg')download(output.dwg,output.filename+'.dwg','application/acad');else if(format==='pdf'){if(!output.pdf)throw new Error(output.pdfError||'PDF export failed.');download(output.pdf,output.filename+'.pdf','application/pdf');}else await downloadLayoutBundle(p,plan,layout,output);
          return {pdf:!!output.pdf,pdfError:output.pdfError,downloadPDF:()=>output.pdf&&download(output.pdf,output.filename+'.pdf','application/pdf')};
        }});
    });
  }
  const layoutKey=layout=>JSON.stringify({drawingAppearance:3,groups:layout.groups,unplaced:layout.unplaced,options:layout.options,env:layout.env});
  async function layoutOutput(p,plan,settings,file,sourceKey,layout,requirePDF=false){
    const layoutPNs=new Set(plan.rows.map(r=>r.input.partNumber));
    const current=D.calculateImplementation(p.parts.filter(part=>layoutPNs.has(part.partNumber)),p.settings,{...p.implementation,storageMode:p.implementation?.storageMode||'auto',improvementThreshold:p.improvementThreshold},null);
    if(LogEnLayout.sourceKey(current,p.settings,p.implementation,p.implementation?.dwg?.uploadedAt)!==sourceKey)throw new Error('The Parts List, settings or DWG changed. Regenerate the layout before downloading output.');
    if(layout.manualValidation?.errors?.length)throw new Error('Resolve mandatory manual placement errors before final export. Save the layout as a draft to retain positions.');
    const checked=LogEnLayout.validate(layout,plan,settings);
    if(checked.validationErrors.length)throw new Error('Resolve invalid drawing geometry before export: '+checked.validationErrors.map(v=>v.message).join(' '));
    const key=layoutKey(layout),cached=await drawingStore('readonly',s=>s.get(p.id+':layout-output'));
    if(cached?.sourceKey===sourceKey&&cached.layoutKey===key&&cached.dwg&&(!requirePDF||cached.pdf))return cached;
    if(!file)throw new Error('Upload the original warehouse DWG on this device before creating the project drawing files.');
    if(layout.version===2||layout.version===3){let health;try{health=await(await fetch('http://127.0.0.1:8765/health',{signal:AbortSignal.timeout(5000)})).json();}catch{}if(!health||health.version<(/\.dxf$/i.test(file.name)?7:layout.version===3?6:5)){await offerCADHelper();throw new Error('Update and restart the AutoCAD helper for this layout export.');}}
    const result=await cadRequest('layout',JSON.stringify({dwg:await drawingBase64(file),scale:layout.options.scale,version:layout.version===3?6:layout.version===2?5:3,objects:LogEnLayout.cadLabelObjects(layout.version===3?LogEnExistingLayout.cadObjects(layout):LogEnLayout.cadObjects(layout),settings),aisles:LogEnLayout.aisles(layout,settings).filter(a=>layout.version!==3||!a.existing),clearances:layout.clearances||[],markings:LogEnOptimizer.groundMarkings(layout)}),'application/json');
    const bytes=base64Bytes(result.dwg||'');if(!/^AC\d{4}$/.test(new TextDecoder().decode(bytes.slice(0,6))))throw new Error('The helper did not return a valid layout DWG.');
    const filename=safeName(p.implementation.dwg.name.replace(/\.(dwg|dxf)$/i,''))+(layout.complete?'_Layout':'_Partial_Layout'),dwg=new Blob([bytes],{type:'application/acad'});
    let pdf=null;if(result.pdf){const value=base64Bytes(result.pdf);if(new TextDecoder().decode(value.slice(0,5))==='%PDF-')pdf=new Blob([value],{type:'application/pdf'});}
    const output={sourceKey,layoutKey:key,filename,dwg,pdf,pdfError:result.pdfError,createdAt:new Date().toISOString()};
    await drawingStore('readwrite',s=>s.put(output,p.id+':layout-output'));return output;
  }
  async function downloadLayoutBundle(p,plan,layout,output){
    plan=LogEnManualLayout.placementPlan(layout,plan,p.settings);
    const excel=await W.layoutBytes(p,plan,layout),zip=await LogEnOutputZIP.pack([{name:output.filename+'.dwg',data:output.dwg},{name:output.filename+'_Parts.xlsx',data:excel}]);
    download(zip,output.filename+'_Output.zip','application/zip');
  }
  async function downloadLayoutOutput(){
    const p=project();await work('Preparing layout DWG and Excel output…',async()=>{
      const stored=await drawingStore('readonly',s=>s.get(physicalLayoutStorageKey(p)));
      if(!stored?.layout)throw new Error('Use Create Layout, then generate and save a layout first.');
      const layout=stored.layout,plan=implementationPlan(),settings=p.settings;
      if(layout.version>=2&&!layout.safetyVerified&&!await modal({title:'Safety requirements unverified',body:'<p>The output will be a layout for review. Required safety information has not been fully verified from this drawing.</p>',confirm:'Download for review'}))return;
      if(!layout.complete&&!await modal({title:'Download partial layout?',body:`<p>${count(layout.unplacedRack)} rack pallet positions and ${count(layout.unplacedGround)} ground positions remain unplaced. The DWG will contain only placed objects; Excel will also list the unplaced quantities.</p>`,confirm:'Download partial output'}))return;
      const file=await drawingStore('readonly',s=>s.get(p.id));if(!file)throw new Error('Upload the original warehouse DWG on this device first.');
      const output=await layoutOutput(p,plan,settings,file,stored.sourceKey,layout);await downloadLayoutBundle(p,plan,layout,output);toast('Output ZIP downloaded: layout DWG and matching Excel Parts List.');
    });
  }
  async function downloadProjectFiles(id){
    const p=state.projects.find(p=>p.id===id);if(!p)throw new Error('Project not found.');
    await work('Preparing '+p.name+' project files…',async()=>{
      const stored=await drawingStore('readonly',s=>s.get(physicalLayoutStorageKey(p)));
      if(!stored?.layout)throw new Error('Create and save a layout in Warehouse Designer for '+p.name+' first.');
      let source;try{source=JSON.parse(stored.sourceKey);}catch{throw new Error('Regenerate and save the project layout before downloading its files.');}
      if(!Array.isArray(source.rows))throw new Error('Regenerate and save the project layout before downloading its files.');
      const layoutPNs=new Set(source.rows.map(r=>r[0]?.partNumber)),parts=p.parts.filter(part=>layoutPNs.has(part.partNumber)),settings=p.settings;
      const plan=D.calculateImplementation(parts,settings,{...p.implementation,storageMode:p.implementation?.storageMode||'auto',improvementThreshold:p.improvementThreshold},null),layout=stored.layout;
      const file=await drawingStore('readonly',s=>s.get(p.id)),output=await layoutOutput(p,plan,settings,file,stored.sourceKey,layout,true);
      if(!output.pdf)throw new Error(output.pdfError||'The layout PDF could not be created. Try the project download again after checking the CAD connection.');
      const name=safeName(p.name),layoutName=name+(layout.complete?'_Layout':'_Partial_Layout');
      const [list,results]=await Promise.all([W.layoutBytes(p,LogEnManualLayout.placementPlan(layout,plan,settings),layout),W.exportBytes(p,D.calculateProject(p.parts,settings,null))]);
      const zip=await LogEnOutputZIP.pack([{name:layoutName+'.dwg',data:output.dwg},{name:layoutName+'.pdf',data:output.pdf},{name:name+'_Layout_List.xlsx',data:list},{name:name+'_LogEn_Results.xlsx',data:results}]);
      download(zip,name+'_Project_Files.zip','application/zip');toast('Project files downloaded: layout DWG, layout PDF, layout list and Export Results.');
    });
  }
  function drawingStore(mode,action){
    return new Promise((resolve,reject)=>{const request=indexedDB.open('logen.project.drawings',1);request.onupgradeneeded=()=>request.result.createObjectStore('drawings');request.onerror=()=>reject(new Error('Drawing storage is unavailable.'));request.onsuccess=()=>{const db=request.result;let result;const tx=db.transaction('drawings',mode);const task=action(tx.objectStore('drawings'));task.onsuccess=()=>{result=task.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(new Error('Could not save or read the drawing. Browser storage may be full.'));};tx.onabort=tx.onerror;};});
  }
  async function uploadDrawing(file){
    if(!file)return;
    let parsed=false;await work('Saving and analyzing warehouse drawing…',async()=>{
      if(!/\.(dwg|dxf)$/i.test(file.name))throw new Error('Choose an AutoCAD .dwg or .dxf file.');
      if(file.size>100*1024*1024)throw new Error('The local AutoCAD helper supports DWG files up to 100 MB.');
      const signature=await file.slice(0,6).text();if(/\.dwg$/i.test(file.name)&&!/^AC\d{4}$/.test(signature))throw new Error('This file does not have a recognized AutoCAD DWG header. Choose the original .dwg file.');
      const p=project();await drawingStore('readwrite',store=>store.put(file,p.id));
      const implementation={...p.implementation,allowNewStorageConstruction:false,pdf:null,layoutOptions:null,greenfieldLayoutOptions:null,existingLayoutOptions:null,dwg:{name:file.name,size:file.size,uploadedAt:new Date().toISOString()}};
      p.implementation=implementation;p.updatedAt=new Date().toISOString();save();
      try{const raw=await LogEnCADReader.read(file),geometry=LogEnWarehouseGeometry.prepare(raw),mode=p.implementation.greenfield?'geometry':'geometry-existing';await drawingStore('readwrite',s=>s.put({stamp:implementation.dwg.uploadedAt,readerVersion:3,mode,value:geometry},p.id+':geometry'));parsed=true;}catch(error){toast('Original drawing saved. Browser analysis needs review: '+error.message,true);}
      render();if(parsed)toast('Drawing analyzed locally. Review detected regions, objects and access roles.');
    });if(parsed&&implementationPlan().available)await createPhysicalLayout();
  }
  async function downloadDrawing(){await work('Preparing edited layout DWG…',async()=>{const output=await editedDrawingOutput();download(output.dwg,output.filename+'.dwg','application/acad');});}

  function renderProjects() {
    const deleted=state.deletedProjects||[];
    $('main').innerHTML = heading('YOUR LOCAL WORKSPACE', 'Warehouse projects', 'Each project keeps its own inventory and warehouse settings on this device.', `<button class="btn btn-secondary danger-text" data-delete-project="${escape(state.activeId)}">${icon('trash')}Delete current project</button><button class="btn btn-primary" data-action="new-project">${icon('plus')}New warehouse project</button>`) +
      `<div class="project-grid">${state.projects.map(p=>`<article class="panel project-card"><div class="project-card-heading">${icon('folder')}${p.id===state.activeId ? '<span class="badge good">ACTIVE</span>' : ''}</div><h2>${escape(p.name)}</h2><p>${count(p.parts.length)} part numbers · ${'Per-shift planning'}</p><p>Updated ${escape(new Date(p.updatedAt).toLocaleDateString('en-GB'))}</p><div class="actions"><button class="btn btn-secondary small" data-open-project="${escape(p.id)}">Open project ${icon('arrow')}</button><button class="icon-btn" data-rename-project="${escape(p.id)}" title="Rename project" aria-label="Rename ${escape(p.name)}">${icon('edit')}</button><button class="btn btn-ghost small danger-text" data-delete-project="${escape(p.id)}" aria-label="Delete ${escape(p.name)}">${icon('trash')}Delete project</button></div><div class="project-download-actions"><button class="btn btn-secondary small" data-download-project-files="${escape(p.id)}" aria-label="Download Project Files for ${escape(p.name)}">${icon('download')}Download Project Files</button></div></article>`).join('')}</div>`+
      (deleted.length?`<section class="deleted-projects"><div class="deleted-head"><div><h2>Deleted projects</h2><p>Restore a project with its inventory and warehouse settings.</p></div><span class="badge">${deleted.length} recoverable</span></div><div class="project-grid">${deleted.map(p=>`<article class="panel project-card deleted-project">${icon('trash')}<h2>${escape(p.name)}</h2><p>${count(p.parts.length)} part numbers · Deleted ${escape(new Date(p.deletedAt||p.updatedAt).toLocaleDateString('en-GB'))}</p><div class="actions"><button class="btn btn-secondary small" data-restore-project="${escape(p.id)}" aria-label="Restore ${escape(p.name)}">Restore project ${icon('arrow')}</button></div></article>`).join('')}</div></section>`:'')+
      `<section class="panel backup-panel"><div><h2>Take your workspace with you</h2><p>Back up every active and deleted project, including its settings, to a JSON file.</p></div><div class="actions"><button class="btn btn-secondary" data-action="backup">${icon('download')}Download backup</button><button class="btn btn-secondary" data-action="restore">${icon('upload')}Restore backup</button></div></section><div class="allocation-note">${icon('info')}<span>Projects are stored in this Chrome profile for this HTML file. Keep the file in the same location, and download a backup before clearing browser data, moving the file, or switching computers. Excel exports also include inputs and settings.</span></div>`;
  }
  const viewerStorageKey=p=>p.id+(!p.implementation?.greenfield?':viewer:existing':':viewer:greenfield');
  async function render3D(){
    const token=viewerRenderToken,p=project();$('main').innerHTML=heading('WAREHOUSE EXPLORER','3D viewer','Explore the latest saved layout. Pallets and locations use the Warehouse Designer allocations.')+'<div id="viewer-host"><p class="muted">Loading saved warehouse layout…</p></div>';
    try{
      const plan=implementationPlan(),stamp=p.implementation?.dwg?.uploadedAt,sourceKey=LogEnLayout.sourceKey(plan,p.settings,p.implementation||{},stamp),snapshot=await drawingStore('readonly',s=>s.get(viewerStorageKey(p))),stored=snapshot||await drawingStore('readonly',s=>s.get(physicalLayoutStorageKey(p)));
      if(token!==viewerRenderToken||view!=='viewer3d')return;
      const host=$('viewer-host');if(!stored?.layout){host.innerHTML='<section class="panel implementation-panel"><h2>No generated layout yet</h2><p>Generate and save a layout in Warehouse Designer, then open 3D viewer.</p><button class="btn btn-primary" data-action="implementation">Open Warehouse Designer</button></section>';return;}
      const options=p.implementation.greenfield?(p.implementation.greenfieldLayoutOptions||p.implementation.layoutOptions):(p.implementation.existingLayoutOptions||{}),stale=stored.sourceKey!==sourceKey||(snapshot&&JSON.stringify(options)!==snapshot.optionsKey),geometryMode=p.implementation.greenfield?'geometry':'geometry-existing';
      if(stale||!snapshot?.viewerSource){const geometry=await drawingStore('readonly',s=>s.get(p.id+':geometry'));if(token!==viewerRenderToken||view!=='viewer3d')return;if(stale){host.innerHTML='<div class="notice error"><h2>3D model is outdated</h2><p>Parts, warehouse settings, drawing setup or the DWG changed. Generate and save an updated layout in Warehouse Designer before viewing it in 3D.</p><button class="btn btn-primary" data-action="implementation">Open Warehouse Designer</button></div>';return;}if(geometry?.stamp!==stamp||(geometry.mode||'geometry')!==geometryMode)throw new Error('Reopen Create Layout and save the current generated layout to retain its source drawing for 3D.');stored.viewerSource={parts:p.parts,settings:p.settings,geometry:geometry.value};stored.layout.viewerRackBays=plan.rack.bayLayouts||[];}
      const model=LogEnViewerModel.build({layout:stored.layout,...stored.viewerSource,generatedAt:stored.generatedAt});if(token!==viewerRenderToken||view!=='viewer3d')return;host.innerHTML=(model.partial?'<div class="notice error">Partial layout: the viewer shows only allocated storage. Unplaced demand remains listed in Warehouse Designer.</div>':'')+'<div id="viewer-canvas-host"></div>';viewerController=LogEn3DViewer.open($('viewer-canvas-host'),model);
    }catch(error){if(token===viewerRenderToken&&view==='viewer3d')$('viewer-host').innerHTML='<div class="notice error">'+escape(error.message)+'</div>';}
  }
  function render() {
    viewerRenderToken++;viewerController?.dispose();viewerController=null;
    if (loadError) return renderRecovery();
    const p=project();
    $('project-select').innerHTML=state.projects.map(p=>`<option value="${escape(p.id)}" ${p.id===state.activeId?'selected':''}>${escape(p.name)}</option>`).join('');
    $('breadcrumb-project').textContent=p.name;
    $('nav-count').textContent=p.parts.length;
    document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    const c=calc();
    if(view==='viewer3d')render3D();else if (view==='parts') renderParts(c); else if(view==='consumption') renderConsumption(c); else if(view==='projects') renderProjects(); else if(view==='implementation') renderImplementation(); else renderDashboard(c);
  }
  function go(target) { if(busy)return;view=target;page=0;render();window.scrollTo({top:0,behavior:'instant'}); }
  async function newProject() {
    const name=await E.projectName(''); if(!name)return;
    const p={id:`warehouse-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name,parts:[],settings:D.createDefaultSettings(),sourceName:null,rawInputRows:null,updatedAt:new Date().toISOString()};
    state.projects.push(p);state.activeId=p.id;productionDrafts={};mismatchesOnly=false;save();go('dashboard');toast('Warehouse project created. Import Excel or add parts to begin.');
  }
  async function deleteProject(id) {
    const p=state.projects.find(item=>item.id===id);
    if(!p)return;
    const last=state.projects.length===1;
    if(!await modal({title:'Delete warehouse project?',eyebrow:'PROJECT MANAGEMENT',body:`<p>Delete <strong>${escape(p.name)}</strong> and its ${count(p.parts.length)} part numbers from your active workspace?</p><p class="muted">You can restore it later from Deleted projects with all inventory and settings intact.${last?' An empty warehouse project will be created so you can keep working.':''}</p>`,confirm:'Delete project',danger:true}))return;
    state.projects=state.projects.filter(item=>item.id!==id);
    (state.deletedProjects ||= []).push({...p,deletedAt:new Date().toISOString()});
    if(!state.projects.length)state.projects.push({id:`warehouse-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:'New warehouse',parts:[],settings:D.createDefaultSettings(),sourceName:null,rawInputRows:null,updatedAt:new Date().toISOString()});
    if(state.activeId===id)state.activeId=state.projects[0].id;
    productionDrafts={};mismatchesOnly=false;query='';save();go('projects');toast('Project deleted. You can restore it from Deleted projects.');
  }
  function restoreProject(id) {
    const p=(state.deletedProjects||[]).find(item=>item.id===id);
    if(!p)return;
    const restored={...p,updatedAt:new Date().toISOString()};delete restored.deletedAt;
    state.deletedProjects=state.deletedProjects.filter(item=>item.id!==id);
    state.projects.push(restored);state.activeId=id;productionDrafts={};mismatchesOnly=false;query='';save();go('dashboard');toast('Project restored with its inventory and settings.');
  }
  async function settings() {const next=await E.settings(project().settings);if(next){productionDrafts={};update({settings:next});toast('Production and warehouse settings saved. All results recalculated.');}}
  async function editPart(index=null) {
    const p=project(), next=await E.part(index==null?null:p.parts[index],p.settings);if(!next)return;
    const reviewed={...next,shiftModelMigrated:false,packagingInferred:false};
    const parts=p.parts.slice();if(index==null)parts.push(reviewed);else parts[index]=reviewed;
    update({parts,rawInputRows:null,sourceName:'Manually updated inventory'});toast(index==null?'Part added. Both storage scenarios recalculated.':'Part updated. Both storage scenarios recalculated.');
  }
  async function removePart(index) {
    const p=project();
    if(!await modal({title:'Delete this part number?',body:`<p>Remove <strong>${escape(p.parts[index].partNumber)}</strong> from ${escape(p.name)}? All four totals will update.</p>`,confirm:'Delete part',danger:true}))return;
    update({parts:p.parts.filter((_,i)=>i!==index),rawInputRows:null,sourceName:'Manually updated inventory'});
  }
  async function importFile(file) {
    if(!file)return;if(!/\.xlsx$/i.test(file.name)){toast('Choose an .xlsx Excel workbook.',true);return;}
    let imported;
    await work('Reading Excel locally…',async()=>{imported=await W.importBytes(await file.arrayBuffer(),project().settings);});
    if(!imported)return;
    const preview=D.calculateProject(imported.parts,project().settings);
    const warnings=imported.warnings||[];
    const approved=await modal({title:'Import this inventory?',eyebrow:'EXCEL IMPORT',body:`<p><strong>${escape(file.name)}</strong> contains ${count(imported.parts.length)} part numbers.</p><p class="muted">This replaces the ${count(project().parts.length)} current parts in ${escape(project().name)}. Warehouse settings stay with the project.</p>${preview.invalidCount?`<div class="notice error">${preview.invalidCount} invalid rows will remain visible for correction. Floor and rack totals include their own calculable rows; rack-fit errors do not remove valid floor areas.</div>`:'<div class="notice">All imported parts are valid under the current warehouse settings.</div>'}${warnings.length?`<h3>Import notes</h3><ul>${warnings.slice(0,20).map(w=>`<li>${escape(w)}</li>`).join('')}</ul>${warnings.length>20?`<p class="muted">And ${warnings.length-20} more notes. Review invalid rows after import.</p>`:''}`:''}`,confirm:'Import & calculate'});
    if(!approved)return;
    query='';invalidOnly=false;page=0;
    selectedCategory=null;update({parts:imported.parts,rawInputRows:imported.rawInputRows,sourceName:file.name});go('dashboard');toast(`${imported.parts.length} part numbers imported. Four footprints calculated.`);
  }
  async function exportResults() {
    await work('Building your Excel comparison…',async()=>{
      const p=project(),c=calc();const exported=selectedCategory===null?p:{...p,parts:c.results.map(r=>r.input),rawInputRows:null,name:p.name+' — '+(selectedCategory||'Uncategorized')};download(await W.exportBytes(exported,c),`${safeName(p.name)}_LogEn_Results.xlsx`);
      toast(c.invalidCount?'Export downloaded with partial totals and visible invalid rows.':'Excel results downloaded: inputs, floor, racks, comparison, and settings.');
    });
  }
  async function template() {await work('Creating Excel template…',async()=>{download(await W.templateBytes(),'LogEn_Shift_Inventory_Template.xlsx');toast('Eight-column shift inventory template downloaded. Fill it in and import to calculate pallets and space.');});}
  function backup() {download(encode(state),'LogEn_Workspace_Backup.json','application/json');toast('Workspace backup downloaded.');}
  async function restore(file) {
    if(!file)return;
    try {
      const restored=validateWorkspace(decode(await file.text()));
      if(!await modal({title:'Restore workspace backup?',body:`<p>This backup contains <strong>${restored.projects.length} projects</strong>. It will replace the current workspace in this browser.</p><p class="muted">Download a backup of the current workspace first if you need to keep it.</p>`,confirm:'Restore workspace'}))return;
      state=restored;loadError=null;productionDrafts={};mismatchesOnly=false;query='';save();go('dashboard');toast('Workspace restored. All projects recalculated.');
    } catch(error){toast(error.message||'This backup could not be read.',true);}
  }
  async function help() {
    await modal({title:'From shift consumption to warehouse space',eyebrow:'HOW LOGEN WORKS',body:`<div class="help-steps"><div class="help-step"><strong>01 / PREPARE</strong><h3>Download the nine-column template</h3><p>Part Number, QTY in Box, QTY boxes per Pallet, Consumption per shift, DOH (Days on hand), L(mm), W(mm), H(mm), Category.</p></div><div class="help-step"><strong>02 / IMPORT</strong><h3>Import your parts</h3><p>All file processing happens locally. L, W and H are loaded pallet dimensions. Choose automatic, imported or global manual floor stacking in Part details. Per-part saved factors are preserved; height limits always apply.</p></div><div class="help-step"><strong>03 / CONFIGURE</strong><h3>Choose shifts and DOH</h3><p>Select 1, 2 or 3 shifts per day. Use each part’s Excel DOH or apply a chosen DOH override to all parts.</p></div><div class="help-step"><strong>04 / COMPARE</strong><h3>Review and export</h3><p>The same required pallet count drives floor and rack m² calculations. Inspect substituted formulas and export the five-sheet workbook.</p></div></div><h3>Your required-pallet formula</h3><div class="formula-box"><code>ROUNDUP(Consumption per shift / QTY in Box / QTY boxes per Pallet × shifts per day × DOH, 0)</code></div><p class="muted">Multiply raw pallets per shift by selected shifts and DOH without rounding. Round up only the final result. Example: 0.16 pallets/shift × 2 shifts × 10 DOH = 3.2 → 4 required pallets. Physical floor positions, rows and rack bays remain whole capacity units.</p><h3>Projects and offline use</h3><p class="muted">Projects → Delete project asks for confirmation. Restore a deleted project with all inventory and settings from Deleted projects. The file embeds all code, Excel tools and the logo. Back up projects before moving this file or clearing browser data.</p><h3>Excel-style surface allocations</h3><p class="muted">GS net = lane depth × lane width × lanes / 1,000,000 (all dimensions mm). GS allocated = GS net + lane width × lanes × physical gangway width in metres / 2000. PR net = required rack bays × (usable shelf length + structural length) × (usable shelf depth + structural depth) / 1,000,000. PR allocated = PR net + required rack bays × (usable shelf length + structural length) in mm × physical gangway width in metres / 2000. Both allocate half a shared gangway. Rack rotation, vertical stacking and two-deep storage are disabled by default and can be enabled for each rack type. Required storage pallets supply the rack unit quantity. Unused shelf area is not unused warehouse floor area and is never subtracted from the rack footprint. These are allocations, not physical aisle layouts.</p>`,confirm:'Got it',cancel:''});
  }
  function renderRecovery() {
    $('main').innerHTML=heading('WORKSPACE RECOVERY','Saved data needs attention','The saved workspace has been kept intact.')+`<div class="notice error">${escape(loadError)}</div><section class="panel backup-panel"><div><h2>Recover your workspace</h2><p>Restore a JSON backup, or recover the previous local save.</p></div><div class="actions"><button class="btn btn-primary" data-action="restore">Restore backup</button><button class="btn btn-secondary" data-action="recover">Recover previous save</button><button class="btn btn-secondary" data-action="raw-backup">Download saved data</button></div></section>`;
  }
  document.addEventListener('input',event=>{
    if(event.target.hasAttribute('data-existing-bays')){const rows=[...(project().implementation?.existingRacks||[])],index=Number(event.target.dataset.existingBays);rows[index]={...rows[index],bays:event.target.value.trim()===''?null:Number(event.target.value)};saveImplementation({existingRacks:rows},false);return;}
    if(event.target.hasAttribute('data-manual-floor-stacking')&&!busy&&!loadError){
      productionDrafts.manualStacking=event.target.value;
      const manualStacking=event.target.value.trim()===''?NaN:Number(event.target.value);
      update({settings:{...project().settings,stackingMode:'manual',manualStacking}},true);return;
    }
    const key=event.target.dataset.production;
    if(!key||busy||loadError)return;
    productionDrafts[key]=event.target.value;
    const number=event.target.value.trim()===''?NaN:Number(event.target.value);
    update({settings:{...project().settings,[key]:number,...(key==='customCoverageDays'?{coverageMode:'custom'}:{})}},true);
  });
  document.addEventListener('change',async event=>{
    if(event.target.id==='implementation-ground-start'){saveImplementation(project().implementation.warehouseOrientation==='vertical'?{groundStartVertical:event.target.value}:{groundStartHorizontal:event.target.value});return;}
    if(event.target.id==='implementation-allow-construction'){saveImplementation({allowNewStorageConstruction:event.target.checked});return;}
    if(event.target.id==='implementation-storage-mode'||event.target.matches('[data-storage-pn]')){const p=project(),manual=event.target.matches('[data-storage-pn]'),changes=manual?{storageMode:'manual',storageOverrides:{...(p.implementation.storageMode==='manual'?p.implementation.storageOverrides:['ground','rack'].includes(p.implementation.storageMode)?Object.fromEntries(p.parts.map(row=>[row.partNumber,p.implementation.storageMode])):{}),[event.target.dataset.storagePn]:event.target.value}}:{storageMode:event.target.value,storageOverrides:{}};const plan=D.calculateImplementation(p.parts,p.settings,{...p.implementation,...changes,improvementThreshold:p.improvementThreshold},selectedCategory),bad=(plan.rows||[]).filter(r=>r.missingRackPallets>0);if(bad.length){await modal({title:'Pallets do not fit in racks',body:bad.map(r=>`<p><strong>PN: ${escape(r.input.partNumber)}</strong><br>${count(r.missingRackPallets)} storage pallets / boxes do not fit.<br>${escape(r.errors.join(' '))}</p>`).join(''),confirm:'OK',cancel:''});if(manual){renderImplementationResults();return;}}saveImplementation(changes);return;}
    if(event.target.id==='implementation-orientation'){saveImplementation({warehouseOrientation:event.target.value});return;}
    if(event.target.id==='implementation-back-to-back'||event.target.id==='implementation-wall-clearance'){const value=Number(event.target.value);if(!Number.isFinite(value)||value<0){toast('Enter a non-negative clearance.',true);return;}saveImplementation({[event.target.id==='implementation-back-to-back'?'backToBackSeparation':'wallClearance']:value});return;}
    if(event.target.id==='implementation-greenfield'){saveImplementation({greenfield:event.target.checked});return;}
    if(event.target.id==='implementation-wall-storage'){saveImplementation({allowWallStorage:event.target.checked});return;}
    if(event.target.id==='implementation-wall-start'){saveImplementation({wallStartSide:event.target.value});return;}
    if(event.target.id==='implementation-wall-rack-mode'){saveImplementation({wallRackMode:event.target.value,racksAroundWalls:event.target.value==='all',layoutOptions:{...project().implementation?.layoutOptions,suitableWallEdges:[]}});return;}
    if(event.target.id==='implementation-existing-racks'){saveImplementation({useExistingRacks:event.target.checked});return;}
    if(event.target.hasAttribute('data-existing-type')){const rows=[...(project().implementation?.existingRacks||[])];rows[Number(event.target.dataset.existingType)]={...rows[Number(event.target.dataset.existingType)],typeId:event.target.value};saveImplementation({existingRacks:rows});return;}
    if(event.target.id==='category-filter'){selectedCategory=JSON.parse(event.target.value);page=0;render();return;}
    if(event.target.hasAttribute('data-floor-stacking-mode')&&!busy&&!loadError){
      productionDrafts.manualStacking=undefined;
      const s=project().settings;update({settings:{...s,stackingMode:event.target.value,manualStacking:Number.isSafeInteger(s.manualStacking)&&s.manualStacking>=1?s.manualStacking:1}},true);return;
    }
    if(!event.target.hasAttribute('data-production-coverage')||busy||loadError)return;
    update({settings:{...project().settings,coverageMode:event.target.value}},true);
  });
  document.addEventListener('click',async event=>{
    const b=event.target.closest('button');if(!b||busy)return;
    try{
      if(b.dataset.action==='required-pallets')return E.requiredPallets(calc());
      if(b.dataset.action==='rack-overview')return E.rackOverview(calc(),project().settings);
      if(b.dataset.view)return go(b.dataset.view);
      if(b.dataset.mode){update({settings:{...project().settings,stockMode:b.dataset.mode}});return;}
      if(b.dataset.detail!==undefined)return E.details(calc().results[Number(b.dataset.detail)],project().settings);
      if(b.dataset.edit!==undefined)return editPart(Number(b.dataset.edit));
      if(b.dataset.delete!==undefined)return removePart(Number(b.dataset.delete));
      if(b.dataset.page){page+=Number(b.dataset.page);renderPartsTable(calc());return;}
      if(b.dataset.consumptionPage){page+=Number(b.dataset.consumptionPage);renderConsumptionTable(calc());return;}
      if(b.dataset.openProject){state.activeId=b.dataset.openProject;productionDrafts={};save();return go('dashboard');}
      if(b.dataset.downloadProjectFiles)return downloadProjectFiles(b.dataset.downloadProjectFiles);
      if(b.dataset.renameProject){const p=state.projects.find(p=>p.id===b.dataset.renameProject);const name=await E.projectName(p.name);if(name){p.name=name;p.updatedAt=new Date().toISOString();save();render();}return;}
      if(b.dataset.deleteProject)return deleteProject(b.dataset.deleteProject);
      if(b.dataset.restoreProject)return restoreProject(b.dataset.restoreProject);
      if(b.hasAttribute('data-remove-existing')){const rows=[...(project().implementation?.existingRacks||[])];rows.splice(Number(b.dataset.removeExisting),1);saveImplementation({existingRacks:rows});return;}
      switch(b.dataset.action){
        case 'improve-warehouse':await improveWarehouse();break;
        case 'add-existing-rack':{const type=D.configuredRackTypes(project().settings)[0];if(type)saveImplementation({existingRacks:[...(project().implementation?.existingRacks||[]),{typeId:type.id,bays:1}]});break;}
        case 'implementation-rack-layout':{const plan=implementationPlan();if(plan.available){const c=calc();await E.rackOverview({...c,sharedRack:plan.rack,results:plan.rows.filter(r=>r.rackPallets>0&&!r.errors.length).map(r=>({...c.results.find(original=>original.input.partNumber===r.input.partNumber),requiredPallets:r.rackPallets,isRackValid:true,isPlanningValid:true,rackFit:'YES',errors:[]})),totalRequiredPallets:plan.rackPallets,nonFittingPallets:0,nonFittingPartCount:0,nonFittingUnknownQuantity:0},project().settings);}break;}
        case 'create-physical-layout':await createPhysicalLayout();break;
        case 'convert-dwg-pdf':await convertDrawingPDF();break;
        case 'download-dwg-pdf':await downloadDrawingPDF();break;
        case 'download-cad-helper':downloadCADHelper();break;
        case 'download-layout-output':await downloadLayoutOutput();break;
        case 'upload-dwg':$('dwg-input').click();break;
        case 'download-dwg':await downloadDrawing();break;
        case 'import':$('excel-input').click();break;
        case 'template':await template();break;
        case 'export':await exportResults();break;
        case 'implementation':go('implementation');break;
        case 'settings':await settings();break;
        case 'parts':go('parts');break;
        case 'consumption':go('consumption');break;
        case 'coverage-differences':mismatchesOnly=true;query='';go('consumption');break;
        case 'invalid':invalidOnly=true;query='';go('parts');break;
        case 'add':await editPart();break;
        case 'new-project':await newProject();break;
        case 'backup':backup();break;
        case 'restore':$('backup-input').click();break;
        case 'recover':{const raw=localStorage.getItem(BACKUP);if(!raw)throw new Error('No previous save is available. Restore a downloaded JSON backup.');const restored=validateWorkspace(decode(raw));state=restored;loadError=null;productionDrafts={};mismatchesOnly=false;query='';save();render();toast('Previous local save recovered.');break;}
        case 'raw-backup':download(localStorage.getItem(KEY)||'{}','LogEn_Saved_Data.json','application/json');break;
      }
    }catch(error){console.error(error);toast(error.message||'The action could not be completed.',true);}
  });
  const fullscreenButton = $('fullscreen-toggle');
  function syncFullscreenButton() {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.textContent = active ? 'Exit full screen' : 'Full screen';
    fullscreenButton.title = active ? 'Exit full screen (Esc)' : 'Enter full screen';
    fullscreenButton.setAttribute('aria-pressed', String(active));
  }
  fullscreenButton.hidden = !document.documentElement.requestFullscreen;
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      toast('Full screen is unavailable in this browser. Try opening LogEn in Chrome or Edge.', true);
    }
    syncFullscreenButton();
  });
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  syncFullscreenButton();
  $('project-select').addEventListener('change',event=>{state.activeId=event.target.value;query='';invalidOnly=false;productionDrafts={};mismatchesOnly=false;save();go(view);});
  document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();go('dashboard');});
  $('new-project').addEventListener('click',newProject);
  $('settings-nav').addEventListener('click',()=>{if(!loadError)settings();});
  $('method-help').addEventListener('click',help);
  $('dwg-input').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';await uploadDrawing(file);});
  $('excel-input').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';await importFile(file);});
  $('backup-input').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';await restore(file);});
  window.addEventListener('unhandledrejection',event=>{console.error(event.reason);toast(event.reason?.message||'An unexpected error occurred. Your last saved workspace is retained.',true);});
  try {
    const stored=localStorage.getItem(KEY);
    if(stored){const decoded=decode(stored);const migrate=decoded.version!==3||[...(decoded.projects||[]),...(decoded.deletedProjects||[])].some(p=>p.settings&&!Object.prototype.hasOwnProperty.call(p.settings,'stackabilityEnabled'));state=validateWorkspace(decoded);if(migrate)save();}
    else{const p=exampleProject();state={version:3,projects:[p],activeId:p.id};save();}
  }catch(error){
    if(error instanceof SyntaxError || /saved|project|workspace|backup|part|structure/i.test(error.message)){loadError=error.message;}
    else{const p=exampleProject();state={version:3,projects:[p],activeId:p.id};saveError=true;toast('Local browser storage is unavailable. Download a JSON backup to keep your work.',true);}
  }
  render();
})();
