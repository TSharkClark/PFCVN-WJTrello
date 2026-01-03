/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

const JET_NAMES = ["Waterjet 1", "Waterjet 2", "Waterjet 3"];

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function round3(v){ return Math.round(n(v) * 1000) / 1000; }

function uid(){
  return 'trk_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function qs(name){
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function loadAll(){
  return await t.get('card','shared',STORAGE_KEY,{});
}

async function saveAll(all){
  await t.set('card','shared',STORAGE_KEY,all);
}

/**
 * Try to get checklist items from multiple card shapes.
 * Returns: [{ groupName, items:[{id,name}]}]
 */
async function fetchChecklistGroups(){
  const groups = [];

  const candidates = [];
  try { candidates.push(await t.card('checklists')); } catch {}
  try { candidates.push(await t.card('all')); } catch {}

  // Merge results
  const seen = new Set();

  for (const card of candidates){
    const lists = card?.checklists || card?.checkList || [];
    for (const cl of (lists || [])){
      const groupName = cl?.name || "Checklist";
      const itemsRaw = cl?.checkItems || cl?.checkItemStates || cl?.items || [];
      const items = [];

      for (const it of (itemsRaw || [])){
        const id = it?.id || it?.idCheckItem;
        const name = it?.name;
        if (!id || !name) continue;

        const key = `${groupName}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({ id, name });
      }

      if (items.length) groups.push({ groupName, items });
    }
  }

  return groups;
}

function buildChecklistSelect(groups, selectedId, filterText){
  const select = document.getElementById('checklist');
  const ft = (filterText || '').trim().toLowerCase();

  select.innerHTML = '<option value="">— Not linked —</option>';

  for (const g of groups){
    const group = document.createElement('optgroup');
    group.label = g.groupName;

    const filteredItems = ft
      ? g.items.filter(i => i.name.toLowerCase().includes(ft))
      : g.items;

    for (const item of filteredItems){
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      if (selectedId && item.id === selectedId) opt.selected = true;
      group.appendChild(opt);
    }

    // only append group if it has children
    if (group.children.length) select.appendChild(group);
  }
}

function renderJetsUI(existingJets){
  const box = document.getElementById('jetsBox');
  box.innerHTML = '';

  for (const name of JET_NAMES){
    const row = document.createElement('div');
    row.className = 'jetPick';

    const left = document.createElement('div');
    left.className = 'jetLeft';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'jet';
    cb.value = name;

    const label = document.createElement('div');
    label.textContent = name;

    const target = document.createElement('input');
    target.type = 'number';
    target.step = 'any';
    target.className = 'jetTarget';
    target.placeholder = 'target';
    target.dataset.jet = name;

    // default checked + target
    if (existingJets && existingJets[name]){
      cb.checked = true;
      target.value = existingJets[name].target ?? '';
    } else {
      cb.checked = true;
      target.value = '';
    }

    left.appendChild(cb);
    left.appendChild(label);

    row.appendChild(left);
    row.appendChild(target);

    box.appendChild(row);
  }
}

function getSelectedJets(){
  return Array.from(document.querySelectorAll('.jet')).filter(x => x.checked).map(x => x.value);
}

function applyAutoSplitToUI(){
  const auto = document.getElementById('autoSplit').checked;
  const total = round3(document.getElementById('totalTarget').value);
  const defaultTarget = round3(document.getElementById('defaultJetTarget').value);
  const jets = getSelectedJets();
  const perJet = jets.length ? round3(total / jets.length) : 0;

  for (const input of document.querySelectorAll('.jetTarget')){
    const jet = input.dataset.jet;
    const checkbox = Array.from(document.querySelectorAll('.jet')).find(x => x.value === jet);
    const enabled = checkbox?.checked;

    input.disabled = !enabled ? true : false;

    if (!enabled) {
      input.value = '';
      continue;
    }

    if (auto){
      input.value = perJet || 0;
    } else {
      // manual mode: if empty, fill with default
      if (String(input.value).trim() === '') input.value = defaultTarget || 0;
    }
  }
}

function buildJetsFromUI(existingJets){
  const jets = {};
  for (const jetName of JET_NAMES){
    const checkbox = Array.from(document.querySelectorAll('.jet')).find(x => x.value === jetName);
    if (!checkbox?.checked) continue;

    const input = Array.from(document.querySelectorAll('.jetTarget')).find(x => x.dataset.jet === jetName);
    const target = round3(input?.value);

    const prev = existingJets?.[jetName];
    jets[jetName] = {
      current: prev ? round3(prev.current) : 0,
      target: target
    };
  }
  return jets;
}

/**
 * Backward compatibility:
 * Your old schema used jets[jet].max
 * Upgrade to jets[jet].target
 */
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

async function boot(){
  const mode = qs('mode'); // 'edit' or null
  const editId = qs('id');

  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const saveBtn = document.getElementById('saveBtn');

  const all = await loadAll();
  let editingTracker = null;

  // Load checklists once
  const groups = await fetchChecklistGroups();

  if (mode === 'edit' && editId && all[editId]){
    editingTracker = upgradeTrackerSchema(all[editId]);

    title.textContent = 'Edit Run Tracker';
    subtitle.textContent = 'Rename / relink checklist item / set total & per-jet targets / choose jets.';
    saveBtn.textContent = 'Save changes';

    document.getElementById('name').value = editingTracker.name || '';
    document.getElementById('totalTarget').value = editingTracker.totalTarget ?? 0;
    document.getElementById('autoSplit').checked = !!editingTracker.autoSplit;

    // set a reasonable defaultJetTarget
    const firstJet = editingTracker.jets ? Object.values(editingTracker.jets)[0] : null;
    document.getElementById('defaultJetTarget').value = firstJet?.target ?? 0;

    renderJetsUI(editingTracker.jets || {});
    buildChecklistSelect(groups, editingTracker.checklistItemId || '', '');
  } else {
    renderJetsUI(null);
    buildChecklistSelect(groups, '', '');
    applyAutoSplitToUI();
  }

  // filter checklist
  const filter = document.getElementById('checkFilter');
  filter.addEventListener('input', () => {
    const selectedId = document.getElementById('checklist').value || '';
    buildChecklistSelect(groups, selectedId, filter.value);
  });

  // auto split behavior
  document.getElementById('applyAuto').onclick = () => applyAutoSplitToUI();
  document.getElementById('autoSplit').addEventListener('change', applyAutoSplitToUI);
  document.getElementById('totalTarget').addEventListener('change', () => {
    if (document.getElementById('autoSplit').checked) applyAutoSplitToUI();
  });

  // when jet selection changes, re-apply split
  for (const cb of document.querySelectorAll('.jet')){
    cb.addEventListener('change', () => applyAutoSplitToUI());
  }

  saveBtn.onclick = async () => {
    const name = document.getElementById('name').value.trim() || null;
    const checklistItemId = document.getElementById('checklist').value || null;
    const totalTarget = round3(document.getElementById('totalTarget').value);
    const autoSplit = !!document.getElementById('autoSplit').checked;

    const selectedJets = getSelectedJets();
    if (!selectedJets.length){
      alert('Select at least one jet.');
      return;
    }

    if (!totalTarget || totalTarget < 0){
      // allow 0, but warn if empty/NaN
      // (still permit save so you can use per-jet targets only)
    }

    if (editingTracker){
      const updated = upgradeTrackerSchema({
        ...editingTracker,
        name,
        checklistItemId,
        totalTarget,
        autoSplit,
        jets: buildJetsFromUI(editingTracker.jets || {})
      });

      all[editId] = updated;
      await saveAll(all);
      return t.closePopup();
    }

    const id = uid();
    const created = upgradeTrackerSchema({
      name,
      checklistItemId,
      totalTarget,
      autoSplit,
      collapsed: false,
      jets: buildJetsFromUI(null)
    });

    all[id] = created;
    await saveAll(all);
    return t.closePopup();
  };

  t.sizeTo(document.body);
}

t.render(() => boot());
