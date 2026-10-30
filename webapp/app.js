/* LogEn — local-only application controller. No network APIs are used. */
(() => {
  'use strict';
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
      p.settings = { ...D.createDefaultSettings(), ...p.settings };
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
      results.innerHTML=`<p><strong>≤ ${count(threshold)} pallets → racks</strong> · ${count(plan.rackRows.length)} PNs / ${count(plan.rackPallets)} pallets<br><strong>&gt; ${count(threshold)} pallets → ground</strong> · ${count(plan.groundRows.length)} PNs / ${count(plan.groundPallets)} pallets</p><div class="improvement-metrics split-metrics">${metric('Racks — without gangways',r.rackWithoutGangways)}${metric('Racks — with allocated gangways',r.rackWithGangways)}${metric('Ground — without gangways',plan.groundWithoutGangways)}${metric('Ground — with allocated gangways',plan.groundWithGangways)}</div><div class="notice"><strong>Combined footprint</strong><br>Without gangways: ${area(r.rackWithoutGangways+plan.groundWithoutGangways)} m²<br>With allocated gangways: ${area(r.rackWithGangways+plan.groundWithGangways)} m²</div>${failures.length?`<div class="notice error"><strong>Partial totals · ${count(failures.length)} PNs need review</strong><p>These assigned quantities are excluded from their storage areas until corrected.</p><ul>${failures.map(({row,reason})=>`<li>${escape(row.input.partNumber||'(blank PN)')} · ${row.isPlanningValid?count(row.requiredPallets)+' pallets':'Quantity unavailable'} · ${escape(reason)}</li>`).join('')}</ul></div>`:''}${!r.sharedRack?.available?`<div class="notice error">${escape(r.sharedRack?.error||'Shared rack layout unavailable.')} Rack totals use standalone estimates.</div>`:''}<p class="muted">Rack PNs share shelves using the configured rack types and storage rules. This scenario follows the selected category and does not change the four comparison cards. Gangway-inclusive areas are allocated estimates.</p>`;
    }
    input.addEventListener('input',refresh);
    dialog.querySelector('[data-split-close]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('[data-split-settings]').addEventListener('click',()=>{dialog.close();settings();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);refresh();dialog.showModal();input.focus();
  }
  function validationBanner(c) {
    if (c.settingsErrors?.length) return `<div class="notice error"><strong>Warehouse settings need attention.</strong> Results are unavailable until these are corrected.<ul class="validation-list">${c.settingsErrors.map(e => `<li>${escape(e)}</li>`).join('')}</ul><button class="btn btn-secondary small" data-action="settings">Review settings</button></div>`;
    if (c.invalidCount) return `<div class="notice error"><strong>Partial totals · ${count(c.invalidCount)} invalid part ${c.invalidCount === 1 ? 'number' : 'numbers'}.</strong> Floor totals include ${count(c.floorValidCount)} calculable parts; rack totals include ${count(c.rackValidCount)}. A rack-fit error does not exclude valid floor storage. Invalid rows remain visible for correction. <button class="btn btn-ghost small" data-action="invalid">Review invalid rows ${icon('arrow')}</button></div>`;
    return '';
  }
  function kpi(title, value, rack, allocated, unavailable, breakdown = '') {
    return `<article class="kpi-card ${!rack ? 'accent' : ''}"><div class="kpi-top"><button class="kpi-icon ${rack ? 'rack' : ''}" data-action="${rack?'rack-overview':'parts'}" aria-label="${rack?'Open shared rack shelf overview':'Open part details'}">${icon(rack ? 'rack' : 'box')}</button><span class="kpi-tag">${allocated ? 'ALLOCATED FOOTPRINT' : 'STORAGE ONLY'}</span></div><h2>${title}</h2><div class="kpi-value">${unavailable ? '—' : area(value)}<small>m²</small></div><div class="kpi-description">${allocated ? (rack ? 'Rack storage + half-shared gangway allocation' : 'GS net + half-shared gangway allocation') : rack ? escape(breakdown || 'Ground area · all rack levels included') : 'Sum of Floor storage m²'}</div></article>`;
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
      `<div class="kpi-grid">${kpi('PALLETS — WITHOUT GANGWAYS',values[0],false,false,unavailable)}${kpi('PALLETS — WITH GANGWAYS',values[1],false,true,unavailable)}${kpi('RACKS — WITHOUT GANGWAYS',values[2],true,false,unavailable, c.sharedRack?.typeUsage?.length>1?`${count(c.totalRackBays)} bays · ${c.sharedRack.typeUsage.length} rack types`:`${count(c.totalRackBays)} bays × ${area(c.totalRackBays?c.rackWithoutGangways/c.totalRackBays:0)} per bay`)}${kpi('RACKS — WITH GANGWAYS',values[3],true,true,unavailable)}</div>` +productionPanel(c)+(c.sharedRack&&!c.sharedRack.available?`<div class="notice error">${escape(c.sharedRack.error)} Rack figures use standalone estimates.</div>`:'')+
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
    return `<section class="panel floor-stacking-options"><label class="field"><span>Floor stacking mode</span><select id="floor-stacking-mode" data-floor-stacking-mode aria-label="Floor stacking mode">${[['height','Calculate from building height'],['imported','Use stacking from uploaded file'],['manual','One manual factor for all parts']].map(([key,label])=>`<option value="${key}" ${mode===key?'selected':''}>${label}</option>`).join('')}</select></label>${mode==='manual'?`<label class="field"><span>Stacking factor for all parts</span><input id="manual-floor-stacking" data-manual-floor-stacking type="text" inputmode="numeric" aria-label="Stacking factor for all parts" value="${escape(productionDrafts.manualStacking ?? (s.stackingMode==='manual'?s.manualStacking:1))}"></label>`:''}<p class="muted">${mode==='height'?`ROUNDDOWN(Maximum floor stacking height ÷ loaded pallet H). Building height comes from Warehouse Settings: ${count(s.maxFloorStackingHeight)} mm.`:mode==='imported'?'Uses each part’s imported Stacking factor. Missing Stacking defaults to 1. The eight-column template accepts an optional Stacking column.':'One whole factor applies to all parts.'} All factors are capped by Maximum floor stacking height; pallets taller than this limit show an error.</p></section>`;
  }
  function renderParts(c) {
    $('main').innerHTML = heading('EVERY PART, BOTH SCENARIOS', 'Part details', 'Search your inventory, review validation, and explore each calculation.', `<button class="btn btn-secondary" data-action="export">${icon('download')}Export results</button><button class="btn btn-primary" data-action="add">${icon('plus')}Add part number</button>`) + validationBanner(c) + floorStackingOptions() +
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
  function implementationPlan(){return D.calculateImplementation(project().parts,project().settings,project().implementation||{},selectedCategory);}
  function renderImplementation(){
    const config=project().implementation||{},file=config.dwg,types=D.configuredRackTypes(project().settings);
    const rackRows=(config.existingRacks||[]).map((row,index)=>`<div class="existing-rack-row"><label class="field"><span>Rack type</span><select data-existing-type="${index}" aria-label="Rack type ${index+1}">${!types.some(t=>t.id===row.typeId)?'<option value="">Choose rack type</option>':''}${types.map(t=>`<option value="${escape(t.id)}" ${t.id===row.typeId?'selected':''}>${escape(t.name)} · ${count(t.rackSlotLength)} × ${count(t.rackSlotDepth)} × ${count(t.rackSlotHeight)} mm · ${count(t.rackLevels)} levels</option>`).join('')}</select></label><label class="field"><span>Available bays</span><input type="number" min="0" max="1000" step="1" data-existing-bays="${index}" aria-label="Available bays ${index+1}" value="${Number.isSafeInteger(row.bays)?row.bays:''}"></label><button class="btn btn-ghost" data-remove-existing="${index}">Remove</button></div>`).join('');
    $('main').innerHTML=heading('WAREHOUSE PLANNING','Warehouse Designer','Set the warehouse constraints and allocate inventory to available racks and ground storage.')+`<section class="panel implementation-panel"><h2>Warehouse area</h2><label class="checkbox-field"><input id="implementation-greenfield" type="checkbox" ${config.greenfield?'checked':''}><span><strong>Greenfeild</strong><small class="muted">The area is blank, with no existing racks, equipment or other installations.</small></span></label>${config.greenfield?`<label class="checkbox-field implementation-option"><input id="implementation-wall-storage" type="checkbox" ${config.allowWallStorage?'checked':''}><span>Allowed storing on the wall.</span></label><p class="muted">Wall storage permission is saved for layout planning. Uploaded DWG walls are not automatically detected; this checkbox does not change aisle or area formulas.</p>`:`<label class="checkbox-field implementation-option"><input id="implementation-existing-racks" type="checkbox" ${config.useExistingRacks?'checked':''}><span>Use existing racks · add rack types and available bays</span></label>${config.useExistingRacks?`<div id="existing-racks">${rackRows||'<p class="muted">Add the rack types and number of bays already present.</p>'}</div><div class="actions"><button class="btn btn-secondary" data-action="add-existing-rack" ${types.length?'':'disabled'}>${icon('plus')}Add existing rack type</button><button class="btn btn-ghost" data-action="settings">Manage rack types and dimensions</button></div><p class="muted">Types and storage options come from Warehouse settings. Inventory comes from Part details. Enter whole available bays; unused bays still occupy floor area.</p>`:''}`}</section><section class="panel implementation-panel"><h2>Storage allocation</h2><p class="muted">${selectedCategory===null?'All categories':escape(selectedCategory||'Uncategorized')} · ${config.greenfield?'Empty area: inventory starts on ground storage.':'Fill fitting pallets into the entered rack bays; capacity overflow and non-fitting pallets use ground storage.'}</p><div id="implementation-results"></div></section><section class="panel implementation-panel"><h2>Existing warehouse drawing</h2><p class="muted">Upload an AutoCAD .dwg file. The original drawing is saved locally for this project.</p><button class="btn btn-primary" data-action="upload-dwg">${icon('upload')}Upload DWG</button>${file?`<div class="implementation-file"><div><strong>${escape(file.name)}</strong><p class="muted">${decimal(file.size/1024/1024)} MB · Added ${escape(new Date(file.uploadedAt).toLocaleDateString('en-GB'))}</p></div><button class="btn btn-secondary" data-action="download-dwg">${icon('download')}Download DWG</button></div><div class="actions"><button class="btn btn-primary" data-action="convert-dwg-pdf">Create PDF from DWG</button>${config.pdf?'<button class="btn btn-secondary" data-action="download-dwg-pdf">Download PDF</button>':''}</div>${config.pdf?`<p class="muted">PDF: ${escape(config.pdf.name)}</p>`:''}`:'<p class="muted">No DWG uploaded for this project.</p>'}<h3>Local AutoCAD conversion</h3><p class="muted">Install and start the LogEn AutoCAD helper on this PC. Requires licensed AutoCAD with Core Console and DWG To PDF.pc3. Conversion runs on this PC and plots model-space extents to A3 landscape; it does not add the storage plan to the drawing.</p><button class="btn btn-secondary" data-action="download-cad-helper">Download AutoCAD helper</button><p class="muted small-note">DWG/PDF files stay in this browser on this device and are not included in the JSON backup. Save separate copies before changing PCs. A PDF is a plotted drawing, not automatically generated rack placement geometry.</p></section>`;
    renderImplementationResults();
  }
  function renderImplementationResults(){
    const target=$('implementation-results');if(!target)return;const plan=implementationPlan();
    if(!plan.available){target.innerHTML=`<div class="notice error">${plan.errors.map(escape).join('<br>')}</div>`;return;}
    const metric=(label,value)=>`<div><span>${label}</span><strong>${area(value)} m²</strong></div>`;
    target.innerHTML=`<div class="improvement-metrics split-metrics">${metric('Total — without gangways',plan.totalWithoutGangways)}${metric('Total — with allocated gangways',plan.totalWithGangways)}${metric('Racks — without gangways',plan.rack.withoutGangways)}${metric('Racks — with allocated gangways',plan.rack.withGangways)}${metric('Ground — without gangways',plan.groundWithoutGangways)}${metric('Ground — with allocated gangways',plan.groundWithGangways)}</div><p><strong>${count(plan.rackPallets)}</strong> pallets in ${count(plan.rack.bays)} existing bays · <strong>${count(plan.groundPallets)}</strong> pallets on ground</p>${plan.invalidCount?`<div class="notice error">Partial totals: ${count(plan.invalidCount)} PNs need review. Their invalid areas or quantities are excluded and listed below.</div>`:''}<button class="btn btn-secondary" data-action="implementation-rack-layout" ${plan.rack.bays?'':'disabled'}>View filled racks</button><div class="implementation-table-region"><div class="table-scroll implementation-allocation-table" id="implementation-table-viewport"><table class="data-table"><thead><tr><th>Part Number</th><th>Required pallets</th><th>In racks</th><th>On ground</th><th>Ground storage m²</th><th>Status</th></tr></thead><tbody>${plan.rows.map(r=>`<tr><td title="${escape(r.input.partNumber)}">${escape(r.input.partNumber)}</td><td>${count(r.required)}</td><td>${count(r.rackPallets)}</td><td>${count(r.groundPallets)}</td><td>${r.groundPallets===0?'0.00':area(r.ground?.withoutGangways)}</td><td><strong class="storage-location ${r.groundPallets>0?'has-ground':'rack-only'}">${escape(r.storageType)}</strong>${r.required!==null?`<small class="difference-caption">${count(r.rackPallets)} pallets in racks · ${count(r.groundPallets)} pallets on ground</small>`:''}${r.groundReason?`<small class="difference-caption">${escape(r.groundReason)}</small>`:''}${r.errors.length?`<small class="difference-caption error">${escape(r.errors.join(' '))}</small>`:''}</td></tr>`).join('')}</tbody></table></div><div class="implementation-scrollbar" id="implementation-horizontal-scroll" tabindex="0" role="region" aria-label="Scroll storage allocation table horizontally"><div aria-hidden="true"></div></div></div><p class="muted small-note">The existing racks remain in the area total even when partly empty. Shared gangways use the same allocated planning model as the dashboard. Allocation is a feasible packing estimate.</p>`;
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
  async function convertDrawingPDF(){
    const p=project();await work('AutoCAD is creating the PDF on this PC…',async()=>{
      const file=await drawingStore('readonly',store=>store.get(p.id));if(!file)throw new Error('Upload the DWG on this device first.');
      const sourceStamp=p.implementation?.dwg?.uploadedAt;
      let response;
      try{response=await fetch('http://127.0.0.1:8765/convert',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-LogEn-Client':'dwg-converter'},body:file,signal:AbortSignal.timeout(240000)});}catch(error){throw new Error('Could not reach the local AutoCAD helper. Download it, extract it, and run Start LogEn AutoCAD Helper.vbs on this PC. Allow local network access if Chrome asks. '+(error.name==='TimeoutError'?'Conversion timed out.':''));}
      if(!response.ok){const error=await response.json().catch(()=>({error:'AutoCAD conversion failed.'}));throw new Error(error.error);}
      const pdf=await response.blob();if(await pdf.slice(0,5).text()!=='%PDF-')throw new Error('The helper did not return a valid PDF.');
      if(p.implementation?.dwg?.uploadedAt!==sourceStamp)throw new Error('The DWG changed during conversion. Generate its PDF again.');
      await drawingStore('readwrite',store=>store.put(pdf,p.id+':pdf'));
      p.implementation={...p.implementation,pdf:{name:(p.implementation.dwg.name.replace(/\.dwg$/i,''))+'.pdf',size:pdf.size,createdAt:new Date().toISOString()}};save();render();toast('PDF created by AutoCAD and saved locally.');
    });
  }
  async function downloadDrawingPDF(){const p=project();await work('Opening PDF…',async()=>{const pdf=await drawingStore('readonly',store=>store.get(p.id+':pdf'));if(!pdf)throw new Error('Create the PDF on this device first.');download(pdf,p.implementation.pdf?.name||'Warehouse.pdf','application/pdf');});}
  function downloadCADHelper(){const encoded='__AUTOCAD_HELPER__';download(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),'LogEn_AutoCAD_Helper.zip','application/zip');}
  function drawingStore(mode,action){
    return new Promise((resolve,reject)=>{const request=indexedDB.open('logen.project.drawings',1);request.onupgradeneeded=()=>request.result.createObjectStore('drawings');request.onerror=()=>reject(new Error('Drawing storage is unavailable.'));request.onsuccess=()=>{const db=request.result;let result;const tx=db.transaction('drawings',mode);const task=action(tx.objectStore('drawings'));task.onsuccess=()=>{result=task.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(new Error('Could not save or read the drawing. Browser storage may be full.'));};tx.onabort=tx.onerror;};});
  }
  async function uploadDrawing(file){
    if(!file)return;
    await work('Saving warehouse drawing…',async()=>{
      if(!/\.dwg$/i.test(file.name))throw new Error('Choose an AutoCAD .dwg file.');
      const signature=await file.slice(0,6).text();if(!/^AC\d{4}$/.test(signature))throw new Error('This file does not have a recognized AutoCAD DWG header. Choose the original .dwg file.');
      const p=project();await drawingStore('readwrite',store=>store.put(file,p.id));
      const implementation={...p.implementation,pdf:null,dwg:{name:file.name,size:file.size,uploadedAt:new Date().toISOString()}};
      p.implementation=implementation;p.updatedAt=new Date().toISOString();save();render();toast('Warehouse DWG saved locally.');
    });
  }
  async function downloadDrawing(){const p=project();await work('Opening warehouse drawing…',async()=>{const file=await drawingStore('readonly',store=>store.get(p.id));if(!file)throw new Error('This drawing is not stored on this device. Upload the DWG again.');download(file,p.implementation?.dwg?.name||'Warehouse.dwg','application/acad');});}
  function renderProjects() {
    const deleted=state.deletedProjects||[];
    $('main').innerHTML = heading('YOUR LOCAL WORKSPACE', 'Warehouse projects', 'Each project keeps its own inventory and warehouse settings on this device.', `<button class="btn btn-secondary danger-text" data-delete-project="${escape(state.activeId)}">${icon('trash')}Delete current project</button><button class="btn btn-primary" data-action="new-project">${icon('plus')}New warehouse project</button>`) +
      `<div class="project-grid">${state.projects.map(p=>`<article class="panel project-card">${icon('folder')} ${p.id===state.activeId ? '<span class="badge good">ACTIVE</span>' : ''}<h2>${escape(p.name)}</h2><p>${count(p.parts.length)} part numbers · ${'Per-shift planning'}</p><p>Updated ${escape(new Date(p.updatedAt).toLocaleDateString('en-GB'))}</p><div class="actions"><button class="btn btn-secondary small" data-open-project="${escape(p.id)}">Open project ${icon('arrow')}</button><button class="icon-btn" data-rename-project="${escape(p.id)}" title="Rename project" aria-label="Rename ${escape(p.name)}">${icon('edit')}</button><button class="btn btn-ghost small danger-text" data-delete-project="${escape(p.id)}" aria-label="Delete ${escape(p.name)}">${icon('trash')}Delete project</button></div></article>`).join('')}</div>`+
      (deleted.length?`<section class="deleted-projects"><div class="deleted-head"><div><h2>Deleted projects</h2><p>Restore a project with its inventory and warehouse settings.</p></div><span class="badge">${deleted.length} recoverable</span></div><div class="project-grid">${deleted.map(p=>`<article class="panel project-card deleted-project">${icon('trash')}<h2>${escape(p.name)}</h2><p>${count(p.parts.length)} part numbers · Deleted ${escape(new Date(p.deletedAt||p.updatedAt).toLocaleDateString('en-GB'))}</p><div class="actions"><button class="btn btn-secondary small" data-restore-project="${escape(p.id)}" aria-label="Restore ${escape(p.name)}">Restore project ${icon('arrow')}</button></div></article>`).join('')}</div></section>`:'')+
      `<section class="panel backup-panel"><div><h2>Take your workspace with you</h2><p>Back up every active and deleted project, including its settings, to a JSON file.</p></div><div class="actions"><button class="btn btn-secondary" data-action="backup">${icon('download')}Download backup</button><button class="btn btn-secondary" data-action="restore">${icon('upload')}Restore backup</button></div></section><div class="allocation-note">${icon('info')}<span>Projects are stored in this Chrome profile for this HTML file. Keep the file in the same location, and download a backup before clearing browser data, moving the file, or switching computers. Excel exports also include inputs and settings.</span></div>`;
  }
  function render() {
    if (loadError) return renderRecovery();
    const p=project();
    $('project-select').innerHTML=state.projects.map(p=>`<option value="${escape(p.id)}" ${p.id===state.activeId?'selected':''}>${escape(p.name)}</option>`).join('');
    $('breadcrumb-project').textContent=p.name;
    $('nav-count').textContent=p.parts.length;
    document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    const c=calc();
    if (view==='parts') renderParts(c); else if(view==='consumption') renderConsumption(c); else if(view==='projects') renderProjects(); else if(view==='implementation') renderImplementation(); else renderDashboard(c);
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
  document.addEventListener('change',event=>{
    if(event.target.id==='implementation-greenfield'){saveImplementation({greenfield:event.target.checked});return;}
    if(event.target.id==='implementation-wall-storage'){saveImplementation({allowWallStorage:event.target.checked});return;}
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
      if(b.dataset.renameProject){const p=state.projects.find(p=>p.id===b.dataset.renameProject);const name=await E.projectName(p.name);if(name){p.name=name;p.updatedAt=new Date().toISOString();save();render();}return;}
      if(b.dataset.deleteProject)return deleteProject(b.dataset.deleteProject);
      if(b.dataset.restoreProject)return restoreProject(b.dataset.restoreProject);
      if(b.hasAttribute('data-remove-existing')){const rows=[...(project().implementation?.existingRacks||[])];rows.splice(Number(b.dataset.removeExisting),1);saveImplementation({existingRacks:rows});return;}
      switch(b.dataset.action){
        case 'improve-warehouse':await improveWarehouse();break;
        case 'add-existing-rack':{const type=D.configuredRackTypes(project().settings)[0];if(type)saveImplementation({existingRacks:[...(project().implementation?.existingRacks||[]),{typeId:type.id,bays:1}]});break;}
        case 'implementation-rack-layout':{const plan=implementationPlan();if(plan.available){const c=calc();await E.rackOverview({...c,sharedRack:plan.rack,results:plan.rows.filter(r=>r.rackPallets>0).map(r=>({...c.results.find(original=>original.input.partNumber===r.input.partNumber),requiredPallets:r.rackPallets,isRackValid:true,isPlanningValid:true,rackFit:'YES',errors:[]})),totalRequiredPallets:plan.rackPallets,nonFittingPallets:0,nonFittingPartCount:0,nonFittingUnknownQuantity:0},project().settings);}break;}
        case 'convert-dwg-pdf':await convertDrawingPDF();break;
        case 'download-dwg-pdf':await downloadDrawingPDF();break;
        case 'download-cad-helper':downloadCADHelper();break;
        case 'upload-dwg':$('dwg-input').click();break;
        case 'download-dwg':await downloadDrawing();break;
        case 'import':$('excel-input').click();break;
        case 'template':await template();break;
        case 'export':await exportResults();break;
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
