const t = TrelloPowerUp.popup();

async function loadChecklistItems() {
  const card = await t.card('checklists');
  const select = document.getElementById('checklist');
  select.innerHTML = '<option value="">None</option>';

  card.checklists.forEach(cl => {
    cl.checkItems.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = cl.name + ': ' + item.name;
      select.appendChild(opt);
    });
  });
}

document.getElementById('create').onclick = async () => {
  const name = document.getElementById('name').value.trim();
  const checklistItemId = document.getElementById('checklist').value || null;
  const jets = Array.from(document.querySelectorAll('input[type=checkbox]:checked')).map(j => j.value);
  if (!jets.length) {
    alert('Select at least one jet.');
    return;
  }
  const trackers = await t.get('card', 'shared', 'trackers', {});
  const id = crypto.randomUUID();
  trackers[id] = {
    name,
    checklistItemId,
    jets: Object.fromEntries(jets.map(j => [j, { current: 0, max: 5.6 }]))
  };
  await t.set('card', 'shared', 'trackers', trackers);
  t.closePopup();
};

loadChecklistItems();
