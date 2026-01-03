/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

let renderToken = 0;

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function round3(v){ return Math.round(n(v) * 1000) / 1000; }

function fmt(v){
  const x = round3(v);
  return ('' + x).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function el(tag, attrs = {}, children = []){
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

async function loadTrackers(){
  return await t.get('card','shared',STORAGE_KEY,{});
}
async function saveTrackers(trackers){
  await t.set('card','shared',STORAGE_KEY,trackers);
}

/**
 * More robust checklist hydration:
 * try t.card('checklists'), then t.card('all'), and safely walk common shapes.
 */
async function getChecklistItemName(itemId){
  if (!itemId) return null;

  const candidates = [];
  try { candidates.push(await t.card('checklists')); } catch {}
  try { candidates.push(await t.card('all')); } catch {}

  for (const card of candidates){
    const lists = card?.checklists || card?.checkList || [];
    for (const cl of lists){
      const items = cl?.checkItems || cl?.checkItemStates || cl?.items || [];
      for (const it of items){
        const id = it?.id || it?.idCheckItem;
        const name = it?.name;
        if (id === itemId && name) return name;
      }
    }
  }
  return null;
}

function pct(current, max){
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, current / max));
}

function computeTotals(tracker){
  let totalCurrent = 0;
  let totalTarget = tracker.totalTarget != null ? n(tracker.totalTarget) : 0;

  let sumJetTargets = 0;
  for (const jet of Object.values(tracker.jets || {})){
    totalCurrent += n(jet.current);
    sumJetTargets += n(jet.target);
  }

  // If totalTarget is not set, fall back to sum of per-jet targets
  if (!totalTarget) totalTarget = sumJetTargets;

  return { totalCurrent, totalTarget, sumJetTargets };
}

async function mutateTracker(id, mutateFn){
  const trackers = await loadTrackers();
  if (!trackers[id]) return;

  const next = { ...(trackers || {}) };
  const updated = mutateFn(next[id]);
  next[id] = updated;
  await saveTrackers(next);
  await render();
}

async function render(){
  const myToken = ++renderToken;
  const trackers = await loadTrackers();
  if (myToken !== renderToken) return;

  const container = document.getElementById('container');
  container.innerHTML = '';

  const entries = Object.entries(trackers || {});
  if (entries.length === 0){
    container.appendChild(el('div',{class:'empty',text:'No trackers yet. Use “Add Run Tracker” on this card.'}));
    t.sizeTo(document.body);
    return;
  }

  for (const [id, tracker] of entries){
    const linkedName = await getChecklistItemName(tracker.checklistItemId);
    const displayName = tracker.name || linkedName || 'Run Tracker';

    const { totalCurrent, totalTarget } = computeTotals(tracker);
    const totalDiff = totalCurrent - totalTarget;

    const card = el('div',{class:'tracker'});

    const headLeft = el('div',{},[
      el('div',{class:'title',text:displayName}),
      el('div',{class:'sub',text: tracker.checklistItemId
        ? (linkedName ? `Linked to: ${linkedName}` : 'Linked checklist item not found / not accessible')
        : 'Not linked'})
    ]);

    const actions = el('div',{class:'actions'},[
      el('button',{
        class:'btn',
        text: tracker.collapsed ? 'Expand' : 'Collapse',
        onclick: async () => {
          await mutateTracker(id, (tr) => ({ ...tr, collapsed: !tr.collapsed }));
        }
      }),
      el('button',{
        class:'btn',
        text:'Edit',
        onclick: () => t.popup({
          title:'Edit Run Tracker',
          url: t.signUrl(`./create.html?mode=edit&id=${encodeURIComponent(id)}`),
          height: 640
        })
      }),
      el('button',{
        class:'btn btnDanger',
        text:'Delete',
        onclick: async () => {
          const next = { ...(trackers || {}) };
          delete next[id];
          await saveTrackers(next);
          await render();
        }
      })
    ]);

    card.appendChild(el('div',{class:'head'},[headLeft, actions]));

    // TOTAL box
    const pill = totalDiff > 0
      ? el('span',{class:'pill pillOver',text:`TOTAL OVER +${fmt(totalDiff)}`})
      : el('span',{class:'pill pillUnder',text:`Remaining ${fmt(Math.abs(totalDiff))}`});

    const totalBox = el('div',{class:'totalBox'});
    totalBox.appendChild(el('div',{class:'totalTop'},[
      el('div',{text:'Total Run Count'}),
      el('div',{text:`${fmt(totalCurrent)} / ${fmt(totalTarget)}`})
    ]));
    totalBox.appendChild(el('div',{},[pill]));

    const totalBarWrap = el('div',{class:`barWrap ${totalDiff>0?'barOver':''}`});
    const totalBarFill = el('div',{class:'barFill'});
    totalBarFill.style.width = (pct(totalCurrent,totalTarget)*100).toFixed(0)+'%';
    totalBarWrap.appendChild(totalBarFill);
    totalBox.appendChild(totalBarWrap);

    card.appendChild(totalBox);

    if (tracker.collapsed){
      card.appendChild(el('div',{class:'collapsedNote',text:'Tracker collapsed. Expand to see per-jet controls.'}));
      container.appendChild(card);
      continue;
    }

    // JETS
    const jetsWrap = el('div',{class:'jets'});

    for (const [jetName, data] of Object.entries(tracker.jets || {})){
      const currentVal = n(data.current);
      const targetVal = n(data.target);
      const diff = currentVal - targetVal;

      let statusText = 'ON TARGET';
      let statusClass = '';
      if (diff > 0){ statusText = `OVER +${fmt(diff)}`; statusClass = 'statusOver'; }
      else if (diff < 0){ statusText = `UNDER ${fmt(Math.abs(diff))}`; statusClass = 'statusUnder'; }

      const row = el('div',{class:'jetRow'});

      row.appendChild(el('div',{class:'jetHeader'},[
        el('div',{class:'jetName',text:jetName}),
        el('div',{class:`status ${statusClass}`,text:statusText})
      ]));

      const barWrap = el('div',{class:`barWrap ${diff>0?'barOver':''}`});
      const barFill = el('div',{class:'barFill'});
      barFill.style.width = (pct(currentVal,targetVal)*100).toFixed(0)+'%';
      barWrap.appendChild(barFill);
      row.appendChild(barWrap);

      const input = el('input',{
        class:'num',
        type:'number',
        step:'any',
        inputmode:'decimal',
        value: fmt(currentVal)
      });

      const applyValue = async (newVal) => {
        const trackers2 = await loadTrackers();
        const tr = trackers2[id];
        if (!tr?.jets?.[jetName]) return;

        tr.jets[jetName].current = round3(newVal);
        await saveTrackers(trackers2);
        await render();
      };

      const minus = el('button',{class:'pm',text:'–',onclick:() => applyValue(currentVal - 1)});
      const plus  = el('button',{class:'pm',text:'+',onclick:() => applyValue(currentVal + 1)});

      input.addEventListener('change', e => applyValue(e.target.value));

      row.appendChild(el('div',{class:'controls'},[
        minus,
        input,
        plus,
        el('div',{class:'max',text:`/ ${fmt(targetVal)} target`})
      ]));

      jetsWrap.appendChild(row);
    }

    card.appendChild(jetsWrap);
    container.appendChild(card);
  }

  t.sizeTo(document.body);
}

t.render(() => render());
window.addEventListener('focus', () => render());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
