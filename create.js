/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';
const JETS = ["Waterjet 1", "Waterjet 2", "Waterjet 3"];

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function round3(v){ return Math.round(n(v) * 1000) / 1000; }
function uid(){ return 'trk_' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
function uidBd(){ return 'bd_' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
function qs(name){ try{ return new URL(window.location.href).searchParams.get(name); } catch{ return null; } }

async function loadAll(){ return await t.get('card','shared',STORAGE_KEY,{}); }
async function saveAll(all){ await t.set('card','shared',STORAGE_KEY,all); }

function setWarn(msg){
  const w = document.getElementById('warn');
  if (!w) return;
  if (!msg){ w.style.display='none'; w.textContent=''; return; }
  w.style.display='block';
  w.textContent = msg;
}

function upgradeTrackerSchema(tr){
  if (!tr) return tr;

  const jets = { ...(tr.jets || {}) };
  for (const [k,v] of Object.entries(jets)){
    if (!v || typeof v !== 'object') continue;
    if (v.target == null && v.max != null) v.target = v.max;
    if (v.current == null) v.current = 0;
    delete v.max;
  }

  const breakdowns = Array.isArray(tr.breakdowns) ? tr.breakdowns.map(b => {
    const bj = { ...(b.jets || {}) };
    for (const [k,v] of Object.entries(bj)){
      if (!v || typeof v !== 'object') continue;
      if (v.target == null && v.max != null) v.target = v.max;
      if (v.current == null) v.current = 0;
      delete v.max;
    }
    return {
      id: b.id || uidBd(),
      name: b.name ?? '',
      totalTarget: b.totalTarget ?? b.totalMax ?? 0,
      jets: bj
    };
  }) : [];

  return {
    ...tr,
    totalTarget: tr.totalTarget ?? tr.totalMax ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets,
    breakdowns,
    checklistItemName: tr.checklistItemName ?? null
  };
}

/** ---------- AUTH / CHECKLIST ---------- */

async function isAuthorized(){
  try{
    return await t.getRestApi().isAuthorized();
  }catch{
    return false;
  }
}

async function authorize(){
  return t.authorize({
    scope: { read: true, write: false },
    expiration: "never",
    name: "Waterjet Run Tracker"
  });
}

async function fetchChecklistItemsFlat(){
  // REST first (stable)
  try{
    const rest = t.getRestApi();
    const ok = await rest.isAuthorized();
    if (ok){
      const card = await t.card('id');
      const checklists = await rest.get(`/cards/${card.id}/checklists`, {
        checkItems: 'all',
        fields: 'name',
        checkItem_fields: 'name'
      });

      const out = [];
      for (const cl of (checklists || [])){
        for (const it of (cl.checkItems || [])){
          out.push({ id: it.id, name: it.name, checklistName: cl.name || 'Checklist' });
        }
      }
      out.sort((a,b) => a.checklistName.localeCompare(b.checklistName) || a.name.localeCompare(b.name));
      return out;
    }
  }catch{ /* ignore */ }

  // Fallback (flaky)
  try{
    const card = await t.card('checklists');
    const lists = card?.checklists || [];
    const out = [];
    const seen = new Set();
    for (const cl of lists){
      const clName = cl?.name || 'Checklist';
      const items = cl?.checkItems || cl?.items || cl?.checkItemStates || [];
      for (const it of items){
        const id = it?.id || it?.idCheckItem;
        const name = it?.name;
        if (!id || !name) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, name, checklistName: clName });
      }
    }
    out.sort((a,b) => a.checklistName.localeCompare(b.checklistName) || a.name.localeCompare(b.name));
    return out;
  }catch{
    return [];
  }
}

/** ---------- JET AUTO SELECT FROM Machine(s) ---------- */
/**
 * Your setup: one custom field named "Machine(s)" with multi selection values like:
 * "Waterjet #1, Waterjet #3"
 * We parse value.text as comma-separated, and also handle single list option.
 */
async function guessJetsFromMachineField(){
  try{
    const card = await t.card('customFieldItems', 'customFields');
    const items = card?.customFieldItems || [];
    const fields = card?.customFields || [];
    if (!items.length || !fields.length) return null;

    const fieldById = new Map(fields.map(f => [f.id, f]));
    const selected = new Set();

    const addFromChunk = (chunk) => {
      const s = String(chunk || '').toLowerCase();
      if (!s) return;
      if (s.includes('#1') || s.includes('waterjet 1') || s.includes('waterjet #1')) selected.add("Waterjet 1");
      if (s.includes('#2') || s.includes('waterjet 2') || s.includes('waterjet #2')) selected.add("Waterjet 2");
      if (s.includes('#3') || s.includes('waterjet 3') || s.includes('waterjet #3')) selected.add("Waterjet 3");
    };

    for (const it of items){
      const def = fieldById.get(it.idCustomField);
      const fieldName = (def?.name || '').trim().toLowerCase();
      if (fieldName !== 'machine(s)') continue;

      // list option single
      if (it.idValue){
        const opt = (def?.options || []).find(o => o.id === it.idValue);
        addFromChunk(opt?.value?.text || '');
      }

      // text (often used by multi-select type power-ups / mirrored values)
      if (it.value?.text){
        const parts = String(it.value.text)
          .split(/[,\n]/g)
          .map(x => x.trim())
          .filter(Boolean);
        for (const p of parts) addFromChunk(p);
      }
    }

    if (selected.size) return Array.from(selected);
    return null;
  }catch{
    return null;
  }
}

/** ---------- UI HELPERS ---------- */

function buildJetToggles(selected){
  const wrap = document.getElementById('jetToggles');
  wrap.innerHTML = '';
  for (const jet of JETS){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chipBtn';
    btn.dataset.jet = jet;
    btn.dataset.on = selected.includes(jet) ? 'true' : 'false';
    btn.textContent = jet;

    btn.addEventListener('click', () => {
      btn.dataset.on = (btn.dataset.on === 'true') ? 'false' : 'true';
      // re-render both modes
      renderSimpleJetTargets();
      renderBreakdowns();
      ensureModeVisibility();
    });

    wrap.appendChild(btn);
  }
}

function selectedJets(){
  return Array.from(document.querySelectorAll('#jetToggles .chipBtn'))
    .filter(b => b.dataset.on === 'true')
    .map(b => b.dataset.jet);
}

function isAutoSplitOn(){
  return document.getElementById('autoSplit').value === 'on';
}

/** ---------- SIMPLE MODE TARGETS ---------- */

function renderSimpleJetTargets(existingJets = null){
  const box = document.getElementById('jetsBox');
  box.innerHTML = '';

  const jets = selectedJets();
  if (!jets.length){
    const div = document.createElement('div');
    div.style.fontWeight = '900';
    div.style.color = '#555';
    div.textContent = 'Select at least one jet above.';
    box.appendChild(div);
    return;
  }

  for (const jet of jets){
    const line = document.createElement('div');
    line.className = 'jetLine';

    const left = document.createElement('div');
    left.className = 'jetName';
    left.textContent = jet;

    const input = document.createElement('input');
    input.className = 'jetTarget';
    input.type = 'number';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.dataset.jet = jet;

    if (existingJets?.[jet]?.target != null) input.value = existingJets[jet].target;

    line.appendChild(left);
    line.appendChild(input);
    box.appendChild(line);
  }
}

function applyAutoSplitSimple(){
  const jets = selectedJets();
  if (!jets.length){ setWarn('Select at least one jet first.'); return; }

  const totalRaw = document.getElementById('totalTarget').value;
  const total = round3(totalRaw);
  if (!Number.isFinite(total) || total <= 0){ setWarn('Enter a Total target above 0 for auto-split.'); return; }

  setWarn('');
  const perJet = round3(total / jets.length);

  for (const inp of document.querySelectorAll('#jetsBox .jetTarget')){
    inp.value = perJet;
  }
}

function readSimpleJets(existingJets){
  const jets = {};
  for (const jet of selectedJets()){
    const inp = document.querySelector(`#jetsBox .jetTarget[data-jet="${jet}"]`);
    const target = round3(inp?.value);
    const prev = existingJets?.[jet];
    jets[jet] = { current: prev ? round3(prev.current) : 0, target };
  }
  return jets;
}

/** ---------- BREAKDOWNS MODE ---------- */

let breakdowns = []; // local working state

function ensureModeVisibility(){
  const hasBreakdowns = Array.isArray(breakdowns) && breakdowns.length > 0;
  document.getElementById('simpleTargetsWrap').style.display = hasBreakdowns ? 'none' : 'block';
  document.getElementById('breakdownsWrap').style.display = hasBreakdowns ? 'block' : 'none';
}

function addBreakdown(prefill = null){
  const jets = {};
  for (const j of selectedJets()){
    jets[j] = { current: 0, target: 0 };
  }
  breakdowns.push({
    id: prefill?.id || uidBd(),
    name: prefill?.name || '',
    totalTarget: prefill?.totalTarget ?? 0,
    jets: prefill?.jets || jets
  });
}

function removeBreakdown(id){
  breakdowns = breakdowns.filter(b => b.id !== id);
}

function applyAutoSplitBreakdowns(){
  const jets = selectedJets();
  if (!jets.length){ setWarn('Select at least one jet first.'); return; }
  if (!breakdowns.length){ setWarn('Add at least one breakdown first.'); return; }

  setWarn('');
  for (const bd of breakdowns){
    const total = round3(bd.totalTarget);
    if (!total || total <= 0) continue;
    const perJet = round3(total / jets.length);
    for (const j of jets){
      if (!bd.jets[j]) bd.jets[j] = { current: 0, target: 0 };
      bd.jets[j].target = perJet;
    }
  }
  renderBreakdowns();
}

function renderBreakdowns(){
  const box = document.getElementById('breakdownsBox');
  box.innerHTML = '';

  const jets = selectedJets();
  if (!jets.length){
    const div = document.createElement('div');
    div.style.fontWeight = '900';
    div.style.color = '#555';
    div.textContent = 'Select at least one jet above.';
    box.appendChild(div);
    return;
  }

  for (const bd of breakdowns){
    // ensure jets exist
    for (const j of jets){
      if (!bd.jets[j]) bd.jets[j] = { current: 0, target: 0 };
    }
    // remove deselected jets from breakdown
    for (const key of Object.keys(bd.jets)){
      if (!jets.includes(key)) delete bd.jets[key];
    }

    const card = document.createElement('div');
    card.className = 'bdCard';

    const headerRow = document.createElement('div');
    headerRow.className = 'bdHeaderRow';

    const left = document.createElement('div');
    left.className = 'bdHeader';
    left.textContent = 'Breakdown';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btnSmall btnDanger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      removeBreakdown(bd.id);
      renderBreakdowns();
      ensureModeVisibility();
    });

    headerRow.appendChild(left);
    headerRow.appendChild(removeBtn);

    const top = document.createElement('div');
    top.className = 'bdTop';

    const nameWrap = document.createElement('div');
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.value = bd.name || '';
    nameInput.placeholder = 'Example: File A / Blue / Rev 2 / Lane 3';
    nameInput.addEventListener('input', e => { bd.name = e.target.value; });
    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(nameInput);

    const tgtWrap = document.createElement('div');
    const tgtLabel = document.createElement('label');
    tgtLabel.textContent = 'Breakdown total target';
    const tgtInput = document.createElement('input');
    tgtInput.type = 'number';
    tgtInput.step = 'any';
    tgtInput.value = bd.totalTarget ?? 0;
    tgtInput.addEventListener('input', e => { bd.totalTarget = round3(e.target.value); });
    tgtWrap.appendChild(tgtLabel);
    tgtWrap.appendChild(tgtInput);

    top.appendChild(nameWrap);
    top.appendChild(tgtWrap);

    const panel = document.createElement('div');
    panel.className = 'panel';

    for (const j of jets){
      const line = document.createElement('div');
      line.className = 'jetLine';

      const nm = document.createElement('div');
      nm.className = 'jetName';
      nm.textContent = j;

      const inp = document.createElement('input');
      inp.className = 'jetTarget';
      inp.type = 'number';
      inp.step = 'any';
      inp.value = bd.jets[j]?.target ?? 0;
      inp.addEventListener('input', e => {
        bd.jets[j].target = round3(e.target.value);
      });

      line.appendChild(nm);
      line.appendChild(inp);
      panel.appendChild(line);
    }

    card.appendChild(headerRow);
    card.appendChild(top);
    card.appendChild(panel);

    box.appendChild(card);
  }
}

/** ---------- APPLY AUTO SPLIT (SMART) ---------- */
function applyAutoSplit(){
  // if breakdowns exist -> split within each breakdown total
  if (breakdowns.length){
    return applyAutoSplitBreakdowns();
  }
  // else split simple
  return applyAutoSplitSimple();
}

/** ---------- SAVE ---------- */
function validate(){
  const jets = selectedJets();
  if (!jets.length){ setWarn('Select at least one jet.'); return false; }

  if (breakdowns.length){
    for (const b of breakdowns){
      if (!String(b.name || '').trim()){
        setWarn('Each breakdown needs a name.');
        return false;
      }
      // allow 0 target, but targets must be numeric
      for (const j of jets){
        const v = b.jets?.[j]?.target;
        if (!Number.isFinite(n(v))){
          setWarn(`Invalid target on breakdown "${b.name}" for ${j}.`);
          return false;
        }
      }
    }
  } else {
    // simple
    for (const j of jets){
      const inp = document.querySelector(`#jetsBox .jetTarget[data-jet="${j}"]`);
      const v = inp?.value;
      if (!Number.isFinite(n(v))){
        setWarn(`Invalid target for ${j}.`);
        return false;
      }
    }
  }

  setWarn('');
  return true;
}

/** ---------- BOOT ---------- */
async function boot(){
  const mode = qs('mode');
  const editId = qs('id');

  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const saveBtn = document.getElementById('saveBtn');
  const authBtn = document.getElementById('authBtn');

  // auth button visibility
  const authed = await isAuthorized();
  authBtn.style.display = authed ? 'none' : 'inline-block';
  authBtn.addEventListener('click', async () => {
    await authorize();
    // refresh dropdown after auth
    await boot();
  });

  const all = await loadAll();
  let editing = null;

  // checklist dropdown
  const checklistSelect = document.getElementById('checklist');
  checklistSelect.innerHTML = '<option value="">— Not linked —</option>';
  const items = await fetchChecklistItemsFlat();

  if (!items.length){
    // This matches your “shows only after toggle” symptom — authorization fixes it.
    if (!authed){
      setWarn('Checklist items not loaded. Click “Authorize (fix checklist)”.');
    }
  } else {
    let currentGroup = null;
    let currentName = null;
    for (const it of items){
      if (it.checklistName !== currentName){
        currentName = it.checklistName;
        currentGroup = document.createElement('optgroup');
        currentGroup.label = it.checklistName;
        checklistSelect.appendChild(currentGroup);
      }
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.name;
      currentGroup.appendChild(opt);
    }
  }

  // Jet toggles default
  const guessed = await guessJetsFromMachineField();
  const defaultJets = (guessed && guessed.length) ? guessed : [...JETS];

  // Clear local breakdowns
  breakdowns = [];

  // Edit mode
  if (mode === 'edit' && editId && all[editId]){
    editing = upgradeTrackerSchema(all[editId]);

    title.textContent = 'Edit Run Tracker';
    subtitle.textContent = 'Targets, jets, optional link, and Run Breakdown.';
    saveBtn.textContent = 'Save changes';

    document.getElementById('name').value = editing.name || '';
    document.getElementById('totalTarget').value = (editing.totalTarget ? editing.totalTarget : '');
    document.getElementById('autoSplit').value = editing.autoSplit ? 'on' : 'off';

    const selected = Object.keys(editing.jets || {}).length ? Object.keys(editing.jets) : defaultJets;
    buildJetToggles(selected);

    if (editing.checklistItemId) checklistSelect.value = editing.checklistItemId;

    // load breakdowns from saved
    if (editing.breakdowns && editing.breakdowns.length){
      breakdowns = editing.breakdowns.map(b => ({
        id: b.id || uidBd(),
        name: b.name || '',
        totalTarget: b.totalTarget ?? 0,
        jets: b.jets || {}
      }));
      renderBreakdowns();
    } else {
      renderSimpleJetTargets(editing.jets || {});
    }

  } else {
    // Create mode
    buildJetToggles(defaultJets);
    renderSimpleJetTargets(null);
  }

  ensureModeVisibility();

  // Buttons
  document.getElementById('applyAuto').addEventListener('click', () => applyAutoSplit());

  document.getElementById('addBreakdownBtn').addEventListener('click', () => {
    addBreakdown();
    renderBreakdowns();
    ensureModeVisibility();
  });

  document.getElementById('clearBreakdownsBtn').addEventListener('click', () => {
    breakdowns = [];
    renderSimpleJetTargets(editing?.jets || null);
    ensureModeVisibility();
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    if (!validate()) return;

    const nameRaw = document.getElementById('name').value.trim();
    const name = nameRaw ? nameRaw : null;

    const checklistItemId = checklistSelect.value || null;
    const checklistItemName =
      checklistItemId ? (items.find(x => x.id === checklistItemId)?.name || editing?.checklistItemName || null) : null;

    const totalTargetRaw = document.getElementById('totalTarget').value;
    const totalTarget = totalTargetRaw === '' ? 0 : round3(totalTargetRaw);
    const autoSplit = isAutoSplitOn();

    // Build payload
    let jets = {};
    let finalBreakdowns = [];

    if (breakdowns.length){
      // breakdown mode ignores simple jets targets
      finalBreakdowns = breakdowns.map(b => ({
        id: b.id || uidBd(),
        name: String(b.name || '').trim(),
        totalTarget: round3(b.totalTarget),
        jets: Object.fromEntries(Object.entries(b.jets || {}).map(([k,v]) => [
          k,
          { current: editing ? (findExistingBreakdownJetCurrent(editing, b.id, k) ?? 0) : 0, target: round3(v.target) }
        ]))
      }));

      // Set tracker jets empty (not used)
      jets = {};
    } else {
      jets = readSimpleJets(editing?.jets || null);
    }

    const payload = upgradeTrackerSchema({
      ...(editing || {}),
      name,
      checklistItemId,
      checklistItemName,
      totalTarget,
      autoSplit,
      collapsed: editing?.collapsed ?? false,
      jets,
      breakdowns: finalBreakdowns
    });

    if (editing){
      all[editId] = payload;
      await saveAll(all);
      return t.closeModal();
    }

    const id = uid();
    all[id] = payload;
    await saveAll(all);
    return t.closeModal();
  });

  t.sizeTo(document.body);
}

// pull existing current values when editing breakdowns
function findExistingBreakdownJetCurrent(editing, breakdownId, jetName){
  try{
    const b = (editing.breakdowns || []).find(x => x.id === breakdownId);
    if (!b) return null;
    const j = b.jets?.[jetName];
    if (!j) return null;
    return round3(j.current);
  }catch{
    return null;
  }
}

t.render(() => boot());
