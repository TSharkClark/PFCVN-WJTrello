<!DOCTYPE html>
<html>
<body>
<h3>Create Run Tracker</h3>

<label>Tracker Name (optional)</label><br>
<input id="name"><br><br>

<label>Link Checklist Item (optional)</label><br>
<select id="checklist"></select><br><br>

<label>Jets</label><br>
<label><input type="checkbox" value="Waterjet 1"> Waterjet 1</label><br>
<label><input type="checkbox" value="Waterjet 2"> Waterjet 2</label><br>
<label><input type="checkbox" value="Waterjet 3"> Waterjet 3</label><br><br>

<button id="create">Create</button>

<script src="https://p.trellocdn.com/power-up.min.js"></script>
<script>
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
</script>
</body>
</html>
