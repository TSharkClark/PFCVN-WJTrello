/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }

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

async function populateChecklistItems(selectedId){
  const card = await t.card('checklists');
  const select = document.getElementById('checklist');

  select.innerHTML = '<option value="">— Not linked —</option>';

  for (const cl of (card.checklists || [])){
    const group = document.createElement('optgroup');
    group.label = cl.name;

    for (const item of (cl.checkItems || [])){
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      if (selectedId && item.id === selectedId) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

function setJetsCheckedFromTracker(tracker){
  const existing = new Set(Object.keys(tracker.jets || {}));
  for (const box of document.querySelectorAll('.jet')){
    box.checked = existing.has(box.value);
  }
}

function buildJetsFromUI(jetMax, existingJets = null){
  const jets = {};
  for (const box of document.querySelectorAll('.jet')){
    if (!box.checked) continue;

    const prev = existingJets?.[box.value];
    jets[box.value] = {
      current: prev ? n(prev.current) : 0,
      max: jetMax
    };
  }
  return jets;
}

async function boot(){
  const mode = qs('mode'); // 'edit' or null
  const editId = qs('id');

  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const btn = document.getElementById('create');

  const all = await loadAll();

  let editingTracker = null;

  if (mode === 'edit' && editId && all[editId]){
    editingTracker = all[editId];

    title.textContent = 'Edit Run Tracker';
    subtitle.textContent = 'Update tracker name, checklist link, targets, and included jets.';
    btn.textContent = 'Save changes';

    document.getElementById('name').value = editingTracker.name || '';
    document.getElementById('totalMax').value = (editingTracker.totalMax ?? 16.8);

    const firstJet = editingTracker.jets ? Object.values(editingTracker.jets)[0] : null;
    document.getElementById('jetMax').value = (firstJet?.max ?? 5.6);

    setJetsCheckedFromTracker(editingTracker);
    await populateChecklistItems(editingTracker.checklistItemId || '');
  } else {
    await populateChecklistItems('');
  }

  btn.onclick = async () => {
    const name = document.getElementById('name').value.trim() || null;
    const checklistItemId = document.getElementById('checklist').value || null;
    const totalMax = n(document.getElementById('totalMax').value);
    const jetMax = n(document.getElementById('jetMax').value);

    const checkedJets = Array.from(document.querySelectorAll('.jet')).filter(j => j.checked);
    if (!checkedJets.length){
      alert('Select at least one jet.');
      return;
    }

    if (editingTracker){
      const updated = {
        ...editingTracker,
        name,
        checklistItemId,
        totalMax,
        jets: buildJetsFromUI(jetMax, editingTracker.jets || {})
      };

      all[editId] = updated;
      await saveAll(all);
      return t.closePopup();
    }

    const id = uid();
    all[id] = {
      name,
      checklistItemId,
      totalMax,
      jets: buildJetsFromUI(jetMax, null)
    };

    await saveAll(all);
    return t.closePopup();
  };

  t.sizeTo(document.body);
}

t.render(() => boot());
