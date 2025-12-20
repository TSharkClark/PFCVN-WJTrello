/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

/**
 * IMPORTANT: Fixes your "second tracker appears" bug
 * by preventing overlapping async renders from both appending to the DOM.
 */
let renderToken = 0;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(v) {
  // show up to 3 decimals but trim trailing zeros
  const x = Math.round(n(v) * 1000) / 1000;
  return ('' + x).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

async function getChecklistName(itemId) {
  if (!itemId) return null;
  const card = await t.card('checklists');
  for (const cl of (card.checklists || [])) {
    for (const item of (cl.checkItems || [])) {
      if (item.id === itemId) return item.name;
    }
  }
  return null;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

async function loadTrackers() {
  return await t.get('card', 'shared', STORAGE_KEY, {});
}

async function saveTrackers(trackers) {
  await t.set('card', 'shared', STORAGE_KEY, trackers);
}

function computeTotals(tracker) {
  let totalCurrent = 0;
  let totalMax = 0;

  for (const data of Object.values(tracker.jets || {})) {
    totalCurrent += n(data.current);
    totalMax += n(data.max);
  }

  // optional explicit totalMax (if present from newer create screen)
  if (tracker.totalMax != null) totalMax = n(tracker.totalMax);

  return { totalCurrent, totalMax };
}

async function render() {
  const myToken = ++renderToken;

  const trackers = await loadTrackers();

  // stop if another render started while we awaited
  if (myToken !== renderToken) return;

  const container = document.getElementById('container');
  container.innerHTML = '';

  const entries = Object.entries(trackers || {});
  if (entries.length === 0) {
    container.appendChild(
      el('div', { class: 'empty', text: 'No trackers yet. Use “Add Run Tracker” on this card.' })
    );
    t.sizeTo(document.body);
    return;
  }

  for (const [id, tracker] of entries) {
    const linkedName = await getChecklistName(tracker.checklistItemId);
    const displayName = tracker.name || linkedName || 'Run Tracker';

    const { totalCurrent, totalMax } = computeTotals(tracker);

    const card = el('div', { class: 'tracker' });

    const headLeft = el('div', {}, [
      el('div', { class: 'title', text: displayName }),
      el('div', {
        class: 'sub',
        text: tracker.checklistItemId
          ? (linkedName ? `Linked to: ${linkedName}` : 'Linked checklist item not found')
          : 'Not linked'
      })
    ]);

    const actions = el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn',
        text: 'Edit',
        onclick: () => t.popup({
          title: 'Edit Run Tracker',
          url: t.signUrl(`./create.html?mode=edit&id=${encodeURIComponent(id)}`),
          height: 520
        })
      }),
      el('button', {
        class: 'btn btnDanger',
        text: 'Delete',
        onclick: async () => {
          const next = { ...(trackers || {}) };
          delete next[id];
          await saveTrackers(next);
          await render();
        }
      })
    ]);

    card.appendChild(el('div', { class: 'head' }, [headLeft, actions]));

    card.appendChild(
      el('div', { class: 'total' }, [
        el('div', { class: 'label', text: 'Total Run Count' }),
        el('div', { class: 'val', text: `${fmt(totalCurrent)} / ${fmt(totalMax)}` })
      ])
    );

    const jetsWrap = el('div', { class: 'jets' });

    for (const [jetName, data] of Object.entries(tracker.jets || {})) {
      const currentVal = n(data.current);
      const maxVal = n(data.max);

      const input = el('input', {
        class: 'num',
        type: 'number',
        step: 'any',          // allows decimals by typing
        inputmode: 'decimal',
        value: fmt(currentVal)
      });

      const applyValue = async (newVal) => {
        data.current = n(newVal);
        tracker.jets[jetName] = data;

        const next = { ...(trackers || {}) };
        next[id] = tracker;

        await saveTrackers(next);
        await render();
      };

      const minus = el('button', {
        class: 'pm',
        text: '–',
        onclick: () => applyValue(currentVal - 1)
      });

      const plus = el('button', {
        class: 'pm',
        text: '+',
        onclick: () => applyValue(currentVal + 1)
      });

      input.addEventListener('change', (e) => applyValue(e.target.value));

      jetsWrap.appendChild(
        el('div', { class: 'jetRow' }, [
          el('div', { class: 'jetName', text: jetName }),
          el('div', { class: 'controls' }, [
            minus,
            input,
            plus,
            el('div', { class: 'max', text: `/ ${fmt(maxVal)}` })
          ])
        ])
      );
    }

    card.appendChild(jetsWrap);
    container.appendChild(card);
  }

  t.sizeTo(document.body);
}

t.render(() => render());
window.addEventListener('focus', () => render());
