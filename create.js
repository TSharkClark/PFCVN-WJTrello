/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

const JETS = ["Waterjet 1", "Waterjet 2", "Waterjet 3"];

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function round3(v){ return Math.round(n(v) * 1000) / 1000; }

function uid(){
  return 'trk_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function qs(name){
  try{
    return new URL(window.location.href).searchParams.get(name);
  }catch{
    return null;
  }
}

async function loadAll(){
  return await t.get('card','shared',STORAGE_KEY,{});
}
async function saveAll(all){
  await t.set('card','shared',STORAGE_KEY,all);
}

function setWarn(msg){
  const w = document.getElementById('warn');
  if (!msg){
    w.style.display = 'none';
    w.textContent = '';
    return;
  }
  w.style.display = 'block';
  w.textContent = msg;
}

/**
 * Robust checklist load:
 * - Try t.card('checklists') first (best)
 * - Then try t.card('all') (fallback)
 * NOTE: Trello sometimes doesn't hydrate checkItems, so we tolerate empty.
 */
async function fetchChecklistItemsFlat(){
  const results = [];
  const seen = new Set();

  const candidates = [];
  try { candidates.push(await t.card('checklists')); } catch {}
  try { candidates.push(await t.card('all')); } catch {}

  for (const card of candidates){
    const lists = card?.checklists || [];
    for (const cl of lists){
      const clName = cl?.name || 'Checklist';
      const itemsRaw = cl?.checkItems || cl?.items || cl?.checkItemStates || [];
      for (const it of itemsRaw){
        const id = it?.id || it?.idCheckItem;
        const name = it?.name;
        if (!id || !name) continue;

        const key = `${id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({ id, name, checklistName: clName });
      }
    }
  }

  // Sort: checklist name then item name
  results.sort((a,b) => {
    const c = a.checklistName.localeCompare(b.checklistName);
    if (c !== 0) return c;
    return a.name.localeCompare(b.name);
  });

  return results;
}

function upgradeTrackerSchema(tr){
  if (!tr) return tr;

  const jets = { ...(tr.jets || {}) };
  for (const [k,v] of Object.entries(jets)){
    if (v && typeof v === 'object'){
      if (v.target == null && v.max != null) v.target = v.max;
      if (v.current == null) v.current = 0;
      delete v.max;
    }
  }

  return {
    ...tr,
    totalTarget: tr.totalTarget ?? tr.totalMax ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets
  };
}

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
      renderJetTargets();          // rebuild target inputs
      if (isAutoSplitOn()) applyAutoSplit();
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

function renderJetTargets(existingJets = null){
  const box = document.getElementById('jetsBox');
  box.innerHTML = '';

  const jets = selectedJets();
  if (!jets.length){
    const div = document.createElement('div');
    div.style.fontWeight = '900';
    div.style.color = '#666';
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

    // populate from existing if editing
    if (existingJets?.[jet]?.target != null) {
      input.value = existingJets[jet].target;
    }

    // if auto-split is on, inputs are still editable (override allowed),
    // but we won't forcibly re-split unless user hits Apply or changes total/jets.
    line.appendChild(left);
    line.appendChild(input);
    box.appendChild(line);
  }
}

function applyAutoSplit(){
  const jets = selectedJets();
  if (!jets.length){
    setWarn('Select at least one jet first.');
    return;
  }
  setWarn('');

  const total = round3(document.getElementById('totalTarget').value);
  if (!Number.isFinite(total) || total <= 0){
    setWarn('Enter a Total target above 0 for auto-split.');
    return;
  }

  const perJet = round3(total / jets.length);

  for (const inp of document.querySelectorAll('.jetTarget')){
    inp.value = perJet;
  }
}

function fillManualTargets(){
  const jets = selectedJets();
  if (!jets.length){
    setWarn('Select at least one jet first.');
    return;
  }
  setWarn('');

  // reasonable default: total / jets (if total exists) else 0
  const total = round3(document.getElementById('totalTarget').value);
  const perJet = (Number.isFinite(total) && total > 0) ? round3(total / jets.length) : 0;

  for (const inp of document.querySelectorAll('.jetTarget')){
    if (String(inp.value).trim() === '') inp.value = perJet;
  }
}

function readJetsFromUI(existingJets){
  const jets = {};
  for (const jet of selectedJets()){
    const inp = document.querySelector(`.jetTarget[data-jet="${jet}"]`);
    const target = round3(inp?.value);
    const prev = existingJets?.[jet];

    jets[jet] = {
      current: prev ? round3(prev.current) : 0,
      target: target
    };
  }
  return jets;
}

async function boot(){
  const mode = qs('mode'); // 'edit' or null
  const editId = qs('id');

  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const saveBtn = document.getElementById('saveBtn');

  const all = await loadAll();
  let editing = null;

  // checklist dropdown (no search)
  const checklistSelect = document.getElementById('checklist');
  checklistSelect.innerHTML = '<option value="">— Not linked —</option>';

  const items = await fetchChecklistItemsFlat();
  if (items.length){
    // create optgroups by checklistName
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
  } else {
    // still usable (optional link)
    // but warn gently so you know why it's empty
    // (Trello sometimes doesn't hydrate checkItems in Power-Ups)
    setWarn('Checklist items didn’t load in this popup. Tracker can still be created. If this persists, we can add an authenticated Trello API fallback.');
  }

  // EDIT MODE?
  if (mode === 'edit' && editId && all[editId]){
    editing = upgradeTrackerSchema(all[editId]);

    title.textContent = 'Edit Run Tracker';
    subtitle.textContent = 'Rename / relink / total & per-jet targets / jets.';
    saveBtn.textContent = 'Save changes';

    document.getElementById('name').value = editing.name || '';
    document.getElementById('totalTarget').value = editing.totalTarget ?? 0;
    document.getElementById('autoSplit').value = editing.autoSplit ? 'on' : 'off';

    // selected jets from existing
    const existingJets = editing.jets || {};
    const selected = Object.keys(existingJets).length ? Object.keys(existingJets) : [...JETS];

    buildJetToggles(selected);
    renderJetTargets(existingJets);

    if (editing.checklistItemId){
      checklistSelect.value = editing.checklistItemId;
    }
  } else {
    // CREATE MODE defaults
    title.textContent = 'Create Run Tracker';
    subtitle.textContent = 'Pick jets, set total target, optionally link a checklist item.';
    saveBtn.textContent = 'Create tracker';

    buildJetToggles([...JETS]);
    renderJetTargets(null);

    if (isAutoSplitOn()) applyAutoSplit();
  }

  // button handlers
  document.getElementById('applyAuto').addEventListener('click', () => {
    applyAutoSplit();
  });

  document.getElementById('fillDefaults').addEventListener('click', () => {
    fillManualTargets();
  });

  document.getElementById('autoSplit').addEventListener('change', () => {
    if (isAutoSplitOn()) applyAutoSplit();
  });

  document.getElementById('totalTarget').addEventListener('change', () => {
    if (isAutoSplitOn()) applyAutoSplit();
  });

  saveBtn.addEventListener('click', async () => {
    const nameRaw = document.getElementById('name').value.trim();
    const name = nameRaw ? nameRaw : null;

    const checklistItemId = checklistSelect.value || null;

    const totalTarget = round3(document.getElementById('totalTarget').value);
    const autoSplit = isAutoSplitOn();

    const jetsSelected = selectedJets();
    if (!jetsSelected.length){
      setWarn('Select at least one jet.');
      return;
    }

    const jets = readJetsFromUI(editing?.jets || null);

    // basic validation: targets should be numbers (can be 0, but warn)
    for (const [jet, data] of Object.entries(jets)){
      if (!Number.isFinite(n(data.target))){
        setWarn(`Target for ${jet} is invalid.`);
        return;
      }
    }

    const trackerPayload = upgradeTrackerSchema({
      ...(editing || {}),
      name,
      checklistItemId,
      totalTarget,
      autoSplit,
      collapsed: editing?.collapsed ?? false,
      jets
    });

    if (editing){
      all[editId] = trackerPayload;
      await saveAll(all);
      return t.closePopup();
    }

    const id = uid();
    all[id] = trackerPayload;
    await saveAll(all);
    return t.closePopup();
  });

  t.sizeTo(document.body);
}

t.render(() => { boot(); });
