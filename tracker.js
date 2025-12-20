/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();

const STORAGE_KEY = 'wj_trackers_v1';

function clampNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function fmt(n) {
  // keep decimals but avoid ugly long floats
  const x = clampNumber(n);
  return (Math.round(x * 1000) / 1000).toString();
}

async function getChecklistItemName(checkItemId) {
  if (!checkItemId) return null;
  const card = await t.card('checklists');
  for (const cl of (card.checklists || [])) {
    for (const item of (cl.checkItems || [])) {
      if (item.id === checkItemId) return item.name;
    }
  }
  return null;
}

async function loadState() {
  return await t.get('card', 'shared', STORAGE_KEY, { trackers: [] });
}

async function saveState(state) {
  await t.set('card', 'shared', STORAGE_KEY, state);
}

function computeTotal(tracker) {
  let sum = 0;
  for (const jet of tracker.jets) sum += clampNumber(jet.current);
  tracker.totalCurrent = sum;
}

function makeJet(name, target = 0) {
  return { name, current: 0, target };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

async function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const state = await loadState();
  const trackers = state.trackers || [];

  if (trackers.length === 0) {
    app.appendChild(el('div', { class: 'muted', text: 'No trackers yet. Use “Add Run Tracker” on this card.' }));
    t.sizeTo(document.body);
    return;
  }

  for (const tracker of trackers) {
    computeTotal(tracker);

    const titleText = tracker.name || 'Run Tracker';
    const linkedName = await getChecklistItemName(tracker.checkItemId);
    const subtitle = linkedName ? `Linked to: ${linkedName}` : (tracker.checkItemId ? 'Linked item not found' : 'Not linked');

    const card = el('div', { class: 'tracker' });

    // Header
    card.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'title', text: titleText }),
      el('div', { class: 'muted', text: subtitle })
    ]));

    // Total line
    const totalLine = el('div', { class: 'row' }, [
      el('div', { class: 'jetname', text: 'Total Run Count' }),
      el('div', { class: 'muted', text: `${fmt(tracker.totalCurrent)} / ${fmt(tracker.totalTarget)}` })
    ]);
    card.appendChild(totalLine);

    // Jets
    const jetsWrap = el('div', { class: 'jets' });

    for (const jet of tracker.jets) {
      const input = el('input', {
        type: 'number',
        step: '0.01',
        value: fmt(jet.current)
      });

      input.addEventListener('change', async () => {
        jet.current = clampNumber(input.value);
        computeTotal(tracker);
        await saveState(state);
        await render();
      });

      const line = el('div', { class: 'jetline' }, [
        el('div', { class: 'jetname', text: jet.name }),
        el('div', { class: 'row' }, [
          input,
          el('div', { class: 'muted', text: `/ ${fmt(jet.target)}` })
        ])
      ]);

      jetsWrap.appendChild(line);
    }

    card.appendChild(jetsWrap);

    // Delete tracker
    card.appendChild(el('div', { class: 'row' }, [
      el('button', {
        text: 'Delete tracker',
        onclick: async () => {
          state.trackers = (state.trackers || []).filter(x => x.id !== tracker.id);
          await saveState(state);
          await render();
        }
      })
    ]));

    app.appendChild(card);
  }

  t.sizeTo(document.body);
}

t.render(() => {
  render();
});
