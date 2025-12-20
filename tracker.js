const t = TrelloPowerUp.iframe();

async function getChecklistName(itemId) {
  if (!itemId) return null;
  const card = await t.card('checklists');
  for (const cl of card.checklists) {
    for (const item of cl.checkItems) {
      if (item.id === itemId) return item.name;
    }
  }
  return null;
}

async function load() {
  const trackers = await t.get('card', 'shared', 'trackers', {});
  const container = document.getElementById('container');
  container.innerHTML = '';
  for (const [id, tracker] of Object.entries(trackers)) {
    const name = tracker.name || (await getChecklistName(tracker.checklistItemId)) || 'Unnamed Tracker';
    let totalCurrent = 0;
    let totalMax = 0;
    const div = document.createElement('div');
    div.className = 'tracker';
    div.innerHTML = '<div class="title">' + name + '</div>';
    for (const [jet, data] of Object.entries(tracker.jets)) {
      totalCurrent += data.current;
      totalMax += data.max;
      const jetDiv = document.createElement('div');
      jetDiv.className = 'jet';
      jetDiv.innerHTML = jet + ': <input type="number" step="0.1" value="' + data.current + '"> / ' + data.max;
      jetDiv.querySelector('input').onchange = async e => {
        data.current = parseFloat(e.target.value) || 0;
        trackers[id] = tracker;
        await t.set('card', 'shared', 'trackers', trackers);
        load();
      };
      div.appendChild(jetDiv);
    }
    const total = document.createElement('div');
    total.innerHTML = '<strong>Total: ' + totalCurrent + ' / ' + totalMax + '</strong>';
    div.appendChild(total);
    container.appendChild(div);
  }
}

load();
