/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';
const JETS = ["Waterjet 1", "Waterjet 2", "Waterjet 3"];

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function round3(v){ return Math.round(n(v) * 1000) / 1000; }
function uid(){ return 'trk_' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
function qs(name){ try{ return new URL(window.location.href).searchParams.get(name); } catch{ return null; } }

async function loadAll(){ return await t.get('card','shared',STORAGE_KEY,{}); }
async function saveAll(all){ await t.set('card','shared',STORAGE_KEY,all); }

function upgradeTrackerSchema(tr){
  if (!tr) return tr;
  const jets = { ...(tr.jets || {}) };
  for (const [k,v] of Object.entries(jets)){
    if (!v || typeof v !== 'object') continue;
    if (v.target == null && v.max != null) v.target = v.max;
    if (v.current == null) v.current = 0;
    delete v.max;
  }
  return {
    ...tr,
    totalTarget: tr.totalTarget ?? tr.totalMax ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets,
    checklistItemName: tr.checklistItemName ?? null
  };
}

function setWarn(msg){
  const w = document.getElementById('warn');
  if (!w) return;
  if (!msg){ w.style.display='none'; w.textContent=''; return; }
  w.style.display='block';
  w.textContent = msg;
}

// ✅ Reliable checklist fetch via REST when authorized
async function fetchChecklistItemsFlat(){
  // 1) REST (best)
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

  // 2) fallback (flaky)
  try{
    const results = [];
    const seen = new Set();
    const card = await t.card('checklists');
    const lists = card?.checklists || [];
    for (const cl of lists){
      const clName = cl?.name || 'Checklist';
      const items = cl?.checkItems || cl?.items || cl?.checkItemStates || [];
      for (const it of items){
        const id = it?.id || it?.idCheckItem;
        const name = it?.name;
        if (!id || !name) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({ id, name, checklistName: clName });
      }
    }
    results.sort((a,b) => a.checklistName.localeCompare(b.checklistName) || a.name.localeCompare(b.name));
    return results;
  }catch{
    return [];
  }
}

// ✅ Jet auto-select from your “Machine(s)” field
async function guessJetsFromMachineField(){
  try{
    const card = await t.card('customFieldItems', 'customFields');
    const items = card?.customFieldItems || [];
    const fields = card?.customFields || [];
    if (!items.length || !fields.length) return null;

    const fieldById = new Map(fields.map(f => [f.id, f]));
    const selected = new Set();

    const addByText = (txt) => {
      const t = (txt || '').toLowerCase();
      if (t.includes('#1') || t.includes('1')) selected.add("Waterjet 1");
      if (t.includes('#2') || t.includes('2')) selected.add("Waterjet 2");
      if (t.includes('#3') || t.includes('3')) selected.add("Waterjet 3");
    };

    for (const it of items){
      const def = fieldById.get(it.idCustomField);
      const fieldName = (def?.name || '').trim().toLowerCase();
      if (fieldName !== 'machine(s)') continue;

      // Common Trello shapes:
      // - list field: it.idValue (single)
      // - some setups return value.text (string)
      // - some tools emulate multi-select as comma-separated in value.text
      if (it.idValue){
        const opt = (def?.options || []).find(o => o.id === it.idValue);
        addByText(opt?.value?.text || '');
      }
      if (it.value?.text){
        // allow comma separated: "Waterjet #1, Waterjet #3"
        const parts = String(it.value.text).split(',').map(s => s.trim());
        parts.forEach(addByText);
      }
    }

    if (selected.size) return Array.from(selected);
    return null;
  }catch{
    return null;
  }
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
      renderJetTargets();
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

function applyAutoSplit(){
  const jets = selectedJets();
  if (!jets.length){ setWarn('Select at least one jet first.'); return; }

  const total = round3(document.getElementById('totalTarget').value);
  if (!Number.isFinite(total) || total <= 0){ setWarn('Enter a Total target above 0 for auto-split.'); return; }

  setWarn('');
  const perJet = round3(total / jets.length);
  for (const inp of document.querySelectorAll('.jetTarget')) inp.value = perJet;
}

function readJetsFromUI(existingJets){
  const jets = {};
  for (const jet of selectedJets()){
    const inp = document.querySelector(`.jetTarget[data-jet="${jet}"]`);
    const target = round3(inp?.value);
    const prev = existingJets?.[jet];
    jets[jet] = { current: prev ? round3(prev.current) : 0, target };
  }
  return jets;
}

async function boot(){
  const mode = qs('mode');
  const editId = qs('id');

  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const saveBtn = document.getElementById('saveBtn');

  const all = await loadAll();
  let editing = null;

  // checklist dropdown
  const checklistSelect = document.getElementById('checklist');
  checklistSelect.innerHTML = '<option value="">— Not linked —</option>';

  const items = await fetchChecklistItemsFlat();
  if (!items.length){
    // This is the symptom you described; authorization will usually fix it.
    setWarn('Checklist items not loaded. Use Trello “Authorize” for stable checklist linking.');
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

  // Edit mode
  if (mode === 'edit' && editId && all[editId]){
    editing = upgradeTrackerSchema(all[editId]);

    title.textContent = 'Edit Run Tracker';
    subtitle.textContent = 'Rename, relink checklist item, adjust total + per-jet targets.';
    saveBtn.textContent = 'Save changes';

    document.getElementById('name').value = editing.name || '';
    document.getElementById('totalTarget').value = editing.totalTarget ?? 0;
    document.getElementById('autoSplit').value = editing.autoSplit ? 'on' : 'off';

    const existingJets = editing.jets || {};
    const selected = Object.keys(existingJets).length ? Object.keys(existingJets) : [...JETS];
    buildJetToggles(selected);
    renderJetTargets(existingJets);

    if (editing.checklistItemId) checklistSelect.value = editing.checklistItemId;
  } else {
    // Create mode defaults: AUTO pick jets from Machine(s)
    const guessed = await guessJetsFromMachineField();
    const initialJets = (guessed && guessed.length) ? guessed : [...JETS];
    buildJetToggles(initialJets);
    renderJetTargets(null);
    if (isAutoSplitOn()) applyAutoSplit();
  }

  document.getElementById('applyAuto').addEventListener('click', () => applyAutoSplit());

  saveBtn.addEventListener('click', async () => {
    const nameRaw = document.getElementById('name').value.trim();
    const name = nameRaw ? nameRaw : null;

    const checklistItemId = checklistSelect.value || null;
    const checklistItemName =
      checklistItemId ? (items.find(x => x.id === checklistItemId)?.name || null) : null;

    const totalTarget = round3(document.getElementById('totalTarget').value);
    const autoSplit = isAutoSplitOn();

    const jetsSelected = selectedJets();
    if (!jetsSelected.length){ setWarn('Select at least one jet.'); return; }

    const jets = readJetsFromUI(editing?.jets || null);

    const trackerPayload = upgradeTrackerSchema({
      ...(editing || {}),
      name,
      checklistItemId,
      checklistItemName,
      totalTarget,
      autoSplit,
      collapsed: editing?.collapsed ?? false,
      jets
    });

    if (editing){
      all[editId] = trackerPayload;
      await saveAll(all);
      return t.closeModal();
    }

    const id = uid();
    all[id] = trackerPayload;
    await saveAll(all);
    return t.closeModal();
  });

  t.sizeTo(document.body);
}

t.render(() => boot());
