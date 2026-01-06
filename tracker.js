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

  const breakdowns = Array.isArray(tr.breakdowns) ? tr.breakdowns.map(b => ({
    id: b.id || ('bd_' + Math.random().toString(16).slice(2)),
    name: b.name ?? '',
    totalTarget: b.totalTarget ?? 0,
    jets: b.jets || {}
  })) : [];

  return {
    ...tr,
    totalTarget: tr.totalTarget ?? 0,
    autoSplit: tr.autoSplit ?? false,
    collapsed: tr.collapsed ?? false,
    jets: tr.jets || {},
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
    if (JSON.stringify(up) !== JSON.stringify(tr)){
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
    return { totalCurrent, totalTarget };
  }

  const s = sumJets(tr.jets || {});
  const totalTarget = n(tr.totalTarget) || s.target;
  return { totalCurrent: s.current, totalTarget };
}

function statusFor(currentVal, targetVal){
  const diff = n(currentVal) - n(targetVal);
  if (diff > 0) return { text:`OVER +${fmt(diff)}`, cls:'statusOver', over:true };
  if (diff < 0) return { text:`UNDER ${fmt(Math.abs(diff))}`, cls:'statusUnder', over:false };
  return { text:'ON TARGET', cls:'', over:false };
}

function statusPillText(currentVal, targetVal){
  const diff = n(currentVal) - n(targetVal);
  if (diff > 0) return { text:`OVER +${fmt(diff)}`, cls:'pill pillOver' };
  if (diff < 0) return { text:`REM ${fmt(Math.abs(diff))}`, cls:'pill pillUnder' };
  return { text:'ON', cls:'pill pillUnder' };
}

function jetBadges(jetNames){
  const jets = Array.isArray(jetNames) ? jetNames : Object.keys(jetNames || {});
  const wrap = el('div',{class:'bdBadges'});
  for (const j of jets){
    const short = j.includes('1') ? 'WJ1' : j.includes('2') ? 'WJ2' : j.includes('3') ? 'WJ3' : j;
    wrap.appendChild(el('span',{class:'bdBadge',text:short}));
  }
  return wrap;
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
  trackers[id] = mutateFn(trackers[id]);
  await saveTrackers(trackers);
  await render();
}

/* ---------- Focus + Breakdown collapse UI state (localStorage only) ---------- */
function cardKey(){
  try{
    const ctx = t.getContext && t.getContext();
    return (ctx && ctx.card) ? ctx.card : 'card';
  }catch{ return 'card'; }
}
function lsKey(trackerId, suffix){
  return `wjrt:${cardKey()}:${trackerId}:${suffix}`;
}
function getFocus(trackerId){
  try{ return localStorage.getItem(lsKey(trackerId,'focus')) || 'ALL'; }catch{ return 'ALL'; }
}
function setFocus(trackerId, val){
  try{ localStorage.setItem(lsKey(trackerId,'focus'), val); }catch{}
}
function isBdCollapsed(trackerId, bdId){
  try{ return localStorage.getItem(lsKey(trackerId,`bd:${bdId}:c`)) === '1'; }catch{ return false; }
}
function toggleBdCollapsed(trackerId, bdId){
  try{
    const k = lsKey(trackerId,`bd:${bdId}:c`);
    const cur = localStorage.getItem(k) === '1';
    localStorage.setItem(k, cur ? '0' : '1');
  }catch{}
}

async function render(){
  const myToken = ++renderToken;
  const trackers = await loadUpgradedTrackers();
  if (myToken !== renderToken) return;

  // Avoid saving & re-rendering inside the loop.
  let pendingSave = null;

  const container = document.getElementById('container');
  container.innerHTML = '';

  const entries = Object.entries(trackers || {});
  if (!entries.length){
    container.appendChild(el('div',{class:'empty',text:'No trackers yet. Click “+ Add Tracker” above.'}));
    t.sizeTo(document.body);
    return;
  }

  for (const [id, tracker] of entries){
    const liveLinkedName = await getChecklistItemName(tracker.checklistItemId);
    const linkedName = liveLinkedName || tracker.checklistItemName || null;

    if (tracker.checklistItemId && liveLinkedName && tracker.checklistItemName !== liveLinkedName){
      pendingSave = pendingSave || { ...(trackers || {}) };
      pendingSave[id] = { ...tracker, checklistItemName: liveLinkedName };
    }

    const displayName = tracker.name || linkedName || 'Run Tracker';
    const totals = computeTotals(tracker);
    const totalDiff = totals.totalCurrent - totals.totalTarget;

    const card = el('div',{class:'tracker'});

    const headLeft = el('div',{},[
      el('div',{class:'title',text:displayName}),
      el('div',{class:'sub',text: tracker.checklistItemId
        ? (linkedName ? `Linked to: ${linkedName}` : 'Linked (authorize for stable checklist names)')
        : 'Not linked'})
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
      el('div',{text:`${fmt(totals.totalCurrent)} / ${fmt(totals.totalTarget)}`})
    ]));
    totalBox.appendChild(pill);

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

    // Focus controls (single out your machine)
    const focus = getFocus(id);
    const focusBar = el('div',{class:'focusBar'},[
      el('div',{class:'focusLeft'},[
        el('div',{class:'focusLabel',text:'Focus:'}),
        el('button',{type:'button',class:`chip ${focus==='ALL'?'on':''}`,text:'All',onclick:()=>{ setFocus(id,'ALL'); render(); }}),
        el('button',{type:'button',class:`chip ${focus==='Waterjet 1'?'on':''}`,text:'WJ1',onclick:()=>{ setFocus(id,'Waterjet 1'); render(); }}),
        el('button',{type:'button',class:`chip ${focus==='Waterjet 2'?'on':''}`,text:'WJ2',onclick:()=>{ setFocus(id,'Waterjet 2'); render(); }}),
        el('button',{type:'button',class:`chip ${focus==='Waterjet 3'?'on':''}`,text:'WJ3',onclick:()=>{ setFocus(id,'Waterjet 3'); render(); }})
      ])
    ]);
    card.appendChild(focusBar);

    /* ✅ BREAKDOWN MODE: do NOT show "Overall by Jet" when breakdowns exist */
    if (tracker.breakdowns && tracker.breakdowns.length){
      card.appendChild(el('div',{class:'sectionTitle',text:'Advanced Count'}));

      let renderedAny = false;
      for (const bd of tracker.breakdowns){
        const bdJets = bd.jets || {};

        // Focus mode: only show breakdowns that actually contain the focused jet.
        if (focus !== 'ALL' && !bdJets[focus]) continue;

        renderedAny = true;
        const s = sumJets(bdJets);
        const bdTarget = n(bd.totalTarget) || s.target;
        const bdDiff = s.current - bdTarget;

        // In focused view, do not force-breakdown collapse (it feels like "stuck minimized").
        const collapsed = (focus === 'ALL') ? isBdCollapsed(id, bd.id) : false;

        const bdBox = el('div',{class:'breakdown'});

        const bdTitle = el('div',{class:'bdName'},[
          el('span',{text: bd.name || 'Advanced Count'}),
          jetBadges(Object.keys(bdJets))
        ]);

        const bdMeta = el('div',{class:'bdMeta'},[
          el('span',{text:`${fmt(s.current)} / ${fmt(bdTarget)}`})
        ]);
        if (focus === 'ALL'){
          bdMeta.appendChild(el('button',{
            type:'button',
            class:'iconBtn',
            text: collapsed ? '▸' : '▾',
            onclick:()=>{ toggleBdCollapsed(id, bd.id); render(); }
          }));
        }

        bdBox.appendChild(el('div',{class:'breakdownHeader'},[bdTitle, bdMeta]));

        const bdBarWrap = el('div',{class:`barWrap ${bdDiff>0?'barOver':''}`});
        const bdBarFill = el('div',{class:'barFill'});
        bdBarFill.style.width = (pct(s.current, bdTarget)*100).toFixed(0)+'%';
        bdBarWrap.appendChild(bdBarFill);
        bdBox.appendChild(bdBarWrap);

        if (!collapsed){
          const innerJets = el('div',{class:'jets'});

          for (const [jetName, data] of Object.entries(bdJets)){
            if (focus !== 'ALL' && jetName !== focus) continue;

            const currentVal = n(data.current);
            const targetVal = n(data.target);
            const st = statusFor(currentVal, targetVal);

            const row = el('div',{class:'jetRow'});

            const pill2 = statusPillText(currentVal, targetVal);
            row.appendChild(el('div',{class:'jetHeader'},[
              el('div',{class:'jetName',text:jetName}),
              el('div',{class:'jetMeta'},[
                el('span',{class:'jetTargetLabel',text:`Target ${fmt(targetVal)}`} ),
                el('span',{class:pill2.cls, text:pill2.text})
              ])
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
              el('div',{class:'max',text:''})
            ]));

            innerJets.appendChild(row);
          }

          bdBox.appendChild(innerJets);
        }

        card.appendChild(bdBox);
      }

      if (!renderedAny){
        card.appendChild(el('div',{class:'collapsedNote',text:'No breakdowns match this focus.'}));
      }

      container.appendChild(card);
      continue;
    }

    // No-breakdown mode
    const jetsWrap2 = el('div',{class:'jets'});
    for (const [jetName, data] of Object.entries(tracker.jets || {})){
      if (focus !== 'ALL' && jetName !== focus) continue;

      const currentVal = n(data.current);
      const targetVal = n(data.target);
      const st = statusFor(currentVal, targetVal);

      const row = el('div',{class:'jetRow'});

      const pill2 = statusPillText(currentVal, targetVal);
      row.appendChild(el('div',{class:'jetHeader'},[
        el('div',{class:'jetName',text:jetName}),
        el('div',{class:'jetMeta'},[
          el('span',{class:'jetTargetLabel',text:`Target ${fmt(targetVal)}`} ),
          el('span',{class:pill2.cls, text:pill2.text})
        ])
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
        el('div',{class:'max',text:''})
      ]));

      jetsWrap2.appendChild(row);
    }

    card.appendChild(jetsWrap2);
    container.appendChild(card);
  }

  t.sizeTo(document.body);

  if (pendingSave){
    // Save updated checklist names without re-rendering.
    try{ await saveTrackers(pendingSave); }catch{ /* ignore */ }
  }
}

t.render(async () => {
  const btn = document.getElementById('addTrackerBtn');
  if (btn){
    btn.onclick = async () => { await openCreateModal(); await render(); };
  }
  await render();
});

window.addEventListener('focus', () => render());
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
