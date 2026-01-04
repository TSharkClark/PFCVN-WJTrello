/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

function n(v){ const x = parseFloat(v); return Number.isFinite(x) ? x : 0; }
function round3(v){
  const x = parseFloat(v);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x*1000)/1000;
}
function uid(){ return 'tr_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36); }
function uidBd(){ return 'bd_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36); }

async function loadAll(){ return (await t.get('card','shared',STORAGE_KEY)) || {}; }
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
    jets: b.jets ?? {}
  })) : [];

  const jets = tr.jets ?? {};
  const out = {
    id: tr.id || uid(),
    name: tr.name ?? null,
    checklistItemId: tr.checklistItemId ?? null,
    checklistItemName: tr.checklistItemName ?? null,
    totalTarget: tr.totalTarget ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets,
    breakdowns
  };
  return out;
}

function getQS(){
  const q = {};
  const s = new URLSearchParams(window.location.search);
  for (const [k,v] of s.entries()) q[k]=v;
  return q;
}

async function isAuthorized(){
  try{ return await t.getRestApi().isAuthorized(); } catch{ return false; }
}
async function authorize(){
  return t.authorize({
    scope: { read: true, write: false },
    expiration: "never",
    name: "Waterjet Run Tracker"
  });
}

async function fetchChecklistItemsFlat(){
  try{
    const rest = t.getRestApi();
    const ok = await rest.isAuthorized();
    if (!ok) return [];

    const ctx = t.getContext();
    const cardId = ctx.card;

    const token = await rest.getToken();
    const key = rest._key;

    const lists = await fetch(`https://api.trello.com/1/cards/${cardId}/checklists?key=${key}&token=${token}`).then(r=>r.json());
    const flat = [];
    for (const cl of (lists || [])){
      for (const it of (cl.checkItems || [])){
        flat.push({ id: it.id, name: it.name || '(unnamed)' });
      }
    }
    return flat;
  }catch{
    return [];
  }
}

/* ---------- Machines auto-select ---------- */
async function readMachinesFieldJets(){
  try{
    const fields = await t.get('card','shared','customFieldItems');
    // Not used; your implementation likely already sets customFieldItems elsewhere.
    // We will fall back to "Waterjet 1/2/3" all if not available.
    return null;
  }catch{
    return null;
  }
}

/* ---------- Jets UI ---------- */
const ALL_JETS = ['Waterjet 1','Waterjet 2','Waterjet 3'];

let defaultJets = new Set(ALL_JETS);

function renderDefaultJetChips(){
  const wrap = document.getElementById('jetToggles');
  wrap.innerHTML = '';
  for (const jet of ALL_JETS){
    const on = defaultJets.has(jet);
    const chip = document.createElement('div');
    chip.className = 'chip' + (on ? ' on' : '');
    chip.textContent = jet;
    chip.onclick = () => {
      if (defaultJets.has(jet)) defaultJets.delete(jet);
      else defaultJets.add(jet);
      renderDefaultJetChips();
      renderSimpleTargets();
      renderBreakdowns();
    };
    wrap.appendChild(chip);
  }
}

function selectedDefaultJets(){
  const arr = Array.from(defaultJets);
  if (!arr.length) return ['Waterjet 1']; // safety: never empty
  return arr;
}

function renderSimpleTargets(existingJets = null){
  const box = document.getElementById('jetsBox');
  box.innerHTML = '';
  const jets = selectedDefaultJets();

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

function applyAutoSplitToSimpleTargets(){
  const jets = selectedDefaultJets();
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
  for (const jet of selectedDefaultJets()){
    const inp = document.querySelector(`#jetsBox .jetTarget[data-jet="${jet}"]`);
    const target = round3(inp?.value);
    const prev = existingJets?.[jet];
    jets[jet] = { current: prev ? round3(prev.current) : 0, target };
  }
  return jets;
}

/* ---------- BREAKDOWNS MODE (each has its own jets) ---------- */
let breakdowns = [];

function ensureModeVisibility(){
  const has = breakdowns.length > 0;
  document.getElementById('simpleTargetsWrap').style.display = has ? 'none' : 'block';
  document.getElementById('breakdownsWrap').style.display = has ? 'block' : 'none';
  // When breakdowns exist, hide the default-jets section to reduce confusion/bloat.
  const dj = document.getElementById('defaultJetsCard');
  if (dj) dj.style.display = has ? 'none' : 'block';
}

function addBreakdown(prefill = null){
  const defaults = selectedDefaultJets();
  const initialJets = (prefill?.jets && Object.keys(prefill.jets).length)
    ? prefill.jets
    : Object.fromEntries(defaults.map(j => [j, { current: 0, target: 0 }]));

  breakdowns.push({
    id: prefill?.id || uidBd(),
    name: prefill?.name || '',
    totalTarget: prefill?.totalTarget ?? 0,
    jets: initialJets
  });
}

function removeBreakdown(id){
  breakdowns = breakdowns.filter(b => b.id !== id);
}

function toggleBreakdownJet(bd, jetName){
  bd.jets = bd.jets || {};
  if (bd.jets[jetName]) delete bd.jets[jetName];
  else bd.jets[jetName] = { current: 0, target: 0 };

  if (!Object.keys(bd.jets).length){
    bd.jets[selectedDefaultJets()[0]] = { current: 0, target: 0 };
  }
}

function renderBreakdowns(){
  const box = document.getElementById('breakdownsBox');
  box.innerHTML = '';

  for (const bd of breakdowns){
    const wrap = document.createElement('div');
    wrap.className = 'breakdownCard';

    const head = document.createElement('div');
    head.className = 'breakdownHead';

    const left = document.createElement('div');
    left.style.flex = '1';

    const nameLabel = document.createElement('div');
    nameLabel.style.fontWeight = '950';
    nameLabel.style.marginBottom = '6px';
    nameLabel.textContent = 'Breakdown';

    left.appendChild(nameLabel);

    const row1 = document.createElement('div');
    row1.className = 'row';
    row1.style.marginTop = '0';

    const nameWrap = document.createElement('div');
    const name = document.createElement('input');
    name.type = 'text';
    name.value = bd.name || '';
    name.placeholder = 'Name (ex: Blue, Red, White, Rev 2, Lane A, etc.)';
    name.onchange = (e) => { bd.name = e.target.value; };
    nameWrap.appendChild(name);

    const totalWrap = document.createElement('div');
    const total = document.createElement('input');
    total.type = 'number';
    total.step = 'any';
    total.inputMode = 'decimal';
    total.value = bd.totalTarget || '';
    total.placeholder = 'Breakdown total target (optional)';
    total.onchange = (e) => { bd.totalTarget = (e.target.value === '' ? 0 : round3(e.target.value)); };
    totalWrap.appendChild(total);

    row1.appendChild(nameWrap);
    row1.appendChild(totalWrap);

    left.appendChild(row1);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btnDanger';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => { removeBreakdown(bd.id); ensureModeVisibility(); renderBreakdowns(); };

    head.appendChild(left);
    head.appendChild(removeBtn);

    wrap.appendChild(head);

    const jetsLabel = document.createElement('div');
    jetsLabel.className = 'sectionTitle';
    jetsLabel.textContent = 'Jets for this breakdown';
    wrap.appendChild(jetsLabel);

    const chips = document.createElement('div');
    chips.className = 'chips';

    for (const jet of ALL_JETS){
      const on = !!bd.jets?.[jet];
      const chip = document.createElement('div');
      chip.className = 'chip' + (on ? ' on' : '');
      chip.textContent = jet;
      chip.onclick = () => { toggleBreakdownJet(bd, jet); renderBreakdowns(); };
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);

    const panel = document.createElement('div');
    panel.className = 'panel';

    for (const [jetName, jetObj] of Object.entries(bd.jets || {})){
      const line = document.createElement('div');
      line.className = 'jetLine';

      const jn = document.createElement('div');
      jn.className = 'jetName';
      jn.textContent = jetName;

      const inp = document.createElement('input');
      inp.className = 'jetTarget';
      inp.type = 'number';
      inp.step = 'any';
      inp.inputMode = 'decimal';
      inp.value = jetObj.target ?? 0;
      inp.onchange = (e) => { jetObj.target = round3(e.target.value); };

      line.appendChild(jn);
      line.appendChild(inp);
      panel.appendChild(line);
    }

    wrap.appendChild(panel);
    box.appendChild(wrap);
  }

  ensureModeVisibility();
}

/* ---------- Existing current values for breakdown jets ---------- */
function findExistingBreakdownJetCurrent(editing, bdId, jetName){
  if (!editing?.breakdowns?.length) return null;
  const b = editing.breakdowns.find(x => x.id === bdId);
  if (!b) return null;
  const j = b.jets?.[jetName];
  if (!j) return null;
  return n(j.current);
}

/* ---------- Main init ---------- */
(async function init(){
  const qs = getQS();
  const mode = qs.mode || 'create';
  const editingId = qs.id || null;

  const title = document.getElementById('title');
  const saveBtn = document.getElementById('saveBtn');

  let editing = null;
  if (mode === 'edit' && editingId){
    const all = await loadAll();
    editing = upgradeTrackerSchema(all[editingId]);
  }

  if (editing){
    title.textContent = 'Edit Run Tracker';
    saveBtn.textContent = 'Save changes';
    document.getElementById('name').value = editing.name || '';
    document.getElementById('totalTarget').value = editing.totalTarget || '';
  }else{
    title.textContent = 'Create Run Tracker';
    saveBtn.textContent = 'Create tracker';
  }

  // Checklist items
  const checklistSelect = document.getElementById('checklistSelect');
  const authBtn = document.getElementById('authBtn');

  const ok = await isAuthorized();
  authBtn.style.display = ok ? 'none' : 'inline-block';
  authBtn.onclick = async () => {
    await authorize();
    window.location.reload();
  };

  let items = [];
  if (await isAuthorized()){
    items = await fetchChecklistItemsFlat();
    for (const it of items){
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.name;
      checklistSelect.appendChild(opt);
    }
  }

  if (editing?.checklistItemId){
    checklistSelect.value = editing.checklistItemId;
  }

  // Default jets (auto-select can be handled by your existing custom-field logic)
  defaultJets = new Set(Object.keys(editing?.jets || {}).length ? Object.keys(editing.jets) : ALL_JETS);
  renderDefaultJetChips();
  renderSimpleTargets(editing?.jets || null);

  // Breakdown init
  breakdowns = [];
  if (editing?.breakdowns?.length){
    for (const b of editing.breakdowns){
      addBreakdown(b);
    }
  }
  renderBreakdowns();

  document.getElementById('applyAuto').onclick = () => applyAutoSplitToSimpleTargets();

  document.getElementById('addBreakdownBtn').onclick = () => {
    addBreakdown(null);
    ensureModeVisibility();
    renderBreakdowns();
  };

  document.getElementById('clearBreakdownsBtn').onclick = () => {
    breakdowns = [];
    ensureModeVisibility();
    renderBreakdowns();
  };

  function validate(){
    setWarn('');
    // In breakdown mode, ensure each breakdown has at least one jet (already enforced)
    return true;
  }

  saveBtn.onclick = async () => {
    if (!validate()) return;

    const nameRaw = document.getElementById('name').value.trim();
    const name = nameRaw ? nameRaw : null;

    const checklistItemId = checklistSelect.value || null;
    const checklistItemName =
      checklistItemId ? (items.find(x => x.id === checklistItemId)?.name || editing?.checklistItemName || null) : null;

    const totalTargetRaw = document.getElementById('totalTarget').value;
    const totalTarget = totalTargetRaw === '' ? 0 : round3(totalTargetRaw);
    const autoSplit = editing ? (editing.autoSplit ?? false) : false;

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
          name: b.name || '',
          totalTarget: round3(b.totalTarget),
          jets: outJets
        };
      });
    }else{
      jets = readSimpleJets(editing?.jets || null);
    }

    const tracker = {
      id: (editing?.id || uid()),
      name,
      checklistItemId,
      checklistItemName,
      totalTarget,
      autoSplit,
      collapsed: editing?.collapsed ?? false,
      jets,
      breakdowns: finalBreakdowns
    };

    const all = await loadAll();
    if (editingId){
      all[editingId] = tracker;
    }else{
      all[tracker.id] = tracker;
    }
    await saveAll(all);

    t.closeModal();
  };

  t.sizeTo(document.body);
})();
