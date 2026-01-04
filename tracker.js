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

async function loadTrackers(){ return await t.get('card','shared',STORAGE_KEY,{}); }
async function saveTrackers(trackers){ await t.set('card','shared',STORAGE_KEY,trackers); }

function upgradeTrackerSchema(tr){
  if (!tr) return tr;

  const jets = { ...(tr.jets || {}) };
  for (const [k,v] of Object.entries(jets)){
    if (!v || typeof v !== 'object') continue;
    if (v.target == null && v.max != null) v.target = v.max;
    if (v.current == null) v.current = 0;
    delete v.max;
  }

  const breakdowns = Array.isArray(tr.breakdowns) ? tr.breakdowns.map(b => {
    const bj = { ...(b.jets || {}) };
    for (const [k,v] of Object.entries(bj)){
      if (!v || typeof v !== 'object') continue;
      if (v.target == null && v.max != null) v.target = v.max;
      if (v.current == null) v.current = 0;
      delete v.max;
    }
    return {
      id: b.id || ('bd_' + Math.random().toString(16).slice(2)),
      name: b.name ?? '',
      totalTarget: b.totalTarget ?? b.totalMax ?? 0,
      jets: bj
    };
  }) : [];

  return {
    ...tr,
    totalTarget: tr.totalTarget ?? tr.totalMax ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets,
    breakdowns,
    checklistItemName: tr.checklistItemName ?? null
  };
}

async function loadUpgradedTrackers(){
  const trackers = await loadTrackers();
  let changed = false;
  const out = { ...(trackers || {}) };

  for (const [id,tr] of Object.entries(out)){
    const up = upgradeTrackerSchema(tr);
    if (JSON.stringify(up) !== JSON.stringify(tr)) {
      out[id] = up;
      changed = true;
    }
  }
  if (changed) await saveTrackers(out);
  return out;
}

// REST-first checklist name (stable)
async function getChecklistItemName(itemId){
  if (!itemId) return null;

  try{
    const rest = t.getRestApi();
    const ok = await rest.isAuthorized();
    if (ok){
      const card = await t.card('id');
      const checklists = await rest.get(`/cards/${card.id}/checklists`, {
        checkItems: 'all',
        fields: 'name',
        checkItem_fields: 'name'
      });
      for (const cl of (checklists || [])){
        for (const it of (cl.checkItems || [])){
          if (it.id === itemId) return it.name;
        }
      }
    }
  }catch{ /* ignore */ }

  return null;
}

function pct(current, max){
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, current / max));
}

function sumJets(jets){
  let current = 0;
  let target = 0;
  for (const j of Object.values(jets || {})){
    current += n(j.current);
    target += n(j.target);
  }
  return { current, target };
}

function computeTrackerTotals(tr){
  // If breakdowns exist, totals come from breakdown jet totals
  if (Array.isArray(tr.breakdowns) && tr.breakdowns.length){
    let cur = 0, tgt = 0;
    for (const b of tr.breakdowns){
      const s = sumJets(b.jets || {});
      cur += s.current;
      // prefer breakdown totalTarget if set, otherwise sum of jet targets
      const bt = n(b.totalTarget) || s.target;
      tgt += bt;
    }
    // If tracker.totalTarget explicitly set, use it; else use breakdown sum
    const trackerTarget = n(tr.totalTarget) || tgt;
    return { totalCurrent: cur, totalTarget: trackerTarget, breakdownTargetSum: tgt };
  }

  // No breakdowns: classic
  const s = sumJets(tr.jets || {});
  const tgt = n(tr.totalTarget) || s.target;
  return { totalCurrent: s.current, totalTarget: tgt, breakdownTargetSum: 0 };
}

function openCreateModal(){
  return t.modal({
    title: 'Create Run Tracker',
    url: t.signUrl('./create.html'),
    fullscreen: false,
    height: 700
  });
}
function openEditModal(id){
  return t.modal({
    title: 'Edit Run Tracker',
    url: t.signUrl(`./create.html?mode=edit&id=${encodeURIComponent(id)}`),
    fullscreen: false,
    height: 700
  });
}

async function mutateTracker(id, mutateFn){
  const trackers = await loadUpgradedTrackers();
  if (!trackers[id]) return;
  const next = { ...(trackers || {}) };
  next[id] = mutateFn(next[id]);
  await saveTrackers(next);
  await render();
}

function statusFor(currentVal, targetVal){
  const diff = n(currentVal) - n(targetVal);
  if (diff > 0) return { text:`OVER +${fmt(diff)}`, cls:'statusOver', over:true };
  if (diff < 0) return { text:`UNDER ${fmt(Math.abs(diff))}`, cls:'statusUnder', over:false };
  return { text:'ON TARGET', cls:'', over:false };
}

async function render(){
  const myToken = ++renderToken;
  const trackers = await loadUpgradedTrackers();
  if (myToken !== renderToken) return;

  const container = document.getElementById('container');
  container.innerHTML = '';

  const entries = Object.entries(trackers || {});
  if (entries.length === 0){
    container.appendChild(el('div',{class:'empty',text:'No trackers yet. Click “+ Add Tracker” above.'}));
    t.sizeTo(document.body);
    return;
  }

  for (const [id, tracker] of entries){
    // stable linked name: REST -> snapshot
    const liveLinkedName = await getChecklistItemName(tracker.checklistItemId);
    const linkedName = liveLinkedName || tracker.checklistItemName || null;

    if (tracker.checklistItemId && liveLinkedName && tracker.checklistItemName !== liveLinkedName){
      // update snapshot
      mutateTracker(id, (tr) => ({ ...tr, checklistItemName: liveLinkedName }));
    }

    const displayName = tracker.name || linkedName || 'Run Tracker';

    const totals = computeTrackerTotals(tracker);
    const totalCurrent = totals.totalCurrent;
    const totalTarget = totals.totalTarget;
    const totalDiff = totalCurrent - totalTarget;

    const card = el('div',{class:'tracker'});

    const headLeft = el('div',{},[
      el('div',{class:'title',text:displayName}),
      el('div',{class:'sub',text: tracker.checklistItemId
        ? (linkedName ? `Linked to: ${linkedName}` : 'Linked (name unavailable — authorize for stable linking)')
        : 'Not linked'})
    ]);

    const actions = el('div',{class:'actions'},[
      el('button',{
        type:'button',
        class:'btn',
        text: tracker.collapsed ? 'Expand' : 'Collapse',
        onclick: async () => mutateTracker(id, (tr) => ({ ...tr, collapsed: !tr.collapsed }))
      }),
      el('button',{
        type:'button',
        class:'btn',
        text:'Edit',
        onclick: async () => { await openEditModal(id); await render(); }
      }),
      el('button',{
        type:'button',
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

    const pill = totalDiff > 0
      ? el('span',{class:'pill pillOver',text:`TOTAL OVER +${fmt(totalDiff)}`})
      : el('span',{class:'pill pillUnder',text:`Remaining ${fmt(Math.abs(totalDiff))}`});

    const totalBox = el('div',{class:'totalBox'});
    totalBox.appendChild(el('div',{class:'totalTop'},[
      el('div',{text:'Total Run Count'}),
      el('div',{text:`${fmt(totalCurrent)} / ${fmt(totalTarget)}`})
    ]));
    totalBox.appendChild(pill);

    const totalBarWrap = el('div',{class:`barWrap ${totalDiff>0?'barOver':''}`});
    const totalBarFill = el('div',{class:'barFill'});
    totalBarFill.style.width = (pct(totalCurrent,totalTarget)*100).toFixed(0)+'%';
    totalBarWrap.appendChild(totalBarFill);
    totalBox.appendChild(totalBarWrap);

    card.appendChild(totalBox);

    if (tracker.collapsed){
      card.appendChild(el('div',{class:'collapsedNote',text:'Collapsed. Expand to see controls.'}));
      container.appendChild(card);
      continue;
    }

    // ---------- BREAKDOWNS MODE ----------
    if (Array.isArray(tracker.breakdowns) && tracker.breakdowns.length){
      card.appendChild(el('div',{class:'sectionTitle',text:'Run Breakdown'}));

      for (const bd of tracker.breakdowns){
        const bdJets = bd.jets || {};
        const s = sumJets(bdJets);
        const bdTarget = n(bd.totalTarget) || s.target;
        const bdDiff = s.current - bdTarget;

        const bdBox = el('div',{class:'breakdown'});

        bdBox.appendChild(el('div',{class:'breakdownHeader'},[
          el('div',{class:'bdName',text: bd.name || 'Breakdown'}),
          el('div',{class:'bdMeta',text:`${fmt(s.current)} / ${fmt(bdTarget)}`})
        ]));

        const bdBarWrap = el('div',{class:`barWrap ${bdDiff>0?'barOver':''}`});
        const bdBarFill = el('div',{class:'barFill'});
        bdBarFill.style.width = (pct(s.current, bdTarget)*100).toFixed(0)+'%';
        bdBarWrap.appendChild(bdBarFill);
        bdBox.appendChild(bdBarWrap);

        const jetsWrap = el('div',{class:'jets'});
        for (const [jetName, data] of Object.entries(bdJets)){
          const currentVal = n(data.current);
          const targetVal = n(data.target);
          const st = statusFor(currentVal, targetVal);

          const row = el('div',{class:'jetRow'});

          row.appendChild(el('div',{class:'jetHeader'},[
            el('div',{class:'jetName',text:jetName}),
            el('div',{class:`status ${st.cls}`,text:st.text})
          ]));

          const barWrap = el('div',{class:`barWrap ${st.over?'barOver':''}`});
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
            const trackers2 = await loadUpgradedTrackers();
            const tr = trackers2[id];
            const b = (tr.breakdowns || []).find(x => x.id === bd.id);
            if (!b?.jets?.[jetName]) return;
            b.jets[jetName].current = round3(newVal);
            await saveTrackers(trackers2);
            await render();
          };

          const minus = el('button',{type:'button',class:'pm',text:'–',onclick:() => applyValue(currentVal - 1)});
          const plus  = el('button',{type:'button',class:'pm',text:'+',onclick:() => applyValue(currentVal + 1)});

          input.addEventListener('change', e => applyValue(e.target.value));

          row.appendChild(el('div',{class:'controls'},[
            minus, input, plus,
            el('div',{class:'max',text:`/ ${fmt(targetVal)} target`})
          ]));

          jetsWrap.appendChild(row);
        }

        bdBox.appendChild(jetsWrap);
        card.appendChild(bdBox);
      }

      container.appendChild(card);
      continue;
    }

    // ---------- CLASSIC MODE (NO BREAKDOWNS) ----------
    const jetsWrap = el('div',{class:'jets'});
    for (const [jetName, data] of Object.entries(tracker.jets || {})){
      const currentVal = n(data.current);
      const targetVal = n(data.target);
      const st = statusFor(currentVal, targetVal);

      const row = el('div',{class:'jetRow'});

      row.appendChild(el('div',{class:'jetHeader'},[
        el('div',{class:'jetName',text:jetName}),
        el('div',{class:`status ${st.cls}`,text:st.text})
      ]));

      const barWrap = el('div',{class:`barWrap ${st.over?'barOver':''}`});
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
        const trackers2 = await loadUpgradedTrackers();
        const tr = trackers2[id];
        if (!tr?.jets?.[jetName]) return;
        tr.jets[jetName].current = round3(newVal);
        await saveTrackers(trackers2);
        await render();
      };

      const minus = el('button',{type:'button',class:'pm',text:'–',onclick:() => applyValue(currentVal - 1)});
      const plus  = el('button',{type:'button',class:'pm',text:'+',onclick:() => applyValue(currentVal + 1)});

      input.addEventListener('change', e => applyValue(e.target.value));

      row.appendChild(el('div',{class:'controls'},[
        minus, input, plus,
        el('div',{class:'max',text:`/ ${fmt(targetVal)} target`})
      ]));

      jetsWrap.appendChild(row);
    }

    card.appendChild(jetsWrap);
    container.appendChild(card);
  }

  t.sizeTo(document.body);
}

t.render(async () => {
  const addBtn = document.getElementById('addTrackerBtn');
  if (addBtn) addBtn.onclick = async () => { await openCreateModal(); await render(); };
  await render();
});

window.addEventListener('focus', () => render());
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
