/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'wj_trackers_v1';

function clampNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function uid() {
  return 'trk_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function populateChecklistItems() {
  const sel = document.getElementById('checkItem');
  const card = await t.card('checklists');

  for (const cl of (card.checklists || [])) {
    const groupLabel = document.createElement('optgroup');
    groupLabel.label = cl.name;

    for (const item of (cl.checkItems || [])) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      groupLabel.appendChild(opt);
    }

    sel.appendChild(groupLabel);
  }
}

async function createTracker() {
  const name = document.getElementById('name').value.trim();
  const checkItemId = document.getElementById('checkItem').value || null;

  const totalTarget = clampNumber(document.getElementById('totalTarget').value);
  const jetTarget = clampNumber(document.getElementById('jetTarget').value);

  const jetChecks = Array.from(document.querySelectorAll('.jet'));
  const jets = jetChecks
    .filter(c => c.checked)
    .map(c => ({ name: c.value, current: 0, target: jetTarget }));

  const newTracker = {
    id: uid(),
    name: name || null,
    checkItemId,
    totalTarget,
    totalCurrent: 0,
    jets
  };

  const state = await t.get('card', 'shared', STORAGE_KEY, { trackers: [] });
  state.trackers = state.trackers || [];
  state.trackers.push(newTracker);

  await t.set('card', 'shared', STORAGE_KEY, state);
  return t.closePopup();
}

t.render(async () => {
  await populateChecklistItems();
  document.getElementById('create').addEventListener('click', createTracker);
});
