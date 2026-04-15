/* ═══════════════════════════════════════════════════════════
   STIR PRO DASHBOARD — app.js  (v2 – fully corrected)
═══════════════════════════════════════════════════════════ */
'use strict';

// ─── 1. DATA PREP ───────────────────────────────────────────
const MP_DATA  = [...RAW_MEETING_PREMIUMS].sort((a,b)=>a.date.localeCompare(b.date));
const SR3_DATA = [...RAW_SR3_DATA].sort((a,b)=>a.date.localeCompare(b.date));
const CAL_DATA = [...RAW_FED_CALENDAR];

const MP_BY_DATE  = {}; MP_DATA.forEach(r=>{ MP_BY_DATE[r.date]=r; });
const SR3_BY_DATE = {}; SR3_DATA.forEach(r=>{ SR3_BY_DATE[r.date]=r; });

// All 2025-onwards trading dates in the MP dataset
const DATES_2025_ON = MP_DATA.map(r=>r.date).filter(d=>d>='2025-01-01');

// Fed calendar keyed by ISO date
const CAL_BY_DATE = {};
CAL_DATA.forEach(ev=>{
  const d = parseCalDate(ev.date);
  if (!d) return;
  if (!CAL_BY_DATE[d]) CAL_BY_DATE[d]=[];
  CAL_BY_DATE[d].push(ev);
});

// FOMC fast lookup
const FOMC_DATE_SET = new Set(FOMC_MEETINGS.map(f=>f.date));
const FOMC_BY_DATE  = {};
FOMC_MEETINGS.forEach(f=>{ FOMC_BY_DATE[f.date]=f; });

// ─── 2. STATE ────────────────────────────────────────────────
const STATE = {
  sliderIdx:    DATES_2025_ON.length - 1,
  stepMode:     'day',
  activeTab:    'masterView',
  refDate:      '2025-01-02',
  cutsHikeHalf: 'full',
  evFilter:     'all',
  evFrom:       '2025-01-01',
  evTo:         '2025-04-22',
  trades:       [],          // [{id,type,leg1,leg2,side,lots,entryDate,entryPrice,label,dv01}]
  tradeNextId:  1,
  tbSide:       'buy',       // 'buy' | 'sell'
};

// ─── TRADE HELPERS ───────────────────────────────────────────
function getDV01(type) {
  // DV01 per lot per 1 bps move (CME contract specs)
  if (type === 'meeting_prem')    return 41.67;  // ZQ 30-Day Fed Funds
  if (type === 'meeting_spread')  return 41.67;  // ZQ spread
  if (type === 'sr3_spread')      return 25.00;  // SR3 3M SOFR
  if (type === 'sr3_outright')    return 25.00;  // SR3 outright (same DV01)
  return 25;
}

function getTradePrice(type, leg1, leg2, dateStr) {
  if (type === 'meeting_prem') {
    const mp = getMPForDate(dateStr);
    return mp[leg1] != null ? mp[leg1].premium : null;
  }
  if (type === 'meeting_spread') {
    const mp = getMPForDate(dateStr);
    const p1 = mp[leg1] ? mp[leg1].premium : null;
    const p2 = mp[leg2] ? mp[leg2].premium : null;
    return (p1 != null && p2 != null) ? p2 - p1 : null;
  }
  if (type === 'sr3_spread') {
    const row = getSR3Row(dateStr);
    if (!row) return null;
    const p1 = row[`sra${leg1+1}`];
    const p2 = row[`sra${leg2+1}`];
    if (p1 == null || p2 == null) return null;
    return -(p2 - p1) * 100;  // bps, neg = cut priced in
  }
  if (type === 'sr3_outright') {
    const row = getSR3Row(dateStr);
    if (!row) return null;
    const p = row[`sra${leg1+1}`];
    return (p != null && !isNaN(p)) ? +p : null;  // raw futures price e.g. 95.5675
  }
  return null;
}

function buildTradeLabel(type, v1, v2) {
  const d = currentDate();
  if (type === 'meeting_prem') {
    const mp  = getMPForDate(d);
    const idx = mp.findIndex(x => x.meeting.date === v1);
    const m   = idx>=0 ? mp[idx].meeting : null;
    return m ? `FED${idx+1} · ${m.label}` : (v1||'—');
  }
  if (type === 'meeting_spread') {
    const mp  = getMPForDate(d);
    const i1  = mp.findIndex(x => x.meeting.date === v1);
    const i2  = mp.findIndex(x => x.meeting.date === v2);
    const l1  = i1>=0 ? `FED${i1+1} (${mp[i1].meeting.label})` : (v1||'?');
    const l2  = i2>=0 ? `FED${i2+1} (${mp[i2].meeting.label})` : (v2||'?');
    return `LONG ${l1}  /  SHORT ${l2}`;
  }
  if (type === 'sr3_outright') return (v1||'').replace('SR3 ','') + ' Outright';
  if (type === 'sr3_spread')   return `${(v1||'').replace('SR3 ','')} → ${(v2||'').replace('SR3 ','')}`;
  return '—';
}

let CHARTS = {};   // keyed by name

// ─── 3. UTILITIES ────────────────────────────────────────────
function fmt(v, dp=2) {
  if (v==null||isNaN(v)) return '—';
  return Number(v).toFixed(dp);
}
function fmtDelta(v) {
  if (v==null||isNaN(v)) return '—';
  return (v>=0?'+':'')+Number(v).toFixed(2);
}
function colorClass(v) {
  if (v==null||isNaN(v)) return 'val-na';
  if (v> 0.005) return 'val-pos';
  if (v<-0.005) return 'val-neg';
  return 'val-zero';
}
function parseCalDate(str) {
  if (!str) return null;
  const m = str.match(/\w+,\s+(\w+)\s+(\d+),\s+(\d+)/);
  if (!m) return null;
  const mo = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
              July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'}[m[1]];
  if (!mo) return null;
  return `${m[3]}-${mo}-${m[2].padStart(2,'0')}`;
}
function fmtDateDisplay(d) {
  if (!d) return '—';
  const dt = new Date(d+'T12:00:00Z');
  return dt.toLocaleDateString('en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
}
function nextBizDay(d) {
  const dt = new Date(d+'T12:00:00Z');
  do { dt.setUTCDate(dt.getUTCDate()+1); } while ([0,6].includes(dt.getUTCDay()));
  return dt.toISOString().slice(0,10);
}
function prevTradingDate(fromDate) {
  const idx = DATES_2025_ON.indexOf(fromDate);
  if (idx > 0) return DATES_2025_ON[idx-1];
  const allIdx = MP_DATA.findIndex(r=>r.date===fromDate);
  return allIdx > 0 ? MP_DATA[allIdx-1].date : null;
}
function currentDate() {
  return DATES_2025_ON[Math.min(STATE.sliderIdx, DATES_2025_ON.length-1)];
}
function destroyChart(name) {
  if (CHARTS[name]) { try { CHARTS[name].destroy(); } catch(e){} delete CHARTS[name]; }
}

// ─── 4. CHART DEFAULT OPTIONS ─────────────────────────────
const BASE_CHART_OPTS = {
  animation: { duration:250 },
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels:{ color:'#9ba3c7', font:{family:"'Segoe UI',system-ui,sans-serif",size:11}, boxWidth:12, boxHeight:12, padding:14 } },
    tooltip: {
      backgroundColor:'rgba(12,16,30,0.97)',
      borderColor:'rgba(79,141,255,0.3)',
      borderWidth:1,
      titleColor:'#e8eaf6',
      bodyColor:'#9ba3c7',
      padding:10
    }
  },
  scales: {
    x: { ticks:{color:'#5a6385',font:{size:10}}, grid:{color:'rgba(80,100,180,0.09)'} },
    y: { ticks:{color:'#5a6385',font:{size:10}}, grid:{color:'rgba(80,100,180,0.09)'} }
  }
};

// Month-label plugin — draws month abbreviations below the x-axis tick labels
const MONTH_LABEL_PLUGIN = {
  id: 'monthLabels',
  afterDraw(chart, args, opts) {
    if (!opts || !opts.months) return;
    const months = opts.months;
    const ctx    = chart.ctx;
    const xAxis  = chart.scales.x;
    if (!xAxis) return;
    const ticks  = xAxis.ticks;
    ctx.save();
    ctx.font      = '600 9px \'Segoe UI\', sans-serif';
    ctx.fillStyle = 'rgba(90,99,133,0.85)';
    ctx.textAlign = 'center';
    ticks.forEach((tick, i) => {
      const m = months[tick.value] || months[i];
      if (!m) return;
      const x = xAxis.getPixelForTick(i);
      const y = xAxis.bottom + 14;
      ctx.fillText(m, x, y);
    });
    ctx.restore();
  }
};
Chart.register(MONTH_LABEL_PLUGIN);

// Helper: extract month abbreviation from a FOMC label like 'Jan 2025' or 'March 2025'
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthAbbr(label) {
  if (!label) return '';
  const first = label.split(' ')[0];
  const idx   = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
                  .findIndex(m => m.toLowerCase().startsWith(first.toLowerCase()));
  if (idx >= 0) return MONTH_ABBR[idx];
  // Already abbreviated
  if (MONTH_ABBR.includes(first)) return first;
  return first.slice(0,3);
}

// ─── 4b. KPI SUMMARY BAR ───────────────────────────────────
function updateKPIBar() {
  const d    = currentDate();
  const mpN  = getMPForDate(d);
  const nr   = getNeutralRate(d);
  const ch   = getCutsHikesPerYear(d);

  // 1. Nearest meeting premium
  const firstMP = mpN.length > 0 ? mpN[0].premium : null;

  // 2. Total cumulative cuts from premiums
  let cumBps = 0;
  mpN.forEach(x => { if (x.premium != null) cumBps += x.premium; });

  // 3. Current year cuts from SR3 spread
  const now = new Date();
  const thisYear = now.getFullYear();
  const ch25 = ch && ch[thisYear] ? ch[thisYear].h1 + ch[thisYear].h2 : null;

  // Helper to set chip value + colour
  function setChip(id, val, suffix, negate) {
    const el = document.getElementById(id);
    if (!el) return;
    if (val == null || isNaN(val)) { el.textContent = '—'; el.className = el.className.replace(/kpi-(pos|neg|zero)/g,'') + ' kpi-zero'; return; }
    const v = negate ? -val : val;
    el.textContent = (v >= 0 ? '+' : '') + Number(v).toFixed(1) + (suffix||'');
    el.classList.remove('kpi-pos','kpi-neg','kpi-zero');
    el.classList.add(v > 0.5 ? 'kpi-pos' : v < -0.5 ? 'kpi-neg' : 'kpi-zero');
  }

  setChip('kpi-mp1',   firstMP,  ' bps', false);
  setChip('kpi-cum',   cumBps,   ' bps', true );  // negate: negative cumBps = cuts
  setChip('kpi-nr',    nr,       '%',    false);
  setChip('kpi-ch25',  ch25,     ' bps', true );

  // Blotter P&L chip
  const sepEl  = document.getElementById('kpiBlotterSep');
  const itemEl = document.getElementById('kpiBlotterItem');
  const plEl   = document.getElementById('kpi-blotter-pnl');
  if (STATE.trades.length > 0 && plEl) {
    if (sepEl)  sepEl.style.display  = '';
    if (itemEl) itemEl.style.display = '';
    let tot = 0, valid = false;
    STATE.trades.forEach(t => {
      const cur=getTradeCurrentPrice(t,d);
      if (cur!=null) {
        const toBps=t.type==='sr3_outright'?100:1;
        tot+=(cur-t.entryPrice)*(t.side==='buy'?1:-1)*toBps*t.lots*t.dv01;
        valid=true;
      }
    });
    if (valid) {
      plEl.textContent = (tot >= 0 ? '+$' : '-$') + Math.round(Math.abs(tot)).toLocaleString();
      plEl.className = 'kpi-value ' + (tot > 50 ? 'kpi-pos' : tot < -50 ? 'kpi-neg' : 'kpi-zero');
    } else {
      plEl.textContent = '—'; plEl.className = 'kpi-value kpi-zero';
    }
  } else {
    if (sepEl)  sepEl.style.display  = 'none';
    if (itemEl) itemEl.style.display = 'none';
  }
}

// ─── 5. MEETING PREMIUM HELPERS ──────────────────────────────
function getActiveMeetings(dateStr) {
  return FOMC_MEETINGS.filter(f=>f.date>=dateStr).slice(0,21);
}
function getMPRow(dateStr) {
  return MP_BY_DATE[dateStr] || null;
}
function getMPForDate(dateStr) {
  const row = getMPRow(dateStr);
  if (!row) return [];
  return getActiveMeetings(dateStr).map((m,i)=>({
    meeting: m,
    premium: row[`fed${i+1}`]??null
  }));
}

// ─── 6. SR3 HELPERS ──────────────────────────────────────────
function getSR3Mapping(dateStr) {
  let offset = 0;
  for (let i=0;i<SR3_CONTRACT_SCHEDULE.length;i++) {
    if (SR3_CONTRACT_SCHEDULE[i].expiry < dateStr) offset++;
    else break;
  }
  return SR3_CONTRACT_SCHEDULE.slice(offset);
}
function getSR3Row(dateStr) { return SR3_BY_DATE[dateStr]||null; }

// ─── 7. NEUTRAL RATE & CUTS/HIKES ────────────────────────────
function getNeutralRate(dateStr) {
  const row = getSR3Row(dateStr);
  if (!row) return null;
  let maxP = -Infinity;
  for (let i=1;i<=23;i++) {
    const v = row[`sra${i}`];
    if (v!=null && !isNaN(v) && v>maxP) maxP=v;
  }
  return maxP===-Infinity ? null : +(100-maxP).toFixed(4);
}

function getCutsHikesPerYear(dateStr) {
  const row = getSR3Row(dateStr);
  if (!row) return null;
  const mapping = getSR3Mapping(dateStr);
  const contracts=[];
  for (let i=0;i<Math.min(mapping.length,23);i++) {
    const p = row[`sra${i+1}`];
    if (p==null||isNaN(p)) continue;
    const yr  = parseInt(mapping[i].expiry.slice(0,4));
    const mo  = parseInt(mapping[i].expiry.slice(5,7));
    contracts.push({ price:p, year:yr, half:mo<=6?1:2, contract:mapping[i].contract });
  }
  if (contracts.length<2) return null;
  const out={};
  for (let i=0;i<contracts.length-1;i++) {
    const c0=contracts[i], c1=contracts[i+1];
    const rateChg = -(c1.price-c0.price)*100; // bps, neg=cut
    const yr=c1.year, h=c1.half;
    if (!out[yr]) out[yr]={h1:0,h2:0};
    if (h===1) out[yr].h1+=rateChg;
    else       out[yr].h2+=rateChg;
  }
  return out;
}

// ─── 8. TAB: MEETING PREMIUM CURVE ───────────────────────────
function renderMPTab() {
  const d   = currentDate();
  const ref = STATE.refDate && MP_BY_DATE[STATE.refDate] ? STATE.refDate : null;
  const mpNow = getMPForDate(d);
  const mpRef = ref ? getMPForDate(ref) : null;

  // ─── Day Events Strip ──────────────────────────────────────
  (function renderDayEvents() {
    const evDay = CAL_DATA.filter(ev => parseCalDate(ev.date) === d);
    const dateLbl = document.getElementById('mpEventsDateLbl');
    const countEl = document.getElementById('mpEventsCount');
    const bodyEl  = document.getElementById('mpDayEventsBody');
    if (!dateLbl || !bodyEl) return;

    dateLbl.textContent = fmtDateDisplay(d);

    if (!evDay.length) {
      countEl.textContent = '';
      bodyEl.innerHTML = '<span class="mp-events-empty">No economic events recorded for this date.</span>';
      return;
    }

    countEl.textContent = evDay.length + (evDay.length === 1 ? ' event' : ' events');

    const rows = evDay.map(ev => {
      const sp = surprise(ev);
      const sc = stanceCls(ev.stance);
      const isFomc = !!(ev.event && ev.event.toLowerCase().includes('fomc') ||
                        ev.event && ev.event.toLowerCase().includes('rate decision') ||
                        ev.event && ev.event.toLowerCase().includes('press conference'));
      const isMajor = isKey(ev);
      const rowCls  = isFomc ? 'ev-row-fomc' : isMajor ? 'ev-row-key' : '';
      const evLabel = isFomc
        ? `<strong>${ev.event||''}</strong><span class="fomc-badge">FOMC</span>`
        : isMajor
          ? `<strong>${ev.event||''}</strong>`
          : (ev.event || '—');
      return `<tr class="${rowCls}">
        <td style="color:var(--text-muted);white-space:nowrap">${ev.time||'—'}</td>
        <td style="text-align:left;max-width:280px;white-space:normal;min-width:180px">${evLabel}</td>
        <td style="font-weight:600">${ev.actual||'—'}</td>
        <td>${ev.forecast||'—'}</td>
        <td>${ev.previous||'—'}</td>
        <td class="${sp.cls}" style="font-weight:700">${sp.text}</td>
        <td class="${sc}" style="font-weight:600;white-space:nowrap">${ev.stance||'—'}</td>
      </tr>`;
    }).join('');

    bodyEl.innerHTML = `
      <div class="table-scroll" style="max-height:220px;">
        <table class="data-table" style="font-size:.77rem;">
          <thead><tr>
            <th style="text-align:left">Time</th>
            <th style="text-align:left">Event</th>
            <th>Actual</th><th>Forecast</th><th>Prior</th>
            <th>Surprise</th><th>Stance</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }());

  // Meeting legend
  document.getElementById('mpMeetingLegend').innerHTML =
    mpNow.map((x,i)=>{
      const sep = x.meeting.isSEP;
      return `<div class="ml-item${sep?' sep':''}">
        <span class="ml-dot"></span>FED${i+1} — ${x.meeting.label}${sep?'<span class="sep-badge">SEP</span>':''}
      </div>`;
    }).join('');

  // Chart — show short month + year label and full date in tooltip
  destroyChart('mp');
  const ctx = document.getElementById('mpChart');

  // Build x-axis labels: "Jan '25" style  (month + 2-digit year)
  const labels = mpNow.map(x => {
    const parts = x.meeting.label.split(' ');
    const mo = parts[0] ? parts[0].slice(0,3) : '';
    const yr = parts[1] ? "'" + parts[1].slice(2) : '';
    return `${mo} ${yr}`;
  });

  // Month-only sub-labels for plugin
  const monthsMap = {};
  mpNow.forEach((x,i) => { monthsMap[i] = monthAbbr(x.meeting.label); });

  const datasets = [{
    label:`Premiums — ${d}`,
    data: mpNow.map(x=>x.premium),
    borderColor:'#4f8dff',
    backgroundColor:'rgba(79,141,255,0.11)',
    tension:.35, fill:true,
    pointBackgroundColor: mpNow.map(x=>x.meeting.isSEP?'#f8c744':'#4f8dff'),
    pointRadius: mpNow.map(x=>x.meeting.isSEP?8:5),
    pointHoverRadius:10, borderWidth:2.5
  }];
  if (mpRef && mpRef.length) {
    datasets.push({
      label:`Ref — ${ref}`,
      data: mpRef.slice(0,mpNow.length).map(x=>x.premium),
      borderColor:'rgba(242,205,50,.8)',
      backgroundColor:'rgba(242,205,50,.05)',
      borderDash:[6,4], tension:.35, fill:false,
      pointBackgroundColor:'rgba(242,205,50,.8)',
      pointRadius:4, borderWidth:2
    });
  }
  CHARTS.mp = new Chart(ctx, {
    type:'line',
    data:{labels,datasets},
    options:{
      ...BASE_CHART_OPTS,
      layout: { padding: { bottom: 24 } },
      plugins:{
        ...BASE_CHART_OPTS.plugins,
        monthLabels: { months: monthsMap },
        tooltip:{
          ...BASE_CHART_OPTS.plugins.tooltip,
          callbacks:{
            title: items=>mpNow[items[0].dataIndex]?.meeting?.label||'',
            afterTitle: items=>mpNow[items[0].dataIndex]?.meeting?.isSEP?'◆ SEP Meeting':'',
            label: item=>` ${item.dataset.label.split('—')[0].trim()}: ${fmt(item.raw)} bps`
          }
        }
      },
      scales:{
        x:{
          ...BASE_CHART_OPTS.scales.x,
          ticks:{
            ...BASE_CHART_OPTS.scales.x.ticks,
            maxRotation: 0,
            color:'#7eb3ff',
            font:{ size:10, weight:'600' }
          }
        },
        y:{...BASE_CHART_OPTS.scales.y, title:{display:true,text:'Premium (bps)',color:'#5a6385',font:{size:10}}}
      }
    }
  });

  // Delta table
  const head = document.getElementById('mpDeltaHead');
  const body = document.getElementById('mpDeltaBody');
  head.innerHTML = `<th>Metric</th>`+mpNow.map((x,i)=>{
    const mo = monthAbbr(x.meeting.label);
    return `<th>FED${i+1}<br><small>${mo} ${x.meeting.label.split(' ').slice(-1)[0]||''}</small></th>`;
  }).join('');
  const rows=[
    {label:'Current (bps)', vals:mpNow.map(x=>x.premium)},
    {label:`Ref (${ref||'—'})`, vals:mpRef?mpRef.slice(0,mpNow.length).map(x=>x.premium):mpNow.map(()=>null)},
    {label:'Δ bps', vals:mpNow.map((x,i)=>{
      const rp=mpRef?mpRef[i]?.premium:null;
      return (x.premium!=null&&rp!=null)?x.premium-rp:null;
    }), delta:true}
  ];
  body.innerHTML = rows.map(r=>`<tr><td>${r.label}</td>${
    r.vals.map(v=>{
      if (v==null) return '<td class="val-na">—</td>';
      if (r.delta) return `<td class="${colorClass(v)}">${fmtDelta(v)}</td>`;
      return `<td>${fmt(v)}</td>`;
    }).join('')
  }</tr>`).join('');

  // ─── NEW: SR3 3M Spread Chart & Table in MP Tab ───
  const rowNSr3 = getSR3Row(d);
  const rowRSr3 = ref ? getSR3Row(ref) : null;
  const mapSR3 = getSR3Mapping(d);
  document.getElementById('mpSr3RefLbl').textContent = ref || '—';

  if (rowNSr3) {
    const contractsN=[], contractsR=[];
    for (let i=0;i<Math.min(mapSR3.length,23);i++) {
      const pn=rowNSr3[`sra${i+1}`];
      if (pn!=null&&!isNaN(pn)) {
        const moStr = mapSR3[i].contract.replace('SR3 ','').slice(0,3);
        contractsN.push({lbl:moStr, p:pn});
        if (rowRSr3) {
          const pr=rowRSr3[`sra${i+1}`];
          contractsR.push({lbl:moStr, p:pr!=null&&!isNaN(pr)?pr:null});
        }
      }
    }
    const spreadsN=[], spreadsR=[], spLbl=[];
    const tableData=[];
    for(let i=1; i<contractsN.length; i++) {
        const sn = -(contractsN[i].p - contractsN[i-1].p)*100;
        spreadsN.push(sn);
        const l = `${contractsN[i-1].lbl}→${contractsN[i].lbl}`;
        spLbl.push(l);
        let sr = null;
        if(rowRSr3 && contractsR[i] && contractsR[i-1] && contractsR[i].p!=null && contractsR[i-1].p!=null) {
            sr = -(contractsR[i].p - contractsR[i-1].p)*100;
            spreadsR.push(sr);
        } else {
            if(rowRSr3) spreadsR.push(null);
        }
        tableData.push({
            lbl: l,
            cN: sn, cR: sr,
            delta: sr!=null ? sn-sr : null
        });
    }

    destroyChart('mpSr3');
    const datasetsSr3 = [{
      label: `Current Spread (${d})`, data: spreadsN,
      borderColor:'#00d4aa', backgroundColor:'rgba(0,212,170,.1)',
      fill:true, tension:.3, pointRadius:4, pointHoverRadius:7, borderWidth:2.5
    }];
    if(rowRSr3 && spreadsR.some(x=>x!=null)) {
      datasetsSr3.push({
        label: `Ref Spread (${ref})`, data: spreadsR,
        borderColor:'rgba(242,205,50,.8)', backgroundColor:'rgba(242,205,50,.05)',
        fill:false, tension:.3, borderDash:[6,4], pointRadius:4, borderWidth:2
      });
    }

    CHARTS.mpSr3 = new Chart(document.getElementById('mpSr3SpreadChart'), {
      type:'line', data:{labels:spLbl, datasets:datasetsSr3},
      options:{ ...BASE_CHART_OPTS, layout: { padding: { bottom: 24 } },
        scales:{ x:{...BASE_CHART_OPTS.scales.x, ticks:{...BASE_CHART_OPTS.scales.x.ticks, maxRotation:45, font:{size:9}}},
                 y:{...BASE_CHART_OPTS.scales.y, title:{display:true,text:'bps (neg=cut)',color:'#5a6385',font:{size:10}}} } }
    });

    document.getElementById('mpSr3SpreadBody').innerHTML = tableData.map(r=>`<tr>
      <td>${r.lbl}</td>
      <td class="${colorClass(r.cN)}">${fmt(r.cN)}</td>
      <td>${r.cR!=null?fmt(r.cR):'—'}</td>
      <td class="${r.delta!=null?colorClass(r.delta):'val-na'}">${r.delta!=null?fmtDelta(r.delta):'—'}</td>
    </tr>`).join('');
  } else {
    document.getElementById('mpSr3SpreadBody').innerHTML = '<tr><td colspan="4" style="text-align:center">No SR3 data available</td></tr>';
    destroyChart('mpSr3');
  }

  // ─── NEW: Neutral Rate & Annual Cuts/Hikes ───
  const prev = prevTradingDate(d);
  
  const sr3Dates = SR3_DATA.map(r=>r.date).filter(x=>x<=d).slice(-10);
  let prevNR=null;
  const nrRows = sr3Dates.map(dt=>{
    const nr=getNeutralRate(dt);
    const maxP=nr!=null?+(100-nr).toFixed(5):null;
    const delta=(nr!=null&&prevNR!=null)?+(nr-prevNR).toFixed(4):null;
    const res=`<tr>
      <td>${dt}</td>
      <td>${maxP!=null?fmt(maxP,5):'—'}</td>
      <td>${nr!=null?fmt(nr,3)+'%':'—'}</td>
      <td class="${delta!=null?colorClass(delta):'val-na'}">${delta!=null?fmtDelta(delta)+'%':'—'}</td>
    </tr>`;
    prevNR=nr;
    return res;
  });
  document.getElementById('mpNeutralBody').innerHTML = nrRows.reverse().join('');

  const chNow  = getCutsHikesPerYear(d);
  const chRef  = ref ? getCutsHikesPerYear(ref) : null;
  if (chNow) {
      const years = Object.keys(chNow).map(Number).sort();
      document.getElementById('mpCutsHikesBody').innerHTML = years.map(yr => {
        const n    = chNow[yr];
        const r    = chRef && chRef[yr];
        const full = n.h1 + n.h2;
        const rFull= r ? r.h1 + r.h2 : null;
        const delta= rFull != null ? full - rFull : null;
        const dir  = full < -3 ? '🔽 CUT' : full > 3 ? '🔼 HIKE' : '〰 HOLD';
        return `<tr>
          <td>${yr}</td>
          <td class="${colorClass(-n.h1)}">${fmt(n.h1, 0)} bps</td>
          <td class="${colorClass(-n.h2)}">${fmt(n.h2, 0)} bps</td>
          <td class="${colorClass(-full)}"><strong>${fmt(full, 0)} bps</strong></td>
          <td>${rFull != null ? fmt(rFull, 0) + ' bps' : '—'}</td>
          <td class="${delta != null ? colorClass(-delta) : 'val-na'}">${delta != null ? fmtDelta(-delta) + ' bps' : '—'}</td>
          <td>${dir}</td>
        </tr>`;
      }).join('');
  } else {
      document.getElementById('mpCutsHikesBody').innerHTML = '';
  }

  // ─── Meeting Diff helpers ──────────────────────────────────
  function getFilteredDiffs(filterFn) {
    const mpNFiltered = mpNow.filter(filterFn);
    const diffs = [];
    for (let i = 0; i < mpNFiltered.length - 1; i++) {
      const a = mpNFiltered[i], b = mpNFiltered[i + 1];
      if (a.premium == null || b.premium == null) continue;
      diffs.push({
        fromLabel: a.meeting.label.split(' ').slice(0, 2).join(' '),
        toLabel:   b.meeting.label.split(' ').slice(0, 2).join(' '),
        diff: b.premium - a.premium,
        aIsSEP: a.meeting.isSEP, bIsSEP: b.meeting.isSEP
      });
    }
    return diffs;
  }

  function tbDiff(id, data) {
    document.getElementById(id).innerHTML = data.map(row => `<tr>
      <td>${row.fromLabel}${row.aIsSEP ? '<span class="sep-badge">SEP</span>' : ''}</td>
      <td>${row.toLabel}${row.bIsSEP ? '<span class="sep-badge">SEP</span>' : ''}</td>
      <td class="${colorClass(row.diff)}">${fmt(row.diff, 1)} bps</td>
    </tr>`).join('');
  }

  const allIdxDiffs = [];
  for (let i = 0; i < mpNow.length - 1; i++) {
    const a = mpNow[i], b = mpNow[i + 1];
    if (a.premium == null || b.premium == null) continue;
    if (a.meeting.isSEP !== b.meeting.isSEP) {
      allIdxDiffs.push({
        fromLabel: a.meeting.label.split(' ').slice(0, 2).join(' '),
        toLabel:   b.meeting.label.split(' ').slice(0, 2).join(' '),
        diff: b.premium - a.premium,
        aIsSEP: a.meeting.isSEP, bIsSEP: b.meeting.isSEP
      });
    }
  }

  const qqDiffs    = getFilteredDiffs(x => x.meeting.isSEP).slice(0, 12);
  const nqDiffs    = getFilteredDiffs(x => !x.meeting.isSEP).slice(0, 12);
  const mixedDiffs = allIdxDiffs.slice(0, 12);

  tbDiff('mpQqBody',    qqDiffs);
  tbDiff('mpQnqBody',   nqDiffs);
  tbDiff('mpMixedBody', mixedDiffs);

  // ─── Diff bar charts (green=positive, red=negative) ────────
  function renderDiffBarChart(canvasId, diffs) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !diffs.length) return;
    const values = diffs.map(row => +row.diff.toFixed(2));
    const colors  = values.map(v => v >= 0 ? 'rgba(52,211,153,0.75)' : 'rgba(251,113,133,0.75)');
    const borderC = values.map(v => v >= 0 ? '#34d399' : '#fb7185');
    CHARTS[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: diffs.map(row => `${row.fromLabel}\u2192${row.toLabel}`),
        datasets: [{ data: values, backgroundColor: colors, borderColor: borderC,
                     borderWidth: 1.5, borderRadius: 3 }]
      },
      options: {
        ...BASE_CHART_OPTS,
        layout: { padding: { top: 4, bottom: 4 } },
        plugins: {
          ...BASE_CHART_OPTS.plugins,
          legend: { display: false },
          tooltip: { ...BASE_CHART_OPTS.plugins.tooltip,
                     callbacks: { label: item => ` ${fmtDelta(item.raw)} bps` } }
        },
        scales: {
          x: { ...BASE_CHART_OPTS.scales.x,
               ticks: { ...BASE_CHART_OPTS.scales.x.ticks, maxRotation: 45, font: { size: 9 } } },
          y: { ...BASE_CHART_OPTS.scales.y,
               title: { display: true, text: 'bps', color: '#5a6385', font: { size: 10 } } }
        }
      }
    });
  }

  renderDiffBarChart('mpQqChart',    qqDiffs);
  renderDiffBarChart('mpQnqChart',   nqDiffs);
  renderDiffBarChart('mpMixedChart', mixedDiffs);
}


// ─── 9. TAB: SR3 CURVE ───────────────────────────────────────
function renderSR3Tab() {
  const d    = currentDate();
  const prev = prevTradingDate(d);
  const rowN = getSR3Row(d);
  const rowP = prev ? getSR3Row(prev) : null;
  const map  = getSR3Mapping(d);

  if (!rowN) {
    document.getElementById('sr3MappingBody').innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No SR3 data for this date</td></tr>';
    return;
  }

  // Build contract list
  const contracts=[];
  for (let i=0;i<Math.min(map.length,23);i++) {
    const key=`sra${i+1}`;
    const price=rowN[key];
    if (price==null||isNaN(price)) continue;
    const pP=rowP?rowP[key]:null;
    // Extract month abbr from contract label e.g. "SR3 Mar25" -> "Mar"
    const raw   = map[i].contract.replace('SR3 ','');  // e.g. "Mar25"
    const moStr = raw.slice(0,3);
    contracts.push({
      label:   raw,
      monthLbl: moStr,
      contract:map[i].contract,
      expiry:map[i].expiry,
      price, rate:+(100-price).toFixed(4),
      delta:pP!=null?(price-pP)*100:null
    });
  }

  // Build month-map for SR3 outright
  const sr3MonthsMap = {};
  contracts.forEach((c,i) => { sr3MonthsMap[i] = c.monthLbl; });

  // Labels
  document.getElementById('sr3OutrightDateLabel').textContent=d;
  document.getElementById('sr3SpreadDateLabel').textContent=d;

  // Outright chart
  destroyChart('sr3Out');
  CHARTS.sr3Out = new Chart(document.getElementById('sr3OutrightChart'),{
    type:'line',
    data:{
      labels:contracts.map(c=>c.label),
      datasets:[{
        label:'SR3 Price',
        data:contracts.map(c=>c.price),
        borderColor:'#7b5cf0',
        backgroundColor:'rgba(123,92,240,.1)',
        fill:true,tension:.3,
        pointRadius:4,pointHoverRadius:7,borderWidth:2.5
      }]
    },
    options:{
      ...BASE_CHART_OPTS,
      layout: { padding: { bottom: 24 } },
      plugins:{
        ...BASE_CHART_OPTS.plugins,
        monthLabels: { months: sr3MonthsMap },
        tooltip:{
          ...BASE_CHART_OPTS.plugins.tooltip,
          callbacks:{label:item=>{
            const c=contracts[item.dataIndex];
            return [` Price: ${fmt(c.price,4)}`,` Rate: ${fmt(c.rate,4)}%`,
                    ` DoD: ${c.delta!=null?fmtDelta(c.delta/100)+' bps':'—'}`];
          }}
        }
      },
      scales:{
        x:{
          ...BASE_CHART_OPTS.scales.x,
          ticks:{ ...BASE_CHART_OPTS.scales.x.ticks, maxRotation:0, color:'#a78bfa', font:{size:10,weight:'600'} }
        },
        y:{...BASE_CHART_OPTS.scales.y,title:{display:true,text:'Price',color:'#5a6385',font:{size:10}}}
      }
    }
  });

  // 3M Spread chart
  const spreads=[], spreadLabels=[], spreadMonths={};
  for (let i=1;i<contracts.length;i++) {
    spreads.push(-(contracts[i].price-contracts[i-1].price)*100);
    spreadLabels.push(`${contracts[i-1].monthLbl}→${contracts[i].monthLbl}`);
    spreadMonths[i-1] = contracts[i].monthLbl;
  }
  destroyChart('sr3Sprd');
  CHARTS.sr3Sprd = new Chart(document.getElementById('sr3SpreadChart'),{
    type:'line',
    data:{
      labels:spreadLabels,
      datasets:[{
        label:'3M Rate Change (bps)',
        data:spreads,
        backgroundColor:'rgba(0,212,170,.1)',
        borderColor:'#00d4aa',
        fill:true, tension:.3, pointRadius:4, pointHoverRadius:7, borderWidth:2.5
      }]
    },
    options:{
      ...BASE_CHART_OPTS,
      plugins:{...BASE_CHART_OPTS.plugins,
        tooltip:{...BASE_CHART_OPTS.plugins.tooltip,
          callbacks:{label:item=>` ${item.raw<0?'Cut':'Hike'}: ${fmtDelta(item.raw)} bps`}
        }
      },
      scales:{
        x:{...BASE_CHART_OPTS.scales.x,ticks:{...BASE_CHART_OPTS.scales.x.ticks,maxRotation:45,font:{size:9}}},
        y:{...BASE_CHART_OPTS.scales.y,title:{display:true,text:'bps (neg=cut)',color:'#5a6385',font:{size:10}}}
      }
    }
  });

  // Mapping table
  document.getElementById('sr3MappingBody').innerHTML = contracts.map((c,i)=>`<tr>
    <td>SRA${i+1}</td>
    <td><strong>${c.contract}</strong></td>
    <td>${c.expiry}</td>
    <td>${fmt(c.price,5)}</td>
    <td>${fmt(c.rate,4)}%</td>
    <td class="${c.delta!=null?colorClass(c.delta/100):'val-na'}">${c.delta!=null?fmtDelta(c.delta)+' bps':'—'}</td>
  </tr>`).join('');
}

// ─── 10. TAB: ZQ CURVE ───────────────────────────────────────
function renderZQTab() {
  const d   = currentDate();
  const mpN = getMPForDate(d);

  // Derive ZQ curve: start from Jan 29 2025 hold (4.375% mid)
  const BASE = 4.375;
  const zqItems=[];
  let cum=0;
  mpN.forEach((x,i)=>{
    if (x.premium==null) return;
    cum += x.premium;
    const parts = x.meeting.label.split(' ');
    const mo = parts[0] ? parts[0].slice(0,3) : '';
    const yr = parts[1] ? "'" + parts[1].slice(2) : '';
    const r  = BASE - cum/100;
    zqItems.push({
      label:    `${mo} ${yr}`,
      monthLbl: monthAbbr(x.meeting.label),
      impliedRate: +r.toFixed(4),
      zqPrice:     +(100-r).toFixed(4),
      cumPrem:     +(-cum).toFixed(2)
    });
  });

  const zqMonthsMap = {};
  zqItems.forEach((item,i) => { zqMonthsMap[i] = item.monthLbl; });

  destroyChart('zq');
  CHARTS.zq = new Chart(document.getElementById('zqChart'),{
    type:'line',
    data:{
      labels: zqItems.map(x=>x.label),
      datasets:[
        {
          label:'ZQ Price (100−EFFR)',
          data:zqItems.map(x=>x.zqPrice),
          borderColor:'#fb923c',
          backgroundColor:'rgba(251,146,60,.1)',
          fill:true,tension:.3,
          pointRadius:5,pointHoverRadius:8,borderWidth:2.5,
          yAxisID:'y1'
        },
        {
          label:'Implied EFFR (%)',
          data:zqItems.map(x=>x.impliedRate),
          borderColor:'#4f8dff',
          backgroundColor:'rgba(79,141,255,.06)',
          fill:false,tension:.3,borderDash:[5,3],
          pointRadius:4,pointHoverRadius:7,borderWidth:2,
          yAxisID:'y2'
        }
      ]
    },
    options:{
      ...BASE_CHART_OPTS,
      layout: { padding: { bottom: 24 } },
      plugins:{
        ...BASE_CHART_OPTS.plugins,
        monthLabels: { months: zqMonthsMap }
      },
      scales:{
        x:{
          ...BASE_CHART_OPTS.scales.x,
          ticks:{ ...BASE_CHART_OPTS.scales.x.ticks, maxRotation:0, color:'#fb923c', font:{size:10,weight:'600'} }
        },
        y1:{type:'linear',position:'left',
            ticks:{color:'#fb923c',font:{size:10}},
            grid:{color:'rgba(80,100,180,.09)'},
            title:{display:true,text:'ZQ Price',color:'#fb923c',font:{size:10}}},
        y2:{type:'linear',position:'right',
            ticks:{color:'#4f8dff',font:{size:10}},
            grid:{drawOnChartArea:false},
            title:{display:true,text:'EFFR %',color:'#4f8dff',font:{size:10}}}
      }
    }
  });

  // ZQ table
  let cumBps2=0;
  document.getElementById('zqBody').innerHTML = mpN.map((x,i)=>{
    if (x.premium==null) return `<tr><td>FED${i+1}</td><td>${x.meeting.label}</td><td>${x.meeting.isSEP?'<span class="sep-badge">SEP</span>':'—'}</td><td class="val-na">—</td><td class="val-na">—</td><td class="val-na">—</td></tr>`;
    cumBps2+=x.premium;
    const ir=BASE-cumBps2/100;
    return `<tr>
      <td>FED${i+1}</td>
      <td>${x.meeting.label}</td>
      <td>${x.meeting.isSEP?'<span class="sep-badge">SEP</span>':'—'}</td>
      <td class="${colorClass(x.premium)}">${fmt(x.premium)} bps</td>
      <td class="${colorClass(-cumBps2)}">${fmt(-cumBps2,1)} bps</td>
      <td>${fmt(ir,3)}%</td>
    </tr>`;
  }).join('');
}

// ─── 11. TAB: NEUTRAL RATE & CUTS/HIKES ──────────────────────
function renderNRTab() {
  const d     = currentDate();
  const prev  = prevTradingDate(d);

  // Neutral rate rolling table (last 30 SR3 dates up to current)
  const sr3Dates = SR3_DATA.map(r=>r.date).filter(x=>x<=d).slice(-30);
  let prevNR=null;
  document.getElementById('neutralBody').innerHTML = sr3Dates.map(dt=>{
    const nr=getNeutralRate(dt);
    const maxP=nr!=null?+(100-nr).toFixed(5):null;
    const delta=(nr!=null&&prevNR!=null)?+(nr-prevNR).toFixed(4):null;
    const res=`<tr>
      <td>${dt}</td>
      <td>${maxP!=null?fmt(maxP,5):'—'}</td>
      <td>${nr!=null?fmt(nr,3)+'%':'—'}</td>
      <td class="${delta!=null?colorClass(delta):'val-na'}">${delta!=null?fmtDelta(delta)+'%':'—'}</td>
    </tr>`;
    prevNR=nr;
    return res;
  }).join('');
  document.querySelector('.neutral-scroll').scrollTop=99999;

  // Cuts/Hikes
  document.getElementById('cutsHikesDate').textContent=d;
  const chNow  = getCutsHikesPerYear(d);
  const chPrev = prev ? getCutsHikesPerYear(prev) : null;
  if (!chNow) return;

  const years=Object.keys(chNow).map(Number).sort();
  document.getElementById('cutsHikesBody').innerHTML = years.map(yr=>{
    const n=chNow[yr];
    const full=n.h1+n.h2;
    const dir=full<-3?'🔽 CUT':full>3?'🔼 HIKE':'〰 HOLD';
    return `<tr>
      <td>${yr}</td>
      <td class="${colorClass(-n.h1)}">${fmt(n.h1,0)} bps</td>
      <td class="${colorClass(-n.h2)}">${fmt(n.h2,0)} bps</td>
      <td class="${colorClass(-full)}"><strong>${fmt(full,0)} bps</strong></td>
      <td>${dir}</td>
    </tr>`;
  }).join('');

  // Bar chart
  destroyChart('ch');
  CHARTS.ch = new Chart(document.getElementById('cutsHikesChart'),{
    type:'bar',
    data:{
      labels:years.map(String),
      datasets:[
        {label:'H1',data:years.map(yr=>chNow[yr].h1),backgroundColor:'rgba(79,141,255,.65)',borderRadius:4},
        {label:'H2',data:years.map(yr=>chNow[yr].h2),backgroundColor:'rgba(123,92,240,.65)',borderRadius:4}
      ]
    },
    options:{
      ...BASE_CHART_OPTS,
      scales:{
        x:{...BASE_CHART_OPTS.scales.x},
        y:{...BASE_CHART_OPTS.scales.y,title:{display:true,text:'bps (neg=cuts)',color:'#5a6385',font:{size:10}}}
      }
    }
  });

  // DoD table
  document.getElementById('dodLabel').textContent=`${prev||'—'} → ${d}`;
  document.getElementById('dodBody').innerHTML = years.map(yr=>{
    const n=chNow[yr]; const p=(chPrev&&chPrev[yr])||{h1:0,h2:0};
    const dH1=n.h1-p.h1, dH2=n.h2-p.h2, dF=(n.h1+n.h2)-(p.h1+p.h2);
    return `<tr>
      <td>${yr}</td>
      <td>${fmt(p.h1,0)}</td><td>${fmt(n.h1,0)}</td><td class="${colorClass(-dH1)}">${fmtDelta(dH1)}</td>
      <td>${fmt(p.h2,0)}</td><td>${fmt(n.h2,0)}</td><td class="${colorClass(-dH2)}">${fmtDelta(dH2)}</td>
      <td>${fmt(p.h1+p.h2,0)}</td><td>${fmt(n.h1+n.h2,0)}</td>
      <td class="${colorClass(-dF)}"><strong>${fmtDelta(dF)}</strong></td>
    </tr>`;
  }).join('');
}

// ─── 12. TAB: MEETING DIFFERENCES ────────────────────────────
function renderDiffTab() {
  const d    = currentDate();
  const prev = prevTradingDate(d);

  function getFilteredDiffs(isSep) {
    const mpN = getMPForDate(d).filter(x => x.meeting.isSEP === isSep);
    const mpP = prev ? getMPForDate(prev).filter(x => x.meeting.isSEP === isSep) : null;
    const diffs = [];
    for (let i=0; i<mpN.length-1; i++) {
      const a=mpN[i], b=mpN[i+1];
      if (a.premium==null||b.premium==null) continue;
      const diff=b.premium-a.premium;
      let prevDiff = null;
      if (mpP) {
        const pA = mpP.find(x=>x.meeting.label===a.meeting.label);
        const pB = mpP.find(x=>x.meeting.label===b.meeting.label);
        if (pA&&pB&&pA.premium!=null&&pB.premium!=null) prevDiff = pB.premium-pA.premium;
      }
      diffs.push({
        fromLabel:`${a.meeting.label.split(' ').slice(0,2).join(' ')}`,
        toLabel:`${b.meeting.label.split(' ').slice(0,2).join(' ')}`,
        diff, prevDiff, delta: prevDiff!=null?diff-prevDiff:null,
        type: isSep?'SEP→SEP':'Non-SEP→Non-SEP',
        aIsSEP:a.meeting.isSEP, bIsSEP:b.meeting.isSEP
      });
    }
    return diffs;
  }

  const qqDiffs  = getFilteredDiffs(true);
  const qnqDiffs = getFilteredDiffs(false);

  function buildTable(tbodyId, data) {
    document.getElementById(tbodyId).innerHTML = data.map(d=>`<tr>
      <td>${d.fromLabel}${d.aIsSEP?'<span class="sep-badge">SEP</span>':''}</td>
      <td>${d.toLabel}${d.bIsSEP?'<span class="sep-badge">SEP</span>':''}</td>
      <td class="${colorClass(d.diff)}">${fmt(d.diff)} bps</td>
      <td>${d.prevDiff!=null?fmt(d.prevDiff):'—'}</td>
      <td class="${d.delta!=null?colorClass(d.delta):'val-na'}">${d.delta!=null?fmtDelta(d.delta):'—'}</td>
      <td><span style="font-size:.68rem;color:var(--text-muted)">${d.type}</span></td>
    </tr>`).join('');
  }

  buildTable('qqBody',  qqDiffs.slice(0,6));
  buildTable('qnqBody', qnqDiffs.slice(0,6));

  const allDiffs = [...qqDiffs, ...qnqDiffs];

  destroyChart('diff');
  CHARTS.diff = new Chart(document.getElementById('diffChart'),{
    type:'bar',
    data:{
      labels:allDiffs.slice(0,10).map(d=>d.fromLabel.split(' ')[0]+'→'+d.toLabel.split(' ')[0]),
      datasets:[
        {label:`Diff ${d}`,
         data:allDiffs.slice(0,10).map(x=>x.diff),
         backgroundColor:allDiffs.slice(0,10).map(x=>x.diff<0?'rgba(34,197,94,.55)':'rgba(239,68,68,.55)'),
         borderRadius:3},
        ...(prev?[{label:`Diff ${prev}`,
          data:allDiffs.slice(0,10).map(x=>x.prevDiff),
          backgroundColor:'rgba(156,163,199,.22)',
          borderColor:'rgba(156,163,199,.45)',borderWidth:1.5,borderRadius:3}]:[])
      ]
    },
    options:{
      ...BASE_CHART_OPTS,
      scales:{
        x:{...BASE_CHART_OPTS.scales.x,ticks:{...BASE_CHART_OPTS.scales.x.ticks,maxRotation:55}},
        y:{...BASE_CHART_OPTS.scales.y,title:{display:true,text:'Δ bps',color:'#5a6385',font:{size:10}}}
      }
    }
  });
}

// ─── 13. TAB: EVENTS ─────────────────────────────────────────
const KEY_EV=['Nonfarm','CPI','PCE','GDP','FOMC','Powell','Rate Decision','ISM Manufacturing PMI',
              'ISM Non-Manufacturing PMI','JOLTS','ADP Nonfarm','Retail Sales','Initial Jobless',
              'Jackson Hole','dot plot'];
function isKey(ev){ return KEY_EV.some(k=>ev.event&&ev.event.toLowerCase().includes(k.toLowerCase())); }
function stanceCls(s){
  if(!s) return '';
  const l=s.toLowerCase();
  return l.includes('hawkish')?'stance-hawkish':l.includes('dovish')?'stance-dovish':l.includes('neutral')?'stance-neutral':'';
}
function surprise(ev){
  const a=parseFloat(String(ev.actual||'').replace(/[^0-9.\-]/g,''));
  const f=parseFloat(String(ev.forecast||'').replace(/[^0-9.\-]/g,''));
  if(isNaN(a)||isNaN(f)) return{text:'—',cls:''};
  const d=a-f;
  if(Math.abs(d)<0.001) return{text:'In-Line',cls:'surprise-in-line'};
  const beat=d>0;
  return{text:beat?`Beat +${Math.abs(d).toFixed(2)}`:`Miss −${Math.abs(d).toFixed(2)}`,
         cls:beat?'surprise-beat':'surprise-miss'};
}

function renderEventsTab(){
  const flt = STATE.evFilter;
  const frm = STATE.evFrom;
  const to  = STATE.evTo;
  const data = CAL_DATA.filter(ev=>{
    const dt=parseCalDate(ev.date);
    if(!dt||dt<frm||dt>to) return false;
    if(flt==='all')     return true;
    if(flt==='fomc')    return !!(ev.stance||(ev.event&&ev.event.toLowerCase().includes('fomc')));
    if(flt==='keydata') return isKey(ev);
    if(flt==='hawkish') return !!(ev.stance&&ev.stance.toLowerCase().includes('hawkish'));
    if(flt==='dovish')  return !!(ev.stance&&ev.stance.toLowerCase().includes('dovish'));
    return true;
  });
  const fomc_ev = ev=>!!(ev.event&&ev.event.toLowerCase().includes('fomc'));
  document.getElementById('eventsBody').innerHTML = data.map(ev=>{
    const dt=parseCalDate(ev.date)||'';
    const sp=surprise(ev);
    const sc=stanceCls(ev.stance);
    const isFomc=fomc_ev(ev);
    const isMajor=isKey(ev);
    const bg=isFomc?'style="background:rgba(245,158,11,.04)"':isMajor?'style="background:rgba(79,141,255,.04)"':'';
    const evLabel=isFomc?`<strong>${ev.event||''}</strong><span class="fomc-badge">FOMC</span>`:
                  isMajor?`<strong>${ev.event||''}</strong>`:(ev.event||'');
    return `<tr ${bg}>
      <td>${dt}</td>
      <td style="font-size:.72rem;color:var(--text-muted)">${ev.time||'—'}</td>
      <td style="text-align:left;max-width:260px;white-space:normal">${evLabel}</td>
      <td>${ev.actual||'—'}</td>
      <td>${ev.forecast||'—'}</td>
      <td>${ev.previous||'—'}</td>
      <td class="${sp.cls}">${sp.text}</td>
      <td class="${sc}">${ev.stance||'—'}</td>
    </tr>`;
  }).join('');
}

// ─── 13b. TAB: MASTER VIEW ──────────────────────────────────────
function renderMasterTab() {
  const d    = currentDate();
  const prev = prevTradingDate(d);
  
  document.getElementById('masterSr3DateLabel').textContent = d;
  document.getElementById('masterZqDateLabel').textContent = d;

  // ---------- 1. SR3 Spread Curve ----------
  const rowN = getSR3Row(d);
  const map  = getSR3Mapping(d);
  
  if (rowN) {
    const contracts=[];
    for (let i=0;i<Math.min(map.length,23);i++) {
      const p=rowN[`sra${i+1}`];
      if (p==null||isNaN(p)) continue;
      const moStr = map[i].contract.replace('SR3 ','').slice(0,3);
      contracts.push({ label: moStr, monthLbl: moStr, price: p });
    }
    const spreads=[], spreadLabels=[];
    for (let i=1;i<contracts.length;i++) {
      spreads.push(-(contracts[i].price-contracts[i-1].price)*100);
      spreadLabels.push(`${contracts[i-1].monthLbl}→${contracts[i].monthLbl}`);
    }
    destroyChart('masterSr3');
    CHARTS.masterSr3 = new Chart(document.getElementById('masterSr3Chart'),{
      type:'line', data:{ labels:spreadLabels, datasets:[{
          label:'3M Rate Change (bps)', data:spreads,
          backgroundColor:'rgba(0,212,170,.1)',
          borderColor:'#00d4aa',
          fill:true, tension:.3, pointRadius:4, pointHoverRadius:7, borderWidth:2.5
      }]},
      options:{ ...BASE_CHART_OPTS, plugins:{ ...BASE_CHART_OPTS.plugins, tooltip:{...BASE_CHART_OPTS.plugins.tooltip, callbacks:{label:i=>` ${i.raw<0?'Cut':'Hike'}: ${fmtDelta(i.raw)} bps`}} },
      scales:{ x:{...BASE_CHART_OPTS.scales.x,ticks:{...BASE_CHART_OPTS.scales.x.ticks,maxRotation:45,font:{size:9}}},
               y:{...BASE_CHART_OPTS.scales.y,title:{display:true,text:'bps (neg=cut)',color:'#5a6385',font:{size:10}}} } }
    });
  }

  // ---------- 2. ZQ Curve ----------
  const mpN = getMPForDate(d);
  const zqItems=[]; let cum=0; const BASE=4.375;
  mpN.forEach((x,i)=>{
    if(x.premium==null) return;
    cum+=x.premium;
    const mo=x.meeting.label.split(' ')[0]?.slice(0,3)||'';
    const yr="'"+(x.meeting.label.split(' ')[1]?.slice(2)||'');
    const r=BASE-cum/100;
    zqItems.push({ label:`${mo} ${yr}`, monthLbl:monthAbbr(x.meeting.label), impliedRate:+r.toFixed(4), zqPrice:+(100-r).toFixed(4) });
  });
  
  const zqMap={}; zqItems.forEach((x,i)=>zqMap[i]=x.monthLbl);
  destroyChart('masterZq');
  CHARTS.masterZq = new Chart(document.getElementById('masterZqChart'),{
    type:'line', data:{ labels:zqItems.map(x=>x.label), datasets:[
        { label:'ZQ Price (100−EFFR)', data:zqItems.map(x=>x.zqPrice), borderColor:'#fb923c', backgroundColor:'rgba(251,146,60,.1)', fill:true, tension:.3, pointRadius:5, borderWidth:2.5, yAxisID:'y1' },
        { label:'Implied EFFR (%)', data:zqItems.map(x=>x.impliedRate), borderColor:'#4f8dff', backgroundColor:'rgba(79,141,255,.06)', fill:false, tension:.3, borderDash:[5,3], pointRadius:4, borderWidth:2, yAxisID:'y2' }
    ]},
    options:{ ...BASE_CHART_OPTS, layout:{padding:{bottom:24}}, plugins:{ ...BASE_CHART_OPTS.plugins, monthLabels:{months:zqMap} },
              scales:{ x:{...BASE_CHART_OPTS.scales.x,ticks:{...BASE_CHART_OPTS.scales.x.ticks,maxRotation:0,color:'#fb923c',font:{size:10,weight:'600'}}},
                       y1:{type:'linear',position:'left',ticks:{color:'#fb923c',font:{size:10}},grid:{color:'rgba(80,100,180,.09)'},title:{display:true,text:'ZQ Price',color:'#fb923c',font:{size:10}}},
                       y2:{type:'linear',position:'right',ticks:{color:'#4f8dff',font:{size:10}},grid:{drawOnChartArea:false},title:{display:true,text:'EFFR %',color:'#4f8dff',font:{size:10}}} } }
  });

  // ---------- 3. Meeting Differences (Q->Q and nQ->nQ) ----------
  function getFilteredDiffs(isSep) {
    const mpN = getMPForDate(d).filter(x => x.meeting.isSEP === isSep);
    const mpP = prev ? getMPForDate(prev).filter(x => x.meeting.isSEP === isSep) : null;
    const diffs = [];
    for (let i=0; i<mpN.length-1; i++) {
      const a=mpN[i], b=mpN[i+1];
      if (a.premium==null||b.premium==null) continue;
      const diff=b.premium-a.premium;
      let prevDiff = null;
      if (mpP) {
        const pA = mpP.find(x=>x.meeting.label===a.meeting.label);
        const pB = mpP.find(x=>x.meeting.label===b.meeting.label);
        if (pA&&pB&&pA.premium!=null&&pB.premium!=null) prevDiff = pB.premium-pA.premium;
      }
      diffs.push({
        fromLabel:`${a.meeting.label.split(' ').slice(0,2).join(' ')}`,
        toLabel:`${b.meeting.label.split(' ').slice(0,2).join(' ')}`,
        diff, prevDiff, delta: prevDiff!=null?diff-prevDiff:null,
        aIsSEP:a.meeting.isSEP, bIsSEP:b.meeting.isSEP
      });
    }
    return diffs;
  }

  const masterQq = getFilteredDiffs(true);
  const masterQnq = getFilteredDiffs(false);

  function tb(id, data){
    document.getElementById(id).innerHTML=data.map(d=>`<tr>
      <td>${d.fromLabel}${d.aIsSEP?'<span class="sep-badge">SEP</span>':''}</td>
      <td>${d.toLabel}${d.bIsSEP?'<span class="sep-badge">SEP</span>':''}</td>
      <td class="${colorClass(d.diff)}">${fmt(d.diff)}</td>
      <td>${d.prevDiff!=null?fmt(d.prevDiff):'—'}</td>
      <td class="${d.delta!=null?colorClass(d.delta):'val-na'}">${d.delta!=null?fmtDelta(d.delta):'—'}</td>
    </tr>`).join('');
  }
  
  tb('masterQqBody', masterQq.slice(0,10));
  tb('masterQnqBody', masterQnq.slice(0,10));
}


// ─── 13b. TAB: TRADE BLOTTER ────────────────────────────────
function populateTbSelects() {
  const d      = currentDate();
  const mp     = getMPForDate(d);
  const map    = getSR3Mapping(d);
  const rowSR3 = getSR3Row(d);
  const type   = document.getElementById('tbType').value;
  const l1El   = document.getElementById('tbLeg1');
  const l2El   = document.getElementById('tbLeg2');
  const l2wrap = document.getElementById('tbLeg2Wrap');
  const l2lbl  = document.getElementById('tbLeg2Label');
  const dv01El = document.getElementById('tbDv01Label');
  l1El.innerHTML = ''; l2El.innerHTML = '';

  if (type === 'meeting_prem') {
    l2wrap.style.display = 'none';
    mp.forEach((x,i)=>{
      const o = document.createElement('option');
      o.value = x.meeting.date;
      o.textContent = `FED${i+1} — ${x.meeting.label}${x.meeting.isSEP?' (SEP)':''}`;
      l1El.appendChild(o);
    });
    if (dv01El) dv01El.textContent='$41.67';
  } else if (type === 'meeting_spread') {
    l2wrap.style.display = '';
    if (l2lbl) l2lbl.textContent = 'Leg 2 (SHORT)';
    mp.forEach((x,i)=>{
      ['l1El','l2El'].forEach(sel=>{
        const o=document.createElement('option');
        o.value=x.meeting.date;
        o.textContent=`FED${i+1} — ${x.meeting.label}${x.meeting.isSEP?' (SEP)':''}`;
        (sel==='l1El'?l1El:l2El).appendChild(o);
      });
    });
    if (l2El.options.length>1) l2El.selectedIndex=1;
    if (dv01El) dv01El.textContent='$41.67';
  } else if (type === 'sr3_spread') {
    l2wrap.style.display = '';
    if (l2lbl) l2lbl.textContent = 'Leg 2 (SHORT)';
    for (let i=0;i<Math.min(map.length,23);i++){
      if (!rowSR3||rowSR3[`sra${i+1}`]==null) continue;
      const lbl=map[i].contract.replace('SR3 ','');
      const rate=rowSR3[`sra${i+1}`]!=null?(100-rowSR3[`sra${i+1}`]).toFixed(3)+'%':'';
      ['l1El','l2El'].forEach(sel=>{
        const o=document.createElement('option');
        o.value=map[i].contract;
        o.textContent=`SRA${i+1} — ${lbl}  (${rate})`;
        (sel==='l1El'?l1El:l2El).appendChild(o);
      });
    }
    if (l2El.options.length>1) l2El.selectedIndex=1;
    if (dv01El) dv01El.textContent='$25.00';
  } else if (type === 'sr3_outright') {
    l2wrap.style.display = 'none';
    for (let i=0;i<Math.min(map.length,23);i++){
      if (!rowSR3||rowSR3[`sra${i+1}`]==null) continue;
      const lbl=map[i].contract.replace('SR3 ','');
      const praw=rowSR3[`sra${i+1}`];
      const rate=praw!=null?(100-praw).toFixed(3)+'%':'';
      const o=document.createElement('option');
      o.value=map[i].contract;
      o.textContent=`SRA${i+1} — ${lbl}  (${praw!=null?praw.toFixed(4):'—'} / ${rate})`;
      l1El.appendChild(o);
    }
    if (dv01El) dv01El.textContent='$25.00';
  }
  updateTbPreview();
}



// ─── 14. RENDER ACTIVE TAB ───────────────────────────────────
function renderTab() {
  const tab = STATE.activeTab;
  if      (tab==='masterView')     renderMasterTab();
  else if (tab==='meetingPremium') renderMPTab();
  else if (tab==='sr3Curve')       renderSR3Tab();
  else if (tab==='zqCurve')        renderZQTab();
  else if (tab==='neutralRate')    renderNRTab();
  else if (tab==='meetingDiff')    renderDiffTab();
  else if (tab==='events')         renderEventsTab();
  else if (tab==='tradeBlotter')    renderTradeBlotter();
  else {
    // Blotter P&L in KPI bar needs refresh even on other tabs
    if (STATE.trades.length) updateKPIBar();
  }
  updateKPIBar();
}

// ─── 15. SLIDER & NAVIGATION ─────────────────────────────────
function updateHeader() {
  const d = currentDate();
  document.getElementById('sliderDateLabel').textContent = d;
  document.getElementById('currentDateDisplay').textContent = fmtDateDisplay(d);

  const fomc=FOMC_BY_DATE[d];
  const bar=document.getElementById('fomcInfoBar');
  if(fomc){
    document.getElementById('fomcInfoText').textContent=
      `FOMC Meeting: ${fomc.label}${fomc.isSEP?' (SEP)':''} — Rate change effective ${nextBizDay(d)}`;
    bar.style.display='flex';
  } else {
    bar.style.display='none';
  }
}

function step(dir){
  const s = STATE.stepMode==='week'?5:1;
  STATE.sliderIdx = Math.max(0, Math.min(DATES_2025_ON.length-1, STATE.sliderIdx+dir*s));
  document.getElementById('mainDateSlider').value = STATE.sliderIdx;
  updateHeader();
  renderTab();
}

function jumpToDate(dateStr){
  let idx=DATES_2025_ON.findIndex(d=>d>=dateStr);
  if(idx<0) idx=DATES_2025_ON.length-1;
  STATE.sliderIdx=idx;
  document.getElementById('mainDateSlider').value=idx;
  updateHeader();
  renderTab();
}

// ─── 16. EVENT BINDING ───────────────────────────────────────
function bind(){
  const slider=document.getElementById('mainDateSlider');
  slider.min=0; slider.max=DATES_2025_ON.length-1; slider.value=STATE.sliderIdx;
  slider.addEventListener('input',()=>{
    STATE.sliderIdx=parseInt(slider.value);
    updateHeader(); renderTab();
  });

  document.getElementById('stepBack').onclick=()=>step(-1);
  document.getElementById('stepFwd').onclick=()=>step(1);

  document.getElementById('modeDay').onclick=()=>{
    STATE.stepMode='day';
    document.getElementById('modeDay').classList.add('active');
    document.getElementById('modeWeek').classList.remove('active');
  };
  document.getElementById('modeWeek').onclick=()=>{
    STATE.stepMode='week';
    document.getElementById('modeWeek').classList.add('active');
    document.getElementById('modeDay').classList.remove('active');
  };

  document.getElementById('prevFomc').onclick=()=>{
    const d=currentDate();
    const f=[...FOMC_MEETINGS].reverse().find(x=>x.date<d);
    if(f) jumpToDate(f.date);
  };
  document.getElementById('nextFomc').onclick=()=>{
    const d=currentDate();
    const f=FOMC_MEETINGS.find(x=>x.date>d);
    if(f) jumpToDate(f.date);
  };

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      STATE.activeTab=btn.dataset.tab;
      document.getElementById('tab-'+STATE.activeTab).classList.add('active');
      renderTab();
    });
  });

  // MP: reference date
  document.getElementById('setRefBtn').onclick=()=>{
    const v=document.getElementById('refDateInput').value;
    if(v&&MP_BY_DATE[v]){ STATE.refDate=v; renderMPTab(); }
    else { document.getElementById('refDateInput').style.borderColor='#ef4444';
           setTimeout(()=>document.getElementById('refDateInput').style.borderColor='',1500); }
  };

  // Cuts/Hikes half toggle
  ['chHalfFull','chHalfH1','chHalfH2'].forEach(id=>{
    document.getElementById(id).onclick=()=>{
      STATE.cutsHikeHalf=id.replace('chHalf','').toLowerCase();
      ['chHalfFull','chHalfH1','chHalfH2'].forEach(x=>
        document.getElementById(x).classList.toggle('active-toggle',x===id));
      renderNRTab();
    };
  });

  // Events filter
  ['evAll','evFOMC','evKeyData','evHawkish','evDovish'].forEach(id=>{
    document.getElementById(id).onclick=()=>{
      document.querySelectorAll('#tab-events .mini-btn').forEach(b=>b.classList.remove('active-toggle'));
      document.getElementById(id).classList.add('active-toggle');
      STATE.evFilter=id.replace('ev','').toLowerCase();
      renderEventsTab();
    };
  });
  document.getElementById('evFilter').onclick=()=>{
    STATE.evFrom=document.getElementById('evFrom').value;
    STATE.evTo=document.getElementById('evTo').value;
    renderEventsTab();
  };


  // ── Trade Blotter bindings ─────────────────────────────────
  const tbTypeEl = document.getElementById('tbType');
  const tbLeg1El = document.getElementById('tbLeg1');
  const tbLeg2El = document.getElementById('tbLeg2');

  if (tbTypeEl) {
    tbTypeEl.onchange = () => { populateTbSelects(); };
    if(tbLeg1El) tbLeg1El.onchange = updateTbPreview;
    if(tbLeg2El) tbLeg2El.onchange = updateTbPreview;

    document.getElementById('tbBuy').onclick = () => {
      STATE.tbSide = 'buy';
      document.getElementById('tbBuy').classList.add('active');
      document.getElementById('tbSell').classList.remove('active');
    };
    document.getElementById('tbSell').onclick = () => {
      STATE.tbSide = 'sell';
      document.getElementById('tbSell').classList.add('active');
      document.getElementById('tbBuy').classList.remove('active');
    };

    document.getElementById('tbAddTrade').onclick = () => {
      if (STATE.trades.length>=40){ alert('Max 40 trades. Remove some first.'); return; }
      const d=currentDate(), type=tbTypeEl.value;
      const v1=tbLeg1El.value, v2=tbLeg2El.value;
      if (!v1) return;
      const tmp={type};
      if (type==='meeting_prem')   tmp.mDate1=v1;
      if (type==='meeting_spread') { tmp.mDate1=v1; tmp.mDate2=v2; }
      if (type==='sr3_outright')   tmp.contract1=v1;
      if (type==='sr3_spread')     { tmp.contract1=v1; tmp.contract2=v2; }
      const entryPrice=getTradeCurrentPrice(tmp,d);
      if (entryPrice==null){
        const h=document.getElementById('tbBuilderHint');
        h.textContent='⚠ No price data on '+d+' — move slider to a date with data.';
        h.style.color='#ef4444';
        setTimeout(()=>{h.style.color='';updateTbPreview();},2500);
        return;
      }
      const lots=Math.max(1,Math.min(1000,parseInt(document.getElementById('tbSize').value)||1));
      const trade={id:STATE.tradeNextId++,type,side:STATE.tbSide,lots,
                   entryDate:d,entryPrice,label:buildTradeLabel(type,v1,v2),dv01:getDV01(type)};
      if (type==='meeting_prem')   trade.mDate1=v1;
      if (type==='meeting_spread') { trade.mDate1=v1; trade.mDate2=v2; }
      if (type==='sr3_outright')   trade.contract1=v1;
      if (type==='sr3_spread')     { trade.contract1=v1; trade.contract2=v2; }
      STATE.trades.push(trade);
      if (STATE.activeTab==='tradeBlotter') renderTradeBlotter();
      updateKPIBar();
    };  document.getElementById('tbAddTrade').onclick = () => {
      if (STATE.trades.length >= 40) {
        alert('Maximum 40 trades reached. Remove some trades first.');
        return;
      }
      const d    = currentDate();
      const type = tbTypeEl.value;
      const leg1 = parseInt(tbLeg1El.value);
      const leg2 = parseInt(tbLeg2El.value);
      if (isNaN(leg1)) return;
      const entryPrice = getTradePrice(type, leg1, isNaN(leg2) ? 0 : leg2, d);
      if (entryPrice == null) {
        document.getElementById('tbBuilderHint').textContent = '⚠ No price data for this instrument on the selected date.';
        document.getElementById('tbBuilderHint').style.color = '#ef4444';
        setTimeout(() => {
          document.getElementById('tbBuilderHint').style.color = '';
          updateTbPreview();
        }, 2000);
        return;
      }
      const lots = Math.max(1, Math.min(1000, parseInt(document.getElementById('tbSize').value) || 1));
      STATE.trades.push({
        id:         STATE.tradeNextId++,
        type, leg1, leg2: isNaN(leg2) ? 0 : leg2,
        side:       STATE.tbSide,
        lots,
        entryDate:  d,
        entryPrice,
        label:      buildTradeLabel(type, leg1, isNaN(leg2) ? 0 : leg2, d),
        dv01:       getDV01(type),
      });
      if (STATE.activeTab === 'tradeBlotter') renderTradeBlotter();
      updateKPIBar();
    };

    document.getElementById('tbClearAll').onclick = () => {
      if (STATE.trades.length && confirm('Clear all open trades?')) {
        STATE.trades = [];
        if (STATE.activeTab === 'tradeBlotter') renderTradeBlotter();
        updateKPIBar();
      }
    };
  }

  document.getElementById('closeFomcInfo').onclick=()=>{
    document.getElementById('fomcInfoBar').style.display='none';
  };

  // Keyboard
  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if(e.key==='ArrowLeft')  step(-1);
    if(e.key==='ArrowRight') step(1);
    if(e.key==='ArrowUp')    step(-5);
    if(e.key==='ArrowDown')  step(5);
  });
}

// ─── 17. INIT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  STATE.sliderIdx = DATES_2025_ON.length-1;
  bind();
  updateHeader();
  renderTab();
  console.log(`✓ STIR Dashboard ready | ${DATES_2025_ON.length} dates | ${SR3_DATA.length} SR3 rows | ${FOMC_MEETINGS.length} FOMC meetings`);
});
