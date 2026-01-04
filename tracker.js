/* global TrelloPowerUp */
const t = TrelloPowerUp.iframe();
const STORAGE_KEY = 'trackers';

let renderToken = 0;

function getCardId(){
  try{
    const ctx = t.getContext && t.getContext();
    return (ctx && ctx.card) ? ctx.card : 'card';
  }catch{ return 'card'; }
}
function lsKey(trackerId, suffix){
  return `wjrt:${getCardId()}:${trackerId}:${suffix}`;
}
function getFocus(trackerId){
  try{ return localStorage.getItem(lsKey(trackerId,'focus')) || 'ALL'; }catch{ return 'ALL'; }
}
function setFocus(trackerId, val){
  try{ localStorage.setItem(lsKey(trackerId,'focus'), val); }catch{}
}
function isBreakdownCollapsed(trackerId, bdId){
  try{ return localStorage.getItem(lsKey(trackerId,`bd:${bdId}:collapsed`)) === '1'; }catch{ return false; }
}
function toggleBreakdownCollapsed(trackerId, bdId){
  try{
    const k = lsKey(trackerId,`bd:${bdId}:collapsed`);
    const cur = localStorage.getItem(k) === '1';
    localStorage.setItem(k, cur ? '0' : '1');
  }catch{}
}
function collapseAllBreakdowns(trackerId, collapse){
  try{
    const trackersEl = document.querySelectorAll(`[data-tracker-id="${trackerId}"][data-bd-id]`);
    for (const elx of trackersEl){
      const bdId = elx.getAttribute('data-bd-id');
      const k = lsKey(trackerId,`bd:${bdId}:collapsed`);
      localStorage.setItem(k, collapse ? '1' : '0');
    }
  }catch{}
}

function n(v){ const x = parseFloat(v); return Number.isFinite(x) ? x : 0; }
function fmt(v){
  const x = n(v);
  const s = (Math.round(x*1000)/1000).toString();
  return s;
}

function el(tag, attrs={}, kids=[]){
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'onclick') e.addEventListener('click', v);
    else e.setAttribute(k, v);
  }
  if (!Array.isArray(kids)) kids = [kids];
  for (const kid of kids){
    if (kid == null) continue;
    if (typeof kid === 'string') e.appendChild(document.createTextNode(kid));
    else e.appendChild(kid);
  }
  return e;
}

function uid(){
  return 'tr_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
}

function pct(current, max){
  current = n(current);
  max = n(max);
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

function aggregateByJet(breakdowns){
  const out = {};
  for (const b of (breakdowns || [])){
    for (const [jetName, jet] of Object.entries(b.jets || {})){
      if (!out[jetName]) out[jetName] = { current: 0, target: 0 };
      out[jetName].current += n(jet.current);
      out[jetName].target += n(jet.target);
    }
  }
  return out;
}

function statusFor(current, target){
  current = n(current);
  target = n(target);

  if (target <= 0){
    return { text:'NO TARGET', cls:'under', over:false };
  }
  const diff = current - target;
  if (Math.abs(diff) < 0.0005){
    return { text:'ON TARGET', cls:'good', over:false };
  }
  if (diff > 0){
    return { text:`OVER +${fmt(diff)}`, cls:'over', over:true };
  }
  return { text:`UNDER ${fmt(Math.abs(diff))}`, cls:'under', over:false };
}

function computeTotals(tr){
  if (tr.breakdowns && tr.breakdowns.length){
    let totalCurrent = 0;
    let totalTargetSum = 0;

    for (const b of tr.breakdowns){
      const s = sumJets(b.jets || {});
      totalCurrent += s.current;

      const bt = n(b.totalTarget) || s.target;
      totalTargetSum += bt;
    }

    const totalTarget = n(tr.totalTarget) || totalTargetSum;
    return { totalCurrent, totalTarget, breakdownTargetSum: totalTargetSum };
  }

  const s = sumJets(tr.jets || {});
  const totalTarget = n(tr.totalTarget) || s.target;
  return { totalCurrent: s.current, totalTarget, breakdownTargetSum: 0 };
}

async function loadUpgradedTrackers(){
  const all = (await t.get('card','shared',STORAGE_KEY)) || {};
  return all;
}

async function saveTrackers(all){
  await t.set('card','shared',STORAGE_KEY,all);
}

async function mutateTracker(id, fn){
  const all = await loadUpgradedTrackers();
  const cur = all[id];
  if (!cur) return;
  all[id] = fn(cur);
  await saveTrackers(all);
  await renderAll();
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

/* ---------- Checklist link: safe fetch name ---------- */
async function getChecklistItemName(itemId){
  if (!itemId) return null;
  try{
    const rest = t.getRestApi();
    const ok = await rest.isAuthorized();
    if (!ok) return null;

    const ctx = t.getContext();
    const cardId = ctx.card;
    const checks = await rest.getToken().then(token => {
      return fetch(`https://api.trello.com/1/cards/${cardId}/checklists?key=${rest._key}&token=${token}`)
        .then(r => r.json());
    });

    for (const cl of (checks || [])){
      for (const it of (cl.checkItems || [])){
        if (it.id === itemId) return it.name || null;
      }
    }
    return null;
  }catch{
    return null;
  }
}

async function renderAll(){
  const myToken = ++renderToken;
  const trackers = await loadUpgradedTrackers();
  if (myToken !== renderToken) return;

  const container = document.getElementById('container');
  container.innerHTML = '';

  const entries = Object.entries(trackers || {});
  if (!entries.length){
    container.appendChild(el('div',{class:'empty',text:'No trackers yet. Click “+ Add Tracker”.'}));
    t.sizeTo(document.body);
    return;
  }

  for (const [id, tracker] of entries){
    const liveLinkedName = await getChecklistItemName(tracker.checklistItemId);
    const linkedName = liveLinkedName || tracker.checklistItemName || null;

    if (tracker.checklistItemId && liveLinkedName && tracker.checklistItemName !== liveLinkedName){
      mutateTracker(id, (tr) => ({ ...tr, checklistItemName: liveLinkedName }));
    }

    const displayName = tracker.name || linkedName || 'Run Tracker';
    const totals = computeTotals(tracker);

    const card = el('div',{class:'card'});

    const left = el('div',{},[
      el('div',{class:'name',text:displayName}),
      el('div',{class:'sub',text: linkedName ? `Linked to: ${linkedName}` : 'Not linked'})
    ]);

    const actions = el('div',{class:'actions'},[
      el('button',{
        type:'button',
        class:'btn',
        text: tracker.collapsed ? 'Expand' : 'Collapse',
        onclick: () => mutateTracker(id, (tr) => ({ ...tr, collapsed: !tr.collapsed }))
      }),
      el('button',{
        type:'button',
        class:'btn',
        text:'Edit',
        onclick: async () => { await openEditModal(id); await renderAll(); }
      }),
      el('button',{
        type:'button',
        class:'dangerBtn',
        text:'Delete',
        onclick: async () => {
          if (!confirm('Delete this tracker?')) return;
          const all = await loadUpgradedTrackers();
          delete all[id];
          await saveTrackers(all);
          await renderAll();
        }
      })
    ]);

    card.appendChild(el('div',{class:'header'},[left, actions]));

    // Total section
    const totalBox = el('div',{class:'totalBox'});
    const totalDiff = totals.totalCurrent - totals.totalTarget;
    const stTotal = statusFor(totals.totalCurrent, totals.totalTarget);

    const pill = el('div',{class:`pill ${stTotal.over?'over':'good'}`});
    if (totals.totalTarget <= 0){
      pill.textContent = 'No total target';
    }else{
      pill.textContent = (stTotal.over ? `Over +${fmt(totalDiff)}` : `Remaining ${fmt(Math.max(0, -totalDiff))}`);
    }

    totalBox.appendChild(el('div',{class:'totalTop'},[
      el('div',{style:'font-weight:950;',text:'Total Run Count'}),
      el('div',{style:'display:flex;align-items:center;gap:8px;'},[
        pill,
        el('div',{style:'font-weight:950;color:var(--muted);white-space:nowrap;'},text:`${fmt(totals.totalCurrent)} / ${fmt(totals.totalTarget)}`)
      ])
    ]));

    const totalBarWrap = el('div',{class:`barWrap ${totalDiff>0?'barOver':''}`});
    const totalBarFill = el('div',{class:'barFill'});
    totalBarFill.style.width = (pct(totals.totalCurrent, totals.totalTarget)*100).toFixed(0)+'%';
    totalBarWrap.appendChild(totalBarFill);
    totalBox.appendChild(totalBarWrap);

    card.appendChild(totalBox);

    if (tracker.collapsed){
      card.appendChild(el('div',{class:'collapsedNote',text:'Collapsed. Expand to see controls.'}));
      container.appendChild(card);
      continue;
    }

    // View / focus controls (hide other jets for clarity)
    const focusVal = getFocus(id);
    const toolbar = el('div',{class:'toolbarRow'});
    const chips = el('div',{class:'focusChips'});
    const mkChip = (label, val) => el('button',{
      type:'button',
      class:`chipBtn ${focusVal===val?'active':''}`,
      text:label,
      onclick: () => { setFocus(id,val); renderAll(); }
    });
    chips.appendChild(mkChip('All','ALL'));
    chips.appendChild(mkChip('WJ1','Waterjet 1'));
    chips.appendChild(mkChip('WJ2','Waterjet 2'));
    chips.appendChild(mkChip('WJ3','Waterjet 3'));
    toolbar.appendChild(chips);

    // quick collapse/expand breakdowns when present
    if (tracker.breakdowns && tracker.breakdowns.length){
      const mini = el('div',{class:'focusChips'});
      mini.appendChild(el('button',{type:'button',class:'iconBtn',text:'Collapse all',onclick:()=>{ collapseAllBreakdowns(id,true); renderAll(); }}));
      mini.appendChild(el('button',{type:'button',class:'iconBtn',text:'Expand all',onclick:()=>{ collapseAllBreakdowns(id,false); renderAll(); }}));
      toolbar.appendChild(mini);
    }else{
      toolbar.appendChild(el('div',{class:'miniNote',text:'Tip: focus your machine to reduce clutter.'}));
    }
    card.appendChild(toolbar);

    // ✅ BREAKDOWN MODE: show breakdown blocks with controls (no "Overall by Jet" to reduce clutter)
    if (tracker.breakdowns && tracker.breakdowns.length){
      card.appendChild(el('div',{class:'sectionTitle',text:'Run Breakdown'}));

      for (const bd of tracker.breakdowns){
        const bdJets = bd.jets || {};
        const s = sumJets(bdJets);
        const bdTarget = n(bd.totalTarget) || s.target;

        const bdBox = el('div',{class:'breakdown'});
        const bdId = bd.id || bd.name || 'bd';
        bdBox.setAttribute('data-tracker-id', id);
        bdBox.setAttribute('data-bd-id', bdId);
        const bdCollapsed = isBreakdownCollapsed(id, bdId);

        bdBox.appendChild(el('div',{class:'breakdownHeader'},[
          el('div',{class:'bdName',text: bd.name || 'Breakdown'}),
          el('div',{style:'display:flex;align-items:center;gap:8px;'},[
            el('div',{class:'bdMeta',text:`${fmt(s.current)} / ${fmt(bdTarget)}`}),
            el('button',{type:'button',class:'iconBtn',text: bdCollapsed ? '▸' : '▾', onclick:()=>{ toggleBreakdownCollapsed(id, bdId); renderAll(); }})
          ])
        ]));

        const bdBarWrap = el('div',{class:`barWrap ${s.current>bdTarget?'barOver':''}`});
        const bdBarFill = el('div',{class:'barFill'});
        bdBarFill.style.width = (pct(s.current, bdTarget)*100).toFixed(0)+'%';
        bdBarWrap.appendChild(bdBarFill);
        bdBox.appendChild(bdBarWrap);

        if (bdCollapsed){
          bdBox.appendChild(el('div',{class:'miniNote',text:'Collapsed'}));
          card.appendChild(bdBox);
          continue;
        }

        const innerJets = el('div',{class:'jets'});
        for (const [jetName, data] of Object.entries(bdJets)){
          if (focusVal !== 'ALL' && jetName !== focusVal) continue;

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
            if (!tr) return;

            const next = JSON.parse(JSON.stringify(tr));
            const bdx = (next.breakdowns || []).find(x => (x.id || x.name) === bdId);
            if (!bdx) return;

            bdx.jets = bdx.jets || {};
            bdx.jets[jetName] = bdx.jets[jetName] || { current: 0, target: 0 };
            bdx.jets[jetName].current = n(newVal);

            trackers2[id] = next;
            await saveTrackers(trackers2);
            await renderAll();
          };

          const minus = el('button',{type:'button',class:'pm',text:'−',onclick:() => applyValue(currentVal - 1)});
          const plus  = el('button',{type:'button',class:'pm',text:'+',onclick:() => applyValue(currentVal + 1)});

          input.addEventListener('change', e => applyValue(e.target.value));

          row.appendChild(el('div',{class:'controls'},[
            minus, input, plus,
            el('div',{class:'max',text:`/ ${fmt(targetVal)} target`})
          ]));

          innerJets.appendChild(row);
        }

        if (!innerJets.children.length){
          innerJets.appendChild(el('div',{class:'miniNote',text:'No counters for this jet in this breakdown.'}));
        }

        bdBox.appendChild(innerJets);
        card.appendChild(bdBox);
      }

      container.appendChild(card);
      continue;
    }

    // Classic mode (no breakdowns)
    const jetsWrap2 = el('div',{class:'jets'});
    for (const [jetName, data] of Object.entries(tracker.jets || {})){
      if (focusVal !== 'ALL' && jetName !== focusVal) continue;

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
        if (!tr) return;
        const next = JSON.parse(JSON.stringify(tr));
        next.jets = next.jets || {};
        next.jets[jetName] = next.jets[jetName] || { current: 0, target: 0 };
        next.jets[jetName].current = n(newVal);
        trackers2[id] = next;
        await saveTrackers(trackers2);
        await renderAll();
      };

      const minus = el('button',{type:'button',class:'pm',text:'−',onclick:() => applyValue(currentVal - 1)});
      const plus  = el('button',{type:'button',class:'pm',text:'+',onclick:() => applyValue(currentVal + 1)});

      input.addEventListener('change', e => applyValue(e.target.value));

      row.appendChild(el('div',{class:'controls'},[
        minus, input, plus,
        el('div',{class:'max',text:`/ ${fmt(targetVal)} target`})
      ]));

      jetsWrap2.appendChild(row);
    }

    if (!jetsWrap2.children.length){
      jetsWrap2.appendChild(el('div',{class:'miniNote',text:'No counters for this jet. Select All to view others.'}));
    }
    card.appendChild(jetsWrap2);

    container.appendChild(card);
  }

  t.sizeTo(document.body);
}

document.getElementById('addTrackerBtn').addEventListener('click', async () => {
  await openCreateModal();
  await renderAll();
});

renderAll();
