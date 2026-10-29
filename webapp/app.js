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
  const calc = () => D.calculateProject(project().parts, project().settings);
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
    return `<button class="btn btn-secondary" data-action="template">${icon('download')}Download template</button><button class="btn btn-primary" data-action="import">${icon('upload')}Import Excel</button>`;
  }
  function validationBanner(c) {
    if (c.settingsErrors?.length) return `<div class="notice error"><strong>Warehouse settings need attention.</strong> Results are unavailable until these are corrected.<ul class="validation-list">${c.settingsErrors.map(e => `<li>${escape(e)}</li>`).join('')}</ul><button class="btn btn-secondary small" data-action="settings">Review settings</button></div>`;
    if (c.invalidCount) return `<div class="notice error"><strong>Partial totals · ${count(c.invalidCount)} invalid part ${c.invalidCount === 1 ? 'number' : 'numbers'}.</strong> Floor totals include ${count(c.floorValidCount)} calculable parts; rack totals include ${count(c.rackValidCount)}. A rack-fit error does not exclude valid floor storage. Invalid rows remain visible for correction. <button class="btn btn-ghost small" data-action="invalid">Review invalid rows ${icon('arrow')}</button></div>`;
    return '';
  }
  function kpi(title, value, rack, allocated, unavailable) {
    return `<article class="kpi-card ${!rack ? 'accent' : ''}"><div class="kpi-top"><span class="kpi-icon ${rack ? 'rack' : ''}">${icon(rack ? 'rack' : 'box')}</span><span class="kpi-tag">${allocated ? 'ALLOCATED FOOTPRINT' : 'STORAGE ONLY'}</span></div><h2>${title}</h2><div class="kpi-value">${unavailable ? '—' : area(value)}<small>m²</small></div><div class="kpi-description">${allocated ? (rack ? 'Rack quantity × pitch × gangway metres ÷ 2000' : 'GS net + half-shared gangway allocation') : rack ? 'Ground area · all rack levels included' : 'Sum of Floor storage m²'}</div></article>`;
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
    return migrated||inferred ? `<div class="notice">Saved inputs have been converted to per-shift consumption using their previous production settings. ${inferred?'Where box quantities were unavailable, pallet capacity is represented as one box per pallet; review QTY in Box and QTY boxes per Pallet. ':''}Pallet demand is multiplied by the selected shifts, rounded up once per day, then multiplied by DOH.</div>` : '';
  }
  function productionPanel(c) {
    const s=project().settings;
    const valid=c.results.filter(r=>r.isPlanningValid).map(r=>r.planning);
    const sum=key=>valid.reduce((total,p)=>total+(Number.isFinite(p[key])?p[key]:0),0);
    const field=(key,label,unit)=>`<label class="field"><span>${label}</span><div class="input-unit"><input type="text" inputmode="decimal" id="production-${key}" data-production="${key}" aria-label="${label}" value="${escape(productionDrafts[key] ?? (Number.isFinite(s[key])?String(s[key]):''))}" autocomplete="off"><span class="field-unit muted">${unit}</span></div></label>`;
    const totals=[['Consumption per shift',sum('shiftConsumption'),'parts / shift'],['Daily consumption',sum('dailyConsumption'),'parts / day'],['Rounded planning demand',sum('plannedPalletsPerDay'),'pallets / day'],['Required storage pallets',c.totalRequiredPallets,'whole pallets']];
    return `<section class="panel production-panel"><div class="panel-head"><div><h2>Shifts & days on hand</h2><p>Multiply by selected shifts, round up once per day, then apply DOH</p></div><button class="text-link" data-action="consumption">View calculation details ${icon('arrow')}</button></div><div class="production-controls shift-controls"><label class="field"><span>Number of shifts per day</span><select id="production-shiftsPerDay" data-production="shiftsPerDay" aria-label="Number of shifts per day">${![1,2,3].includes(s.shiftsPerDay)?`<option selected disabled value="${escape(s.shiftsPerDay)}">Invalid: choose 1–3</option>`:''}${[1,2,3].map(n=>`<option value="${n}" ${s.shiftsPerDay===n?'selected':''}>${n} ${n===1?'shift':'shifts'} per day</option>`).join('')}</select></label><label class="field"><span>DOH source</span><select id="production-coverageMode" data-production-coverage aria-label="DOH source">${[['input','Use DOH from each part'],['custom','Use DOH override for all parts']].map(([value,label])=>`<option value="${value}" ${s.coverageMode===value?'selected':''}>${label}</option>`).join('')}</select></label>${field('customCoverageDays','DOH override','days')}</div><div class="stackability-controls"><label class="toggle-label"><input id="production-stackabilityEnabled" type="checkbox" data-stackability aria-label="Stackability" ${s.stackabilityEnabled?'checked':''}>Stackability</label><span class="muted">${s.stackabilityEnabled?'Edit each part’s stacking factor in Shift consumption or Part details. Height limits still apply.':'Floor stacking is one pallet high. Enable Stackability to edit a factor for each part.'}</span><button class="text-link" data-action="parts">Edit stacking factors ${icon('arrow')}</button></div><div class="production-note"><strong>Required pallets = ROUNDUP(Consumption per shift ÷ QTY in Box ÷ QTY boxes per Pallet × shifts per day, 0) × DOH.</strong><br>Editing the DOH override applies it to every part. Fractional DOH results round up to a whole storage pallet. L, W and H then determine the floor and rack space.</div><div class="production-totals">${totals.map(([label,value,unit],i)=>`<div><span>${label}</span><strong>${c.settingsErrors?.length?'—':i>=2?count(value):decimal(value)}</strong><small>${unit}</small></div>`).join('')}</div></section>`;
  }
  function coverageCell(p) {
    if(!p)return '—';
    if(p.noConsumption)return '<span class="badge">No consumption</span>';
    return `<span class="${p.coverageMismatch?'coverage-difference':''}">${signed(p.coverageDifferenceDays)}</span>${p.coverageMismatch?'<small class="difference-caption">actual − input</small>':'<span class="badge good">Match</span>'}`;
  }
  function stackingControl(result,index) {
    return `<div class="stacking-control"><input id="stacking-part-${index}" type="number" min="1" step="1" inputmode="numeric" data-stacking-index="${index}" aria-label="Stacking factor for ${escape(result.input.partNumber)}" value="${escape(result.input.stacking)}" ${project().settings.stackabilityEnabled?'':'disabled'}><small class="stacking-error error" hidden></small><small class="muted">${result.isFloorValid?`Used: ${count(result.floor.effectiveStacking)}`:'Review input'}</small></div>`;
  }
  function renderConsumption(c) {
    $('main').innerHTML=heading('PER-SHIFT DEMAND, WHOLE PALLETS','Shift consumption planning','Packaging quantities, consumption per shift and DOH determine the pallets used in both storage scenarios.',`<button class="btn btn-secondary" data-action="export">${icon('download')}Export results</button><button class="btn btn-primary" data-action="add">${icon('plus')}Add part number</button>`)+validationBanner(c)+coverageBanner(c)+productionPanel(c)+
      `<div class="allocation-note">${icon('info')}<span>Decimal pallet consumption is shown for reference. Warehouse planning multiplies the raw pallets per shift by the selected number of shifts, rounds that daily demand up once, then applies DOH. For 0.13 pallets per shift, 1, 2 or 3 shifts give 0.13, 0.26 or 0.39 pallets/day; each rounds up to 1.</span></div><div class="table-tools consumption-tools"><label class="search-field">${icon('search')}<input id="consumption-search" type="search" aria-label="Search consumption part number" placeholder="Search part number…" value="${escape(query)}"></label><span class="muted small-note">Planning DOH: ${escape(coverageTargetLabel(project().settings))}</span></div><section class="panel" id="consumption-table"></section>`;
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
      return `<tr><td><button class="part-link" data-detail="${index}">${icon('box')}${escape(r.input.partNumber||'(blank part number)')}</button>${!r.isValid?'<small class="difference-caption error">Review validation</small>':''}</td>${values.map(v=>`<td class="numeric">${v}</td>`).join('')}<td>${stackingControl(r,index)}</td><td><button class="icon-btn" data-edit="${index}" aria-label="Edit ${escape(r.input.partNumber)}" title="Edit part">${icon('edit')}</button></td></tr>`;
    }).join('')||'<tr><td colspan="18" style="text-align:center;padding:35px">No matching part numbers.</td></tr>'}</tbody></table></div><div class="table-footer"><span>${count(indexed.length)} matching parts · Raw pallets × selected shifts → ROUNDUP daily demand → multiply by DOH → space calculation</span><span class="project-floor-total">Whole project Floor storage m²: ${c.settingsErrors?.length?'—':area(c.floorWithoutGangways)} m²</span><div class="pagination"><button data-consumption-page="-1" ${page===0?'disabled':''}>Previous</button><span>${page+1} / ${pages}</span><button data-consumption-page="1" ${page===pages-1?'disabled':''}>Next</button></div></div>`;
  }
  function renderDashboard(c) {
    const p = project(), unavailable = c.settingsErrors?.length;
    const values = [c.floorWithoutGangways,c.floorWithGangways,c.rackWithoutGangways,c.rackWithGangways];
    const max = Math.max(...values, 1);
    const chartLabels = [['Floor pallets','Without gangways',''],['Floor pallets','With gangways · allocated','floor-allocated'],['Pallet racks','Without gangways','rack'],['Pallet racks','With gangways · allocated','rack-allocated']];
    const stats = [['Imported part numbers',p.parts.length,''],['Required pallets',c.totalRequiredPallets,''],['Floor positions',c.totalFloorPositions,''],['Dedicated floor rows',c.totalFloorRows,''],['Required rack bays',c.totalRackBays,''],['Required rack runs',c.totalRackRuns,''],['Floor gangway area',c.floorGangwayArea,'m²'],['Rack gangway area',c.rackGangwayArea,'m²']];
    const source = p.sourceName || 'Manual inventory';
    const date = new Date(p.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    $('main').innerHTML = heading('PLAN YOUR SPACE', 'Warehouse footprint', 'The same inventory. Four perspectives on your warehouse space.', importButtons()) +
      validationBanner(c) + (saveError ? '<div class="notice error">Changes are in memory only. Download a workspace backup from Projects to keep this work.</div>' : '') +
      `<div class="context-strip"><div class="source-info"><span class="file-icon">${p.sourceName?.endsWith('.xlsx') ? 'XLSX' : 'DATA'}</span><div><strong>${escape(source)} ${source === 'Example inventory' ? '<span class="badge" style="margin-left:7px">SAMPLE DATA</span>' : ''}</strong><small>${count(p.parts.length)} part numbers · Updated ${escape(date)} · ${escape(p.name)}</small></div></div><span class="source-check">${icon(c.invalidCount ? 'info' : 'check')}${c.invalidCount ? `${c.invalidCount} need attention` : 'All parts validated'}</span><button class="btn btn-ghost" data-action="export">${icon('download')}Export results</button></div>` +
      coverageBanner(c)+
      `<div class="mode-toolbar"><div class="section-label">Footprint comparison<span>Same required pallets for floor and racks</span></div><span class="badge">${count(p.settings.shiftsPerDay)} shifts/day · ${escape(coverageTargetLabel(p.settings))}</span></div>` +
      `<div class="kpi-grid">${kpi('PALLETS — WITHOUT GANGWAYS',values[0],false,false,unavailable)}${kpi('PALLETS — WITH GANGWAYS',values[1],false,true,unavailable)}${kpi('RACKS — WITHOUT GANGWAYS',values[2],true,false,unavailable)}${kpi('RACKS — WITH GANGWAYS',values[3],true,true,unavailable)}</div>` +productionPanel(c)+
      `<div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Floor vs. rack storage</h2><p>Compare the four footprint scenarios</p></div><span class="unit-tag">m²</span></div><div class="chart" role="img" aria-label="Footprint comparison: ${values.map(area).join(', ')} square meters"><div style="display:${unavailable ? 'block' : 'none'}" class="notice error">Correct warehouse settings to calculate footprints.</div>${chartLabels.map((r,i) => `<div class="chart-row"><div class="chart-label">${r[0]}<small>${r[1]}</small></div><div class="chart-track"><div class="chart-bar ${r[2]}" style="width:${unavailable ? 0 : values[i]/max*100}%"></div></div><span class="chart-number">${unavailable ? '—' : area(values[i])}</span></div>`).join('')}</div><div class="chart-legend"><span><i class="legend-dot"></i>Floor pallets</span><span><i class="legend-dot rack"></i>Pallet racks</span><span>Striped = allocated gangways included</span></div></section><section class="panel savings-panel"><div class="panel-head"><div><h2>Space savings with racks</h2><p>Floor footprint minus rack footprint</p></div>${icon('chart')}</div>${c.results.some(r=>r.isFloorValid!==r.isRackValid)?'<div class="notice">Floor and rack totals cover different parts; savings compare partial inventories.</div>':''}<div class="saving-items">${savingsItem('WITHOUT GANGWAYS',unavailable ? null : c.savingWithoutGangways,unavailable ? null : c.savingWithoutGangwaysPercent)}${savingsItem('WITH ALLOCATED GANGWAYS',unavailable ? null : c.savingWithGangways,unavailable ? null : c.savingWithGangwaysPercent)}</div></section></div>` +
      `<section class="panel stats-panel"><div class="panel-head"><h2>Warehouse at a glance</h2><button class="text-link" data-action="settings">Configure warehouse ${icon('settings')}</button></div><div class="stats-grid">${stats.map(([label,value,unit],i) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${unavailable && i > 0 ? '—' : unit ? area(value) : count(value)}${unit ? `<small>${unit}</small>` : ''}</span>${i===0 && c.invalidCount ? `<span class="badge error">${c.invalidCount} invalid</span>` : ''}</div>`).join('')}</div></section>` +
      `<div class="allocation-note">${icon('info')}<span>Ground storage uses actual occupied pallet-row depth, including pallet clearances. The row-depth setting limits row capacity; 0 removes that limit. Gangway-inclusive values use the full configured width: ${count(D.allocatedGangwayWidth(p.settings))} mm. Floor with gangways = GS net + half-shared gangway allocation. Q/S is unrounded and this formula excludes pallet clearances. Storage-only floor area uses rounded positions and occupied rows. Racks use actual run frontage. These are planning estimates. Each part has dedicated rows and rack bays; shared gangways count once in a physical design.</span></div>` +
      `<section class="panel table-panel"><div class="panel-head"><div><h2>Part number overview</h2><p>Tap any part number to see the formulas behind it</p></div><button class="text-link" data-action="parts">View all parts ${icon('arrow')}</button></div>${previewTable(c)}<div class="table-footer"><span>Showing ${Math.min(p.parts.length,4)} of ${p.parts.length} part numbers</span><span>Same required pallets in both scenarios</span></div></section>`;
  }
  function previewTable(c) {
    if (!c.results.length) return emptyInventory();
    return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Part number</th><th class="numeric">Required pallets</th><th class="numeric">Floor · storage m²</th><th class="numeric">Rack · storage m²</th><th>Status</th></tr></thead><tbody>${c.results.slice(0,4).map((r,i) => `<tr><td><button class="part-link" data-detail="${i}">${icon('box')}${escape(r.input.partNumber || '(blank part number)')}</button></td><td class="numeric">${count(r.isPlanningValid?r.requiredPallets:null)}</td><td class="numeric">${area(r.isFloorValid?r.floor?.storageArea:null)}</td><td class="numeric">${area(r.isRackValid?r.rack?.withoutGangways:null)}</td><td><span class="badge ${r.isValid ? 'good' : 'error'}">${r.isValid ? 'Validated' : 'Needs attention'}</span></td></tr>`).join('')}</tbody></table></div>`;
  }
  function emptyInventory() {
    return `<div class="empty-state">${icon('box')}<h2>Your inventory starts here</h2><p>Import an Excel workbook or add parts manually. LogEn calculates floor and rack storage for every part automatically.</p><div class="actions"><button class="btn btn-primary" data-action="import">${icon('upload')}Import Excel</button><button class="btn btn-secondary" data-action="add">${icon('plus')}Add a part</button></div></div>`;
  }
  function renderParts(c) {
    $('main').innerHTML = heading('EVERY PART, BOTH SCENARIOS', 'Part details', 'Search your inventory, review validation, and explore each calculation.', `<button class="btn btn-secondary" data-action="export">${icon('download')}Export results</button><button class="btn btn-primary" data-action="add">${icon('plus')}Add part number</button>`) + validationBanner(c) +
      `<div class="input-summary"><span>Planning: <strong>ROUNDUP(raw pallets × selected shifts) × DOH</strong></span><span>DOH: <strong>${escape(coverageTargetLabel(project().settings))}</strong></span><span>Shifts/day: <strong>${count(project().settings.shiftsPerDay)}</strong></span><span>Rack levels: <strong>${project().settings.rackLevels}</strong></span></div><div class="table-tools"><label class="search-field">${icon('search')}<input id="part-search" type="search" placeholder="Search part number…" aria-label="Search part number" value="${escape(query)}"></label><label class="toggle-label"><input id="invalid-filter" type="checkbox" ${invalidOnly ? 'checked' : ''}>Only invalid parts</label><div class="actions"><button class="btn btn-secondary" data-action="consumption">${icon('chart')}Shift calculation details</button><button class="btn btn-secondary" data-action="import">${icon('upload')}Import Excel</button><button class="btn btn-ghost" data-action="template">${icon('download')}Template</button></div></div><section class="panel" id="parts-table"></section>`;
    renderPartsTable(c);
    $('part-search').addEventListener('input', e => {query=e.target.value;page=0;renderPartsTable(calc());});
    $('invalid-filter').addEventListener('change', e => {invalidOnly=e.target.checked;page=0;renderPartsTable(calc());});
  }
  function renderPartsTable(c) {
    const indexed = c.results.map((r,index) => ({r,index})).filter(({r}) => r.input.partNumber.toLowerCase().includes(query.toLowerCase()) && (!invalidOnly || !r.isValid));
    const pages = Math.max(1, Math.ceil(indexed.length/PAGE_SIZE)); page=Math.min(page,pages-1);
    const rows = indexed.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
    if (!c.results.length) { $('parts-table').innerHTML=emptyInventory(); return; }
    const headers = ['Part number','Required pallets','Floor stacking','Floor positions','Floor rows','Floor storage m²','Floor allocated m²','Rack','Rack pallets / slot','Rack levels','Rack bays','Rack runs','Rack storage m²','Rack allocated m²','Input details','Validation','Actions'];
    $('parts-table').innerHTML = `<div class="rack-fit-summary notice">Rack footprint check: ${count(c.nonFittingPallets)} required pallets across ${count(c.nonFittingPartCount)} part numbers do NOT fit. ${count(c.nonFittingUnknownQuantity)} non-fitting part numbers have unavailable pallet quantities. YES is footprint fit only; height and clearances still apply. Missing dimensions show N/A.</div><div class="table-scroll"><table class="data-table"><thead><tr>${headers.map((h,i)=>`<th class="${i>0&&i<13?'numeric':''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(({r,index}) => {
      const numbers = [count(r.isPlanningValid?r.requiredPallets:null),count(r.isFloorValid?r.floor?.effectiveStacking:null),count(r.isFloorValid?r.floor?.positions:null),count(r.isFloorValid?r.floor?.rows:null),area(r.isFloorValid?r.floor?.storageArea:null),area(r.isFloorValid?r.floor?.withGangways:null),r.rackFit||'N/A',count(r.isRackValid?r.rack?.palletsPerSlot:null),count(r.isRackValid?r.rack?.levels:null),count(r.isRackValid?r.rack?.bays:null),count(r.isRackValid?r.rack?.runs:null),area(r.isRackValid?r.rack?.withoutGangways:null),area(r.isRackValid?r.rack?.withGangways:null)];
      return `<tr><td><button class="part-link" data-detail="${index}">${icon('box')}${escape(r.input.partNumber || '(blank part number)')}</button></td>${numbers.map((n,i)=>`<td class="numeric">${i===1?stackingControl(r,index):n}</td>`).join('')}<td><span>${count(r.input.qtyBox)} parts/box × ${count(r.input.qtyOnPallet)} boxes/pallet</span><br><small class="muted">${decimal(r.input.consumptionPerShift)} parts/shift · ${decimal(r.input.doh)} input DOH<br>${count(r.input.length)} × ${count(r.input.width)} × ${count(r.input.height)} mm</small></td><td class="${r.isValid?'':'invalid-cell'}">${r.isValid ? '<span class="badge good">Validated</span>' : escape(r.errors.join(' '))}</td><td><button class="icon-btn" data-edit="${index}" title="Edit ${escape(r.input.partNumber)}" aria-label="Edit ${escape(r.input.partNumber)}">${icon('edit')}</button><button class="icon-btn" data-delete="${index}" title="Delete ${escape(r.input.partNumber)}" aria-label="Delete ${escape(r.input.partNumber)}">${icon('trash')}</button></td></tr>`;
    }).join('') || '<tr><td colspan="17" style="text-align:center;padding:35px">No matching part numbers.</td></tr>'}</tbody><tfoot><tr><th>Whole project totals</th><td>${count(c.totalRequiredPallets)}</td><td></td><td>${count(c.totalFloorPositions)}</td><td>${count(c.totalFloorRows)}</td><td>${area(c.floorWithoutGangways)}</td><td>${area(c.floorWithGangways)}</td><td></td><td></td><td></td><td>${count(c.totalRackBays)}</td><td>${count(c.totalRackRuns)}</td><td>${area(c.rackWithoutGangways)}</td><td>${area(c.rackWithGangways)}</td><td colspan="3"></td></tr></tfoot></table></div><div class="table-footer"><span>${count(indexed.length)} matching part numbers · All areas in m², shown to two decimals</span><span class="project-floor-total">Whole project Floor storage m²: ${c.settingsErrors?.length?'—':area(c.floorWithoutGangways)} m²</span><div class="pagination"><button data-page="-1" ${page===0?'disabled':''}>Previous</button><span>${page+1} / ${pages}</span><button data-page="1" ${page===pages-1?'disabled':''}>Next</button></div></div>`;
  }
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
    if (view==='parts') renderParts(c); else if(view==='consumption') renderConsumption(c); else if(view==='projects') renderProjects(); else renderDashboard(c);
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
    update({parts:imported.parts,rawInputRows:imported.rawInputRows,sourceName:file.name});go('dashboard');toast(`${imported.parts.length} part numbers imported. Four footprints calculated.`);
  }
  async function exportResults() {
    await work('Building your Excel comparison…',async()=>{
      const p=project(),c=calc();download(await W.exportBytes(p,c),`${safeName(p.name)}_LogEn_Results.xlsx`);
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
    await modal({title:'From shift consumption to warehouse space',eyebrow:'HOW LOGEN WORKS',body:`<div class="help-steps"><div class="help-step"><strong>01 / PREPARE</strong><h3>Download the eight-column template</h3><p>Part Number, QTY in Box, QTY boxes per Pallet, Consumption per shift, DOH (Days on hand), L(mm), W(mm), H(mm).</p></div><div class="help-step"><strong>02 / IMPORT</strong><h3>Import your parts</h3><p>All file processing happens locally. L, W and H are loaded pallet dimensions. Stacking defaults to 1. Enable Stackability in Shifts & days on hand to edit a factor for every part; turn it off to use one-high storage while keeping those factors saved.</p></div><div class="help-step"><strong>03 / CONFIGURE</strong><h3>Choose shifts and DOH</h3><p>Select 1, 2 or 3 shifts per day. Use each part’s Excel DOH or apply a chosen DOH override to all parts.</p></div><div class="help-step"><strong>04 / COMPARE</strong><h3>Review and export</h3><p>The same required pallet count drives floor and rack m² calculations. Inspect substituted formulas and export the five-sheet workbook.</p></div></div><h3>Your required-pallet formula</h3><div class="formula-box"><code>ROUNDUP(Consumption per shift / QTY in Box / QTY boxes per Pallet × shifts per day, 0) × DOH</code></div><p class="muted">Multiply the raw pallet demand by the selected shifts before rounding. Example: 1,000 parts/shift ÷ 20 parts/box ÷ 40 boxes/pallet = 1.25 pallets/shift. With 2 shifts, 1.25 × 2 = 2.5 pallets/day, rounded to 3. At 5 DOH, required pallets = 3 × 5 = 15. If fractional DOH produces a fractional final count, it is rounded up to whole storage pallets.</p><h3>Projects and offline use</h3><p class="muted">Projects → Delete project asks for confirmation. Restore a deleted project with all inventory and settings from Deleted projects. The file embeds all code, Excel tools and the logo. Back up projects before moving this file or clearing browser data.</p><h3>Excel-style surface allocations</h3><p class="muted">GS net = lane depth × lane width × lanes / 1,000,000 (all dimensions mm). GS allocated = GS net + lane width × lanes × physical gangway width in metres / 2000. PR net = required rack bays × rack surface allowance. PR allocated = required rack bays × rack pitch in mm × physical gangway width in metres / 2000; this does not add PR net. Both allocate half a shared gangway. Existing whole-bay capacity rounding and rotation restrictions are preserved. Rack YES compares usable slot length/depth exactly; height and clearances still govern eligibility. These are allocations, not physical aisle layouts.</p>`,confirm:'Got it',cancel:''});
  }
  function renderRecovery() {
    $('main').innerHTML=heading('WORKSPACE RECOVERY','Saved data needs attention','The saved workspace has been kept intact.')+`<div class="notice error">${escape(loadError)}</div><section class="panel backup-panel"><div><h2>Recover your workspace</h2><p>Restore a JSON backup, or recover the previous local save.</p></div><div class="actions"><button class="btn btn-primary" data-action="restore">Restore backup</button><button class="btn btn-secondary" data-action="recover">Recover previous save</button><button class="btn btn-secondary" data-action="raw-backup">Download saved data</button></div></section>`;
  }
  document.addEventListener('input',event=>{
    if(event.target.dataset.stackingIndex!==undefined&&!busy&&!loadError){
      const input=event.target,error=input.parentElement.querySelector('.stacking-error');
      if(!project().settings.stackabilityEnabled)return;
      const value=Number(input.value),valid=input.value.trim()!==''&&Number.isSafeInteger(value)&&value>=1;
      if(!valid){input.setAttribute('aria-invalid','true');error.textContent='Enter a whole stacking factor of at least 1. This value has not been saved.';error.hidden=false;return;}
      const parts=project().parts.slice(),index=Number(input.dataset.stackingIndex);
      parts[index]={...parts[index],stacking:value};update({parts},true);return;
    }
    const key=event.target.dataset.production;
    if(!key||busy||loadError)return;
    productionDrafts[key]=event.target.value;
    const number=event.target.value.trim()===''?NaN:Number(event.target.value);
    update({settings:{...project().settings,[key]:number,...(key==='customCoverageDays'?{coverageMode:'custom'}:{})}},true);
  });
  document.addEventListener('change',event=>{
    if(event.target.hasAttribute('data-stackability')&&!busy&&!loadError){update({settings:{...project().settings,stackabilityEnabled:event.target.checked}},true);return;}
    if(!event.target.hasAttribute('data-production-coverage')||busy||loadError)return;
    update({settings:{...project().settings,coverageMode:event.target.value}},true);
  });
  document.addEventListener('click',async event=>{
    const b=event.target.closest('button');if(!b||busy)return;
    try{
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
      switch(b.dataset.action){
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
