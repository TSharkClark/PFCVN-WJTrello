/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

let renderToken = 0;

function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }

function fmt(v){
  const x = Math.round(n(v) * 1000) / 1000;
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

async function getChecklistName(itemId){
  if (!itemId) return null;
  const card = await t.card('checklists');
  for (const cl of (card.checklists || [])){
    for (const item of (cl.checkItems || [])){
      if (item.id === itemId) return item.name;
    }
  }
  return null;
}

function computeTotals(tracker){
  let totalCurrent = 0;
  let totalMax = tracker.totalMax != null ? n(tracker.totalMax) : 0;

  let sumJetMax = 0;
  for (const data of Object.values(tracker.jets || {})){
    totalCurrent += n(data.current);
    sumJetMax += n(data.max);
  }
  // if totalMax not set, fall back to sum of jet max
  if (!totalMax) totalMax = sumJetMax;

  return { totalCurrent, totalMax, sumJetMax };
}

function pct(current, max){
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, current / max));
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
    const linkedName = await getChecklistName(tracker.checklistItemId);
    const displayName = tracker.name || linkedName || 'Run Tracker';

    const { totalCurrent, totalMax } = computeTotals(tracker);
    const totalDiff = totalCurrent - totalMax;

    const card = el('div',{class:'tracker'});

    const headLeft = el('div',{},[
      el('div',{class:'title',text:displayName}),
      el('div',{class:'sub',text: tracker.checklistItemId
        ? (linkedName ? `Linked to: ${linkedName}` : 'Linked checklist item not found')
        : 'Not linked'})
    ]);

    const actions = el('div',{class:'actions'},[
      el('button',{
        class:'btn',
        text:'Edit',
        onclick: () => t.popup({
          title:'Edit Run Tracker',
          url: t.signUrl(`./create.html?mode=edit&id=${encodeURIComponent(id)}`),
          height: 560
        })
      }),
      el('button',{
        class:'btn btnDanger',
        text:'Delete',
        onclick: async () => {
          const next = {...(trackers||{})};
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
      el('div',{text:`${fmt(totalCurrent)} / ${fmt(totalMax)}`})
    ]));
    totalBox.appendChild(el('div',{},[pill]));

    const totalBarWrap = el('div',{class:`barWrap ${totalDiff>0?'barOver':''}`});
    const totalBarFill = el('div',{class:'barFill'});
    totalBarFill.style.width = (pct(totalCurrent,totalMax)*100).toFixed(0)+'%';
    totalBarWrap.appendChild(totalBarFill);
    totalBox.appendChild(totalBarWrap);

    card.appendChild(totalBox);

    // JETS
    const jetsWrap = el('div',{class:'jets'});

    for (const [jetName, data] of Object.entries(tracker.jets || {})){
      const currentVal = n(data.current);
      const maxVal = n(data.max);
      const diff = currentVal - maxVal;

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
      barFill.style.width = (pct(currentVal,maxVal)*100).toFixed(0)+'%';
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
        data.current = n(newVal);
        tracker.jets[jetName] = data;
        const next = {...(trackers||{})};
        next[id] = tracker;
        await saveTrackers(next);
        await render();
      };

      const minus = el('button',{class:'pm',text:'–',onclick:() => applyValue(currentVal - 1)});
      const plus  = el('button',{class:'pm',text:'+',onclick:() => applyValue(currentVal + 1)});

      input.addEventListener('change', e => applyValue(e.target.value));

      row.appendChild(el('div',{class:'controls'},[
        minus,
        input,
        plus,
        el('div',{class:'max',text:`/ ${fmt(maxVal)}`})
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
