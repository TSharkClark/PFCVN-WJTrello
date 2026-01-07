/* global TrelloPowerUp */
// Configure REST client with your Power-Up API key so authorization works reliably.
const t = TrelloPowerUp.iframe({
  appKey: '4d801d3f55e50db70afa582d388598ea',
  appName: 'Waterjet Run Tracker',
  appAuthor: 'tsharkclark'
});

const STORAGE_KEY = 'trackers';
const JETS = ["Waterjet 1", "Waterjet 2", "Waterjet 3"];
const TARGET_STEP = 0.1; // 0.1 resolution for auto-split targets

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function round3(v){ return Math.round(n(v) * 1000) / 1000; }
function stripFloat(v){ return Number(Number(v).toFixed(6)); }
function roundStep(v, step){
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return round3(v);
  return stripFloat(Math.round(n(v) / s) * s);
}
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

  const breakdowns = Array.isArray(tr.breakdowns) ? tr.breakdowns.map(b => ({
    id: b.id || uidBd(),
    name: b.name ?? '',
    totalTarget: b.totalTarget ?? 0,
    jets: b.jets || {}
  })) : [];

  return {
    ...tr,
    totalTarget: tr.totalTarget ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets: tr.jets || {},
    breakdowns,
    checklistItemName: tr.checklistItemName ?? null
  };
}

/* ---------- AUTH / CHECKLIST ---------- */
async function isAuthorized(){
  try{ return await t.getRestApi().isAuthorized(); } catch{ return false; }
}

async function authorize(){
  const opts = {
    scope: { read: true, write: false },
    expiration: "never",
    name: "Waterjet Run Tracker"
  };

  // Prefer REST client authorize
  try{
    const rest = t.getRestApi();
    if (rest?.authorize) return await rest.authorize(opts);
  }catch{ /* ignore */ }

  // Fallback
  return await t.authorize(opts);
}

async function fetchChecklistItemsFlat(){
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

  // Fallback: may be limited without authorization
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

/* ---------- JET AUTO SELECT FROM Machine(s) ---------- */
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
      if (s.includes('#1') || s.includes('waterjet 1')) selected.add("Waterjet 1");
      if (s.includes('#2') || s.includes('waterjet 2')) selected.add("Waterjet 2");
      if (s.includes('#3') || s.includes('waterjet 3')) selected.add("Waterjet 3");
    };

    for (const it of items){
      const def = fieldById.get(it.idCustomField);
      const fieldName = (def?.name || '').trim().toLowerCase();
      if (fieldName !== 'machine(s)') continue;

      if (it.idValue){
        const opt = (def?.options || []).find(o => o.id === it.idValue);
        addFromChunk(opt?.value?.text || '');
      }
      if (it.value?.text){
        const parts = String(it.value.text).split(/[,\n]/g).map(x => x.trim()).filter(Boolean);
        for (const p of parts) addFromChunk(p);
      }
    }

    if (selected.size) return Array.from(selected);
    return null;
  }catch{
    return null;
  }
}

/* ---------- SPLIT LOGIC (0.1 step, distributes remainder) ---------- */
function splitTargets(totalRaw, jetCount){
  const count = Math.max(1, Number(jetCount) || 1);
  const total = roundStep(n(totalRaw), TARGET_STEP); // totals rounded to same step
  const step = TARGET_STEP;

  const base = stripFloat(Math.floor((total / count) / step) * step);
  const remainder = stripFloat(total - base * count);

  const addCount = Math.max(0, Math.round(remainder / step));
  const targets = new Array(count).fill(base);
  for (let i = 0; i < addCount && i < targets.length; i++){
    targets[i] = stripFloat(targets[i] + step);
  }
  return { total, targets };
}

/* ---------- UI HELPERS ---------- */
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
      renderSimpleJetTargets();
      t.sizeTo(document.body);
    });

    wrap.appendChild(btn);
  }
}

function selectedDefaultJets(){
  return Array.from(document.querySelectorAll('#jetToggles .chipBtn'))
    .filter(b => b.dataset.on === 'true')
    .map(b => b.dataset.jet);
}

/* ---------- SIMPLE MODE TARGETS ---------- */
function renderSimpleJetTargets(existingJets = null){
  const box = document.getElementById('jetsBox');
  box.innerHTML = '';

  const jets = selectedDefaultJets();
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
  const jets = selectedDefaultJets();
  if (!jets.length){ setWarn('Select at least one jet first.'); return; }

  const totalRaw = document.getElementById('totalTarget').value;
  const totalVal = n(totalRaw);
  if (!Number.isFinite(totalVal) || totalVal <= 0){
    setWarn('Enter a Totals value above 0 to auto-split.');
    return;
  }

  setWarn('');
  const { total, targets } = splitTargets(totalVal, jets.length);

  // Do NOT fight the user while typing; only set values on button click
  document.getElementById('totalTarget').value = total;

  const inputs = Array.from(document.querySelectorAll('#jetsBox .jetTarget'));
  for (let i = 0; i < inputs.length; i++){
    inputs[i].value = targets[i] ?? targets[targets.length - 1] ?? 0;
  }
}

function readSimpleJets(existingJets){
  const jets = {};
  for (const jet of selectedDefaultJets()){
    const inp = document.querySelector(`#jetsBox .jetTarget[data-jet="${jet}"]`);
    const target = round3(inp?.value);
    const prev = existingJets?.[jet];
    jets[jet] = { current: prev ? round3(prev.current) : 0, target };
  }
  return jets;
}

/* ---------- BREAKDOWNS MODE ---------- */
let breakdowns = [];

function ensureModeVisibility(){
  const has = breakdowns.length > 0;

  document.getElementById('breakdownsWrap').style.display = has ? 'block' : 'none';
  document.getElementById('defaultJetsSection').style.display = has ? 'none' : 'block';
}

function addBreakdown(prefill = null){
  const defaults = selectedDefaultJets();
  const seedJets = (prefill?.jets && Object.keys(prefill.jets).length)
    ? prefill.jets
    : Object.fromEntries((defaults.length ? defaults : ["Waterjet 1"]).map(j => [j, { current: 0, target: 0 }]));

  breakdowns.push({
    id: prefill?.id || uidBd(),
    name: prefill?.name || '',
    totalTarget: prefill?.totalTarget ?? 0,
    jets: seedJets
  });
}

function removeBreakdown(id){
  breakdowns = breakdowns.filter(b => b.id !== id);
}

function breakdownSelectedJets(bd){
  return Object.keys(bd.jets || {});
}

function toggleBreakdownJet(bd, jetName){
  bd.jets = bd.jets || {};
  if (bd.jets[jetName]) delete bd.jets[jetName];
  else bd.jets[jetName] = { current: 0, target: 0 };

  // must always have at least 1 jet
  if (!Object.keys(bd.jets).length){
    bd.jets[jetName] = { current: 0, target: 0 };
  }
}

function applyAutoSplitBreakdowns(){
  if (!breakdowns.length){ setWarn('Add at least one Advanced Count first.'); return; }
  setWarn('');

  for (const bd of breakdowns){
    const jets = breakdownSelectedJets(bd);
    const totalVal = n(bd.totalTarget);
    if (!jets.length || !Number.isFinite(totalVal) || totalVal <= 0) continue;

    const { total, targets } = splitTargets(totalVal, jets.length);
    bd.totalTarget = total;

    // Apply in stable order
    const ordered = jets.slice().sort((a,b) => JETS.indexOf(a) - JETS.indexOf(b));
    for (let i = 0; i < ordered.length; i++){
      bd.jets[ordered[i]].target = targets[i] ?? targets[targets.length - 1] ?? 0;
    }
  }

  renderBreakdowns();
  t.sizeTo(document.body);
}

function renderBreakdowns(){
  const box = document.getElementById('breakdownsBox');
  box.innerHTML = '';

  for (const bd of breakdowns){
    const card = document.createElement('div');
    card.className = 'bdCard';

    const headerRow = document.createElement('div');
    headerRow.className = 'bdHeaderRow';

    const left = document.createElement('div');
    left.className = 'bdHeader';
    left.textContent = 'Advanced Count';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btnSmall btnDanger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      removeBreakdown(bd.id);
      renderBreakdowns();
      ensureModeVisibility();
      t.sizeTo(document.body);
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
    nameInput.placeholder = '';
    nameInput.addEventListener('input', e => { bd.name = e.target.value; });
    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(nameInput);

    const tgtWrap = document.createElement('div');
    const tgtLabel = document.createElement('label');
    tgtLabel.textContent = 'Total';
    const tgtInput = document.createElement('input');
    tgtInput.type = 'number';
    tgtInput.step = 'any';
    tgtInput.inputMode = 'decimal';
    tgtInput.value = (bd.totalTarget ?? '');
    tgtInput.addEventListener('input', e => {
      // IMPORTANT: do not autosplit or rerender while typing (prevents lockout)
      bd.totalTarget = e.target.value === '' ? '' : round3(e.target.value);
    });
    tgtWrap.appendChild(tgtLabel);
    tgtWrap.appendChild(tgtInput);

    top.appendChild(nameWrap);
    top.appendChild(tgtWrap);

    const jetsTitle = document.createElement('div');
    jetsTitle.className = 'bdJetsTitle';
    jetsTitle.textContent = 'Jets for this Advanced Count';

    const chips = document.createElement('div');
    chips.className = 'chips';

    for (const j of JETS){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chipBtn';
      btn.textContent = j;
      btn.dataset.on = bd.jets?.[j] ? 'true' : 'false';
      btn.addEventListener('click', () => {
        toggleBreakdownJet(bd, j);
        renderBreakdowns(); // safe on click (not while typing totals)
        ensureModeVisibility();
        t.sizeTo(document.body);
      });
      chips.appendChild(btn);
    }

    const panel = document.createElement('div');
    panel.className = 'panel';

    const selected = breakdownSelectedJets(bd).slice().sort((a,b) => JETS.indexOf(a) - JETS.indexOf(b));
    for (const j of selected){
      const line = document.createElement('div');
      line.className = 'jetLine';

      const nm = document.createElement('div');
      nm.className = 'jetName';
      nm.textContent = j;

      const inp = document.createElement('input');
      inp.className = 'jetTarget';
      inp.type = 'number';
      inp.step = 'any';
      inp.inputMode = 'decimal';
      inp.value = bd.jets[j]?.target ?? '';
      inp.addEventListener('input', e => { bd.jets[j].target = e.target.value === '' ? '' : round3(e.target.value); });

      line.appendChild(nm);
      line.appendChild(inp);
      panel.appendChild(line);
    }

    card.appendChild(headerRow);
    card.appendChild(top);
    card.appendChild(jetsTitle);
    card.appendChild(chips);
    card.appendChild(panel);

    box.appendChild(card);
  }
}

/* ---------- APPLY AUTO SPLIT ---------- */
function applyAutoSplit(){
  if (breakdowns.length) return applyAutoSplitBreakdowns();
  return applyAutoSplitSimple();
}

/* ---------- VALIDATION ---------- */
function validate(){
  if (breakdowns.length){
    for (const b of breakdowns){
      if (!String(b.name || '').trim()){
        setWarn('Each Advanced Count needs a name.');
        return false;
      }
      const jets = breakdownSelectedJets(b);
      if (!jets.length){
        setWarn(`Advanced Count "${b.name}" must include at least one jet.`);
        return false;
      }
    }
    setWarn('');
    return true;
  }

  const jets = selectedDefaultJets();
  if (!jets.length){ setWarn('Select at least one jet.'); return false; }
  setWarn('');
  return true;
}

/* ---------- BOOT ---------- */
let splitMode = 'manual'; // default manual (no autosplit while typing)

async function boot(){
  const mode = qs('mode');
  const editId = qs('id');

  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const saveBtn = document.getElementById('saveBtn');
  const authBtn = document.getElementById('authBtn');
  const manualBtn = document.getElementById('manualBtn');

  const setManualUi = () => {
    // purely UI indicator; manual is default and we do not autosplit on typing
    if (splitMode === 'manual'){
      manualBtn.classList.add('btnPrimary');
      manualBtn.textContent = 'Manual';
    } else {
      manualBtn.classList.remove('btnPrimary');
      manualBtn.textContent = 'Manual';
    }
  };

  // Auth button UI
  const setAuthBtnUi = ({ loading=false, error='' }={}) => {
    authBtn.disabled = !!loading;
    authBtn.textContent = loading ? 'Authorizing…' : 'Authorize';
    if (error) setWarn(error);
  };

  const authed = await isAuthorized();
  authBtn.style.display = authed ? 'none' : 'inline-block';
  authBtn.onclick = async () => {
    try{
      setWarn('');
      setAuthBtnUi({ loading:true });
      await authorize();
      const ok = await isAuthorized();
      if (!ok) throw new Error('Trello did not report authorization as complete.');
      await boot();
    }catch(err){
      setAuthBtnUi({
        loading:false,
        error: `Authorize failed or was blocked.\n\nAllow popups for Trello and try again.\n\nDetails: ${err?.message || String(err)}`
      });
    }finally{
      setAuthBtnUi({ loading:false });
    }
  };

  // Checklist dropdown
  const checklistSelect = document.getElementById('checklist');
  checklistSelect.innerHTML = '<option value="">— Not linked —</option>';

  const items = await fetchChecklistItemsFlat();
  if (!items.length && !authed){
    setWarn('Checklist items not loaded. Click “Authorize”.');
  }

  if (items.length){
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

  const all = await loadAll();
  let editing = null;

  // Default jets initial state (Machine(s))
  const guessed = await guessJetsFromMachineField();
  const defaultJets = (guessed && guessed.length) ? guessed : [...JETS];

  breakdowns = [];

  if (mode === 'edit' && editId && all[editId]){
    editing = upgradeTrackerSchema(all[editId]);

    title.textContent = 'Edit Run Tracker';
    subtitle.textContent = 'Targets, jets, checklist link, and Advanced Count.';
    saveBtn.textContent = 'Save changes';

    document.getElementById('name').value = editing.name || '';
    document.getElementById('totalTarget').value = (editing.totalTarget ? editing.totalTarget : '');

    const selected = Object.keys(editing.jets || {}).length ? Object.keys(editing.jets) : defaultJets;
    buildJetToggles(selected);

    if (editing.checklistItemId) checklistSelect.value = editing.checklistItemId;

    if (editing.breakdowns && editing.breakdowns.length){
      breakdowns = editing.breakdowns.map(b => ({
        id: b.id || uidBd(),
        name: b.name || '',
        totalTarget: b.totalTarget ?? '',
        jets: b.jets || {}
      }));
      renderBreakdowns();
    } else {
      renderSimpleJetTargets(editing.jets || {});
    }
  } else {
    buildJetToggles(defaultJets);
    renderSimpleJetTargets(null);
  }

  ensureModeVisibility();

  manualBtn.onclick = () => {
    splitMode = 'manual';
    setManualUi();
    setWarn('');
    t.sizeTo(document.body);
  };
  setManualUi();

  document.getElementById('applyAuto').onclick = () => { applyAutoSplit(); };
  document.getElementById('addBreakdownBtn').onclick = () => {
    addBreakdown();
    renderBreakdowns();
    ensureModeVisibility();
    t.sizeTo(document.body);
  };

  document.getElementById('clearBreakdownsBtn').onclick = () => {
    breakdowns = [];
    renderSimpleJetTargets(editing?.jets || null);
    ensureModeVisibility();
    t.sizeTo(document.body);
  };

  saveBtn.onclick = async () => {
    if (!validate()) return;

    const nameRaw = document.getElementById('name').value.trim();
    const name = nameRaw ? nameRaw : null;

    const checklistItemId = checklistSelect.value || null;
    const checklistItemName =
      checklistItemId ? (items.find(x => x.id === checklistItemId)?.name || editing?.checklistItemName || null) : null;

    const totalTargetRaw = document.getElementById('totalTarget').value;
    const totalTarget = totalTargetRaw === '' ? 0 : round3(totalTargetRaw);

    const autoSplit = editing ? !!editing.autoSplit : true;

    let jets = {};
    let finalBreakdowns = [];

    if (breakdowns.length){
      finalBreakdowns = breakdowns.map(b => {
        const outJets = {};
        for (const [jetName, jetObj] of Object.entries(b.jets || {})){
          const prevCurrent = findExistingBreakdownJetCurrent(editing, b.id, jetName) ?? 0;
          outJets[jetName] = { current: round3(prevCurrent), target: round3(jetObj.target) };
        }
        return {
          id: b.id || uidBd(),
          name: String(b.name || '').trim(),
          totalTarget: b.totalTarget === '' ? 0 : round3(b.totalTarget),
          jets: outJets
        };
      });
      jets = {};
    } else {
      jets = readSimpleJets(editing?.jets || null);
      finalBreakdowns = [];
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
  };

  t.sizeTo(document.body);
}

function findExistingBreakdownJetCurrent(editing, breakdownId, jetName){
  try{
    if (!editing?.breakdowns?.length) return null;
    const b = editing.breakdowns.find(x => x.id === breakdownId);
    if (!b) return null;
    const j = b.jets?.[jetName];
    if (!j) return null;
    return round3(j.current);
  }catch{
    return null;
  }
}

t.render(() => boot());
