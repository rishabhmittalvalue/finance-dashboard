import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const SHEET_ID = '1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ';
const SHEET_NAME = 'Sheet1';
const API_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;

const CAT_COLORS = {
  Groceries:'#1D9E75', Dining:'#7F77DD', Transport:'#5F5E5A',
  Subscriptions:'#378ADD', Shopping:'#D4537E', Housing:'#185FA5',
  Health:'#639922', Utilities:'#BA7517', Travel:'#D85A30',
  Education:'#0F6E56', Other:'#888780',
};
const METHOD_COLORS = {
  'Zelle':'#6B46C1','Apple Pay Amex':'#1A56DB','Apple Pay BofA':'#D85A30',
  'Apple Pay Chase':'#0E7490','Amex Credit Card':'#1D4ED8',
  'BofA Debit Card':'#C2410C','Chase Debit Card':'#0369A1',
};
const CATS = ['Groceries','Dining','Transport','Subscriptions','Shopping','Housing','Health','Utilities','Travel','Education','Other'];
const METHODS = ['All','Zelle','Apple Pay Amex','Apple Pay BofA','Apple Pay Chase','Amex Credit Card','BofA Debit Card','Chase Debit Card'];
const RECURRING_KW = ['netflix','spotify','amazon prime','hulu','apple','google one','microsoft','adobe','dropbox','visible','walmart+','notion','openai','claude','linkedin','youtube','disney','paramount','peacock','gym','membership'];

const fmt  = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtK = n => { const a = Math.abs(n); return a >= 1000 ? '$'+(a/1000).toFixed(1)+'k' : fmt(n); };
const isRecurring = (merchant, cat) => cat === 'Subscriptions' || RECURRING_KW.some(k => merchant.toLowerCase().includes(k));

function parseGDate(raw) {
  if (!raw && raw !== 0) return null;
  const s = String(raw).trim();
  const gm = s.match(/Date\((\d+),(\d+),(\d+)\)/);
  if (gm) return new Date(+gm[1], +gm[2], +gm[3]);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(+mdy[3], +mdy[1]-1, +mdy[2]);
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  return null;
}
function displayDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
}
function parseSheetData(raw) {
  const json = JSON.parse(raw.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, ''));
  return (json.table.rows || []).map((r, idx) => {
    const c = r.c;
    if (!c || !c[0] || !c[2]) return null;
    const merchant = (c[1]?.v || '').trim();
    const rawAmt   = parseFloat(c[2]?.v);
    if (isNaN(rawAmt) || !merchant) return null;
    const method      = (c[3]?.v || '').trim();
    const category    = (c[4]?.v || 'Other').trim();
    const subCategory = (c[5]?.v || '').trim();
    const isIncome    = method.toLowerCase().includes('income');
    const amount      = isIncome ? Math.abs(rawAmt) : -Math.abs(rawAmt);
    const dateObj     = parseGDate(c[0]?.v);
    const date        = displayDate(dateObj) || String(c[0]?.v || '');
    return { id:idx, date, dateObj, merchant, amount, method, category, subCategory, isIncome };
  }).filter(Boolean);
}

const sow = d => { const r=new Date(d); r.setDate(r.getDate()-r.getDay()); r.setHours(0,0,0,0); return r; };
const eow = d => { const r=new Date(d); r.setDate(r.getDate()+(6-r.getDay())); r.setHours(23,59,59,999); return r; };

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background:'#fff', borderRadius:12, padding:'14px 18px', border:'0.5px solid #e2e8f0' }}>
      <div style={{ fontSize:12, color:'#64748b', marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:600, color:color||'#0f172a' }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function DonutChart({ data, title, subtitle, onSegmentClick, activeCat, colorMap }) {
  const total = data.reduce((s,d) => s+d.value, 0);
  return (
    <div style={{ background:'#fff', borderRadius:12, border:'0.5px solid #e2e8f0', padding:'16px 20px' }}>
      <div style={{ fontSize:13, fontWeight:500, color:'#334155', marginBottom:2 }}>{title}</div>
      {subtitle && <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>{subtitle}</div>}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:160, height:160, flexShrink:0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={70}
                dataKey="value" paddingAngle={2}
                onClick={onSegmentClick ? (_,i) => onSegmentClick(data[i].name) : undefined}>
                {data.map(d => (
                  <Cell key={d.name} fill={colorMap[d.name]||'#888'}
                    opacity={activeCat && activeCat!==d.name ? 0.25 : 1}
                    stroke={activeCat===d.name ? '#0f172a' : 'none'} strokeWidth={2}
                    style={{ cursor: onSegmentClick ? 'pointer' : 'default' }}/>
                ))}
              </Pie>
              <Tooltip formatter={(v,n) => [fmt(v),n]}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:5, overflow:'hidden' }}>
          {data.slice(0,8).map(d => (
            <div key={d.name}
              onClick={onSegmentClick ? () => onSegmentClick(d.name) : undefined}
              style={{ display:'flex', alignItems:'center', gap:6, fontSize:12,
                cursor: onSegmentClick ? 'pointer' : 'default',
                opacity: activeCat && activeCat!==d.name ? 0.35 : 1 }}>
              <div style={{ width:8, height:8, borderRadius:2, flexShrink:0, background:colorMap[d.name]||'#888' }}/>
              <span style={{ flex:1, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.name}</span>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <span style={{ color:'#0f172a', fontWeight:500 }}>{fmt(d.value)}</span>
                <span style={{ color:'#94a3b8', marginLeft:4 }}>({((d.value/total)*100).toFixed(0)}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [allTxns, setAllTxns] = useState([]);
  const [notes, setNotes]     = useState({});
  const [editingNote, setEditingNote]   = useState(null);
  const [noteInput, setNoteInput]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [lastRefresh, setLastRefresh]   = useState(null);

  // ── Overall budget ────────────────────────────────────────────────────────
  const [overallBudget, setOverallBudget]       = useState('');        // stored as string while editing
  const [savedOverallBudget, setSavedOverallBudget] = useState(0);     // numeric, 0 = not set
  const [editingOverallBudget, setEditingOverallBudget] = useState(false);

  // ── Global date filter ────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  // ── Secondary filters ─────────────────────────────────────────────────────
  const [filterCat,    setFilterCat]    = useState('All');
  const [filterMethod, setFilterMethod] = useState('All');
  const [search,       setSearch]       = useState('');
  const [drillCat,     setDrillCat]     = useState(null);

  // ── Sort & pagination ─────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page,    setPage]    = useState(1);
  const PER_PAGE = 20;

  // ── Category budgets ──────────────────────────────────────────────────────
  const [budgetRules,      setBudgetRules]      = useState([]);
  const [newBudgetCat,     setNewBudgetCat]     = useState('');
  const [newBudgetAmt,     setNewBudgetAmt]     = useState('');
  const [editingBudgetId,  setEditingBudgetId]  = useState(null);
  const [editBudgetAmt,    setEditBudgetAmt]    = useState('');

  const fetchData = async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(API_URL);
      const text = await res.text();
      setAllTxns(parseSheetData(text));
      setLastRefresh(new Date());
    } catch {
      setError('Could not load data. Make sure your Google Sheet is set to "Anyone with the link can view".');
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const expenses = useMemo(() => allTxns.filter(t => !t.isIncome), [allTxns]);
  const income   = useMemo(() => allTxns.filter(t =>  t.isIncome), [allTxns]);

  // Date-filtered lists (feed everything else)
  const dfExpenses = useMemo(() => {
    let l = expenses;
    if (dateFrom) { const d=new Date(dateFrom); l=l.filter(t=>t.dateObj&&t.dateObj>=d); }
    if (dateTo)   { const d=new Date(dateTo+'T23:59:59'); l=l.filter(t=>t.dateObj&&t.dateObj<=d); }
    return l;
  }, [expenses, dateFrom, dateTo]);

  const dfIncome = useMemo(() => {
    let l = income;
    if (dateFrom) { const d=new Date(dateFrom); l=l.filter(t=>t.dateObj&&t.dateObj>=d); }
    if (dateTo)   { const d=new Date(dateTo+'T23:59:59'); l=l.filter(t=>t.dateObj&&t.dateObj<=d); }
    return l;
  }, [income, dateFrom, dateTo]);

  // Secondary-filtered list (table only)
  const filtered = useMemo(() => {
    let l = drillCat ? dfExpenses.filter(t=>t.category===drillCat) : dfExpenses;
    if (filterCat    !== 'All') l = l.filter(t=>t.category===filterCat);
    if (filterMethod !== 'All') l = l.filter(t=>t.method===filterMethod);
    if (search) l = l.filter(t=>
      t.merchant.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase()) ||
      (notes[t.id]||'').toLowerCase().includes(search.toLowerCase())
    );
    return l;
  }, [dfExpenses, drillCat, filterCat, filterMethod, search, notes]);

  const sorted = useMemo(() => [...filtered].sort((a,b) => {
    if (sortCol==='date') { const va=a.dateObj||new Date(0),vb=b.dateObj||new Date(0); return sortDir==='asc'?va-vb:vb-va; }
    if (sortCol==='amount') { return sortDir==='asc'?Math.abs(a.amount)-Math.abs(b.amount):Math.abs(b.amount)-Math.abs(a.amount); }
    const va=a[sortCol]||'', vb=b[sortCol]||'';
    return sortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va);
  }), [filtered, sortCol, sortDir]);

  const paged      = sorted.slice((page-1)*PER_PAGE, page*PER_PAGE);
  const totalPages = Math.ceil(sorted.length/PER_PAGE);

  const totalSpend    = dfExpenses.reduce((s,t)=>s+Math.abs(t.amount),0);
  const totalIncome   = dfIncome.reduce((s,t)=>s+t.amount,0);
  const filteredSpend = filtered.reduce((s,t)=>s+Math.abs(t.amount),0);

  // Overall budget derived values
  const budgetRemaining  = savedOverallBudget > 0 ? savedOverallBudget - totalSpend : 0;
  const budgetPct        = savedOverallBudget > 0 ? Math.min((totalSpend/savedOverallBudget)*100, 100) : 0;
  const budgetOver       = savedOverallBudget > 0 && totalSpend > savedOverallBudget;
  const budgetBarColor   = budgetPct >= 100 ? '#dc2626' : budgetPct >= 80 ? '#f59e0b' : '#1D9E75';

  const catData = useMemo(() => {
    const m={};
    dfExpenses.forEach(t=>{m[t.category]=(m[t.category]||0)+Math.abs(t.amount);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));
  }, [dfExpenses]);

  const methodData = useMemo(() => {
    const m={};
    dfExpenses.forEach(t=>{m[t.method]=(m[t.method]||0)+Math.abs(t.amount);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));
  }, [dfExpenses]);

  const top3          = catData.slice(0,3);
  const recurringTxns = useMemo(()=>dfExpenses.filter(t=>isRecurring(t.merchant,t.category)),[dfExpenses]);
  const recurringTotal= recurringTxns.reduce((s,t)=>s+Math.abs(t.amount),0);

  const now=new Date(), twS=sow(now), twE=eow(now);
  const lwS=new Date(twS); lwS.setDate(lwS.getDate()-7);
  const lwE=new Date(twE); lwE.setDate(lwE.getDate()-7);
  const weeklyComp = useMemo(()=>CATS.map(cat=>{
    const tw=expenses.filter(t=>t.category===cat&&t.dateObj>=twS&&t.dateObj<=twE).reduce((s,t)=>s+Math.abs(t.amount),0);
    const lw=expenses.filter(t=>t.category===cat&&t.dateObj>=lwS&&t.dateObj<=lwE).reduce((s,t)=>s+Math.abs(t.amount),0);
    const diff=tw-lw; const pct=lw>0?(diff/lw)*100:tw>0?100:0;
    return {cat,tw,lw,diff,pct};
  }).filter(x=>x.tw>0||x.lw>0),[expenses]);

  const availableBudgetCats = CATS.filter(c=>!budgetRules.find(b=>b.category===c));
  const addBudget = ()=>{
    if(!newBudgetCat||!newBudgetAmt||isNaN(parseFloat(newBudgetAmt))) return;
    if(budgetRules.find(b=>b.category===newBudgetCat)) return;
    setBudgetRules(p=>[...p,{id:Date.now(),category:newBudgetCat,amount:parseFloat(newBudgetAmt)}]);
    setNewBudgetCat(''); setNewBudgetAmt('');
  };
  const removeBudget  = id=>setBudgetRules(p=>p.filter(b=>b.id!==id));
  const saveBudgetEdit= id=>{setBudgetRules(p=>p.map(b=>b.id===id?{...b,amount:parseFloat(editBudgetAmt)||0}:b));setEditingBudgetId(null);};
  const budgetData = useMemo(()=>budgetRules.map(b=>{
    const spent=dfExpenses.filter(t=>t.category===b.category).reduce((s,t)=>s+Math.abs(t.amount),0);
    const pct=b.amount>0?Math.min((spent/b.amount)*100,150):0;
    return {...b,spent,pct,over:spent>b.amount&&b.amount>0};
  }),[budgetRules,dfExpenses]);

  const saveNote = id=>{ setNotes(p=>({...p,[id]:noteInput.trim()})); setEditingNote(null); setNoteInput(''); };
  const flagBg   = amt=>{ const a=Math.abs(amt); if(a>=80)return'#FEE2E2'; if(a>=40)return'#FEF9C3'; return null; };
  const handleSort = col=>{ if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('desc');}setPage(1); };
  const sortArrow  = col=>sortCol===col?(sortDir==='asc'?'↑':'↓'):'';
  const handlePieDrill = name=>{ setDrillCat(drillCat===name?null:name); setFilterCat('All'); setPage(1); };
  const clearSecondary = ()=>{ setFilterCat('All'); setFilterMethod('All'); setSearch(''); setDrillCat(null); setPage(1); };

  const hasDateFilter      = dateFrom||dateTo;
  const hasSecondaryFilter = filterCat!=='All'||filterMethod!=='All'||search||drillCat;

  const inp  = { padding:'7px 10px', borderRadius:8, border:'0.5px solid #e2e8f0', fontSize:13, background:'#fff', color:'#334155' };
  const card = { background:'#fff', borderRadius:12, border:'0.5px solid #e2e8f0', padding:'16px 20px' };
  const th   = { padding:'10px 12px', borderBottom:'1px solid #e2e8f0', fontSize:11, fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.05em', textAlign:'left', background:'#f8fafc', cursor:'pointer', whiteSpace:'nowrap' };
  const tdc  = { padding:'10px 12px', borderBottom:'0.5px solid #f1f5f9', fontSize:13, color:'#334155', verticalAlign:'top' };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:16 }}>
      <div style={{ width:36, height:36, border:'3px solid #e2e8f0', borderTop:'3px solid #378ADD', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
      <div style={{ color:'#64748b', fontSize:14 }}>Loading your transactions...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:12, padding:24 }}>
      <div style={{ fontSize:32 }}>⚠</div>
      <div style={{ color:'#dc2626', fontWeight:500, textAlign:'center', maxWidth:400 }}>{error}</div>
      <button onClick={fetchData} style={{ ...inp, cursor:'pointer' }}>Try again</button>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:'#f4f6fb', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>

      {/* ══════════ STICKY HEADER ══════════ */}
      <div style={{ background:'#fff', borderBottom:'0.5px solid #e2e8f0', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ maxWidth:1140, margin:'0 auto', padding:'12px 20px' }}>

          {/* Row 1: title + date filter + refresh */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:18, fontWeight:600, color:'#0f172a' }}>My Finance Dashboard</div>
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{allTxns.length} transactions · synced {lastRefresh?.toLocaleTimeString()}</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:12, fontWeight:500, color:'#64748b' }}>Date range</span>
              <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}}
                style={{ ...inp, borderColor:hasDateFilter?'#378ADD':'#e2e8f0' }}/>
              <span style={{ fontSize:12, color:'#94a3b8' }}>→</span>
              <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}}
                style={{ ...inp, borderColor:hasDateFilter?'#378ADD':'#e2e8f0' }}/>
              {hasDateFilter && (
                <button onClick={()=>{setDateFrom('');setDateTo('');setPage(1);}}
                  style={{ fontSize:12, color:'#dc2626', background:'#FEE2E2', border:'none', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontWeight:500 }}>
                  ✕ Clear dates
                </button>
              )}
              <button onClick={fetchData} style={{ ...inp, cursor:'pointer', fontWeight:500 }}>↻ Refresh</button>
            </div>
          </div>

          {/* Row 2: Overall budget bar */}
          <div style={{ background:'#f8fafc', borderRadius:10, padding:'10px 14px', border:'0.5px solid #e2e8f0' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom: savedOverallBudget > 0 ? 8 : 0 }}>
              <span style={{ fontSize:12, fontWeight:500, color:'#334155' }}>Overall budget</span>

              {editingOverallBudget ? (
                <form onSubmit={e=>{e.preventDefault();const v=parseFloat(overallBudget);if(!isNaN(v)&&v>0){setSavedOverallBudget(v);}setEditingOverallBudget(false);}}
                  style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:13, color:'#64748b' }}>$</span>
                  <input autoFocus type="number" value={overallBudget}
                    onChange={e=>setOverallBudget(e.target.value)}
                    placeholder="e.g. 5000"
                    style={{ width:110, padding:'4px 8px', borderRadius:7, border:'1px solid #378ADD', fontSize:13 }}/>
                  <button type="submit"
                    style={{ fontSize:12, background:'#378ADD', color:'#fff', border:'none', borderRadius:7, padding:'4px 12px', cursor:'pointer', fontWeight:500 }}>
                    Save
                  </button>
                  <button type="button" onClick={()=>setEditingOverallBudget(false)}
                    style={{ fontSize:12, background:'#f1f5f9', border:'none', borderRadius:7, padding:'4px 10px', cursor:'pointer' }}>
                    Cancel
                  </button>
                </form>
              ) : savedOverallBudget > 0 ? (
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', flex:1 }}>
                  {/* Spend numbers */}
                  <span style={{ fontSize:13, color:'#0f172a', fontWeight:600 }}>{fmt(totalSpend)}</span>
                  <span style={{ fontSize:12, color:'#94a3b8' }}>spent of</span>
                  <span style={{ fontSize:13, fontWeight:600, color:'#334155' }}>{fmt(savedOverallBudget)}</span>
                  <span style={{ fontSize:12, color:'#94a3b8' }}>budget</span>

                  {/* Remaining / over */}
                  {budgetOver ? (
                    <span style={{ fontSize:12, background:'#FEE2E2', color:'#991B1B', padding:'2px 10px', borderRadius:20, fontWeight:600 }}>
                      {fmt(Math.abs(budgetRemaining))} over budget
                    </span>
                  ) : (
                    <span style={{ fontSize:12, background:'#D1FAE5', color:'#065F46', padding:'2px 10px', borderRadius:20, fontWeight:600 }}>
                      {fmt(budgetRemaining)} remaining
                    </span>
                  )}

                  <span style={{ fontSize:12, color:'#94a3b8' }}>{budgetPct.toFixed(0)}% used</span>

                  <button onClick={()=>{setOverallBudget(String(savedOverallBudget));setEditingOverallBudget(true);}}
                    style={{ fontSize:11, color:'#378ADD', background:'none', border:'0.5px solid #bfdbfe', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>
                    Edit
                  </button>
                  <button onClick={()=>{setSavedOverallBudget(0);setOverallBudget('');}}
                    style={{ fontSize:11, color:'#dc2626', background:'none', border:'0.5px solid #fecaca', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>
                    Remove
                  </button>
                </div>
              ) : (
                <button onClick={()=>setEditingOverallBudget(true)}
                  style={{ fontSize:12, color:'#378ADD', background:'#eff6ff', border:'0.5px solid #bfdbfe', borderRadius:8, padding:'5px 14px', cursor:'pointer', fontWeight:500 }}>
                  + Set overall budget
                </button>
              )}
            </div>

            {/* Budget progress bar — only show when budget is set */}
            {savedOverallBudget > 0 && (
              <div>
                <div style={{ height:10, background:'#e2e8f0', borderRadius:5, overflow:'hidden' }}>
                  <div style={{
                    height:'100%', borderRadius:5,
                    width:`${budgetPct}%`,
                    background: budgetBarColor,
                    transition:'width 0.5s ease',
                    position:'relative'
                  }}>
                    {/* Pulsing dot at the tip when near/over limit */}
                    {budgetPct >= 80 && (
                      <div style={{ position:'absolute', right:0, top:'50%', transform:'translateY(-50%)',
                        width:12, height:12, borderRadius:'50%', background:budgetBarColor,
                        boxShadow:`0 0 0 3px ${budgetBarColor}44` }}/>
                    )}
                  </div>
                </div>
                {/* Tick marks at 25 / 50 / 75 / 100% */}
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:3, fontSize:10, color:'#94a3b8' }}>
                  <span>$0</span>
                  <span>{fmtK(savedOverallBudget*0.25)}</span>
                  <span>{fmtK(savedOverallBudget*0.5)}</span>
                  <span>{fmtK(savedOverallBudget*0.75)}</span>
                  <span>{fmt(savedOverallBudget)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Date range active pill */}
          {hasDateFilter && (
            <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8 }}>
              <div style={{ background:'#eff6ff', border:'0.5px solid #bfdbfe', borderRadius:20, padding:'2px 12px', fontSize:12, color:'#1e40af', fontWeight:500 }}>
                {dateFrom ? new Date(dateFrom).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'All past'}
                {' → '}
                {dateTo
                  ? new Date(dateTo).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                  : `${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} (today)`}
              </div>
              <span style={{ fontSize:11, color:'#94a3b8' }}>· all widgets filtered to this range</span>
            </div>
          )}
        </div>
      </div>

      {/* ══════════ PAGE BODY ══════════ */}
      <div style={{ maxWidth:1140, margin:'0 auto', padding:'20px 16px' }}>

        {/* Stat Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12, marginBottom:20 }}>
          <StatCard label="Total spend"     value={fmt(totalSpend)}   sub={`${dfExpenses.length} transactions`}   color="#dc2626"/>
          <StatCard label="Total income"    value={fmt(totalIncome)}  sub={`${dfIncome.length} credits`}           color="#16a34a"/>
          <StatCard label="Net balance"     value={(totalIncome-totalSpend>=0?'+':'')+fmt(totalIncome-totalSpend)} sub="income minus spend" color={totalIncome-totalSpend>=0?'#16a34a':'#dc2626'}/>
          <StatCard label="Recurring spend" value={fmt(recurringTotal)} sub={`${recurringTxns.length} charges`}   color="#7F77DD"/>
          <StatCard label="Largest expense" value={fmt(dfExpenses.length?Math.max(...dfExpenses.map(t=>Math.abs(t.amount))):0)} sub="single transaction"/>
        </div>

        {/* Top 3 */}
        {top3.length > 0 && (
          <div style={{ ...card, marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'#334155', marginBottom:12 }}>Top 3 categories eating your budget</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
              {top3.map((c,i) => (
                <div key={c.name} onClick={()=>handlePieDrill(c.name)}
                  style={{ background:'#f8fafc', borderRadius:8, padding:'12px 14px', borderLeft:`3px solid ${CAT_COLORS[c.name]||'#888'}`, cursor:'pointer' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                    <span style={{ fontSize:15, fontWeight:700, color:'#94a3b8' }}>#{i+1}</span>
                    <span style={{ fontSize:13, fontWeight:500, color:'#0f172a' }}>{c.name}</span>
                  </div>
                  <div style={{ fontSize:20, fontWeight:600, color:CAT_COLORS[c.name]||'#334155' }}>{fmt(c.value)}</div>
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{((c.value/totalSpend)*100).toFixed(1)}% of total · click to drill down</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Drill-down banner */}
        {drillCat && (
          <div style={{ background:'#eff6ff', borderRadius:10, padding:'10px 16px', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', border:'0.5px solid #bfdbfe' }}>
            <div>
              <span style={{ fontSize:13, color:'#1e40af', fontWeight:500 }}>Drill-down: </span>
              <span style={{ fontSize:13, color:'#1e40af' }}>{drillCat}</span>
              <span style={{ fontSize:13, color:'#60a5fa', marginLeft:8 }}>{fmt(filteredSpend)} · {filtered.length} transactions</span>
            </div>
            <button onClick={()=>{setDrillCat(null);setPage(1);}}
              style={{ fontSize:13, color:'#dc2626', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>
              ✕ Remove drill-down
            </button>
          </div>
        )}

        {/* Charts */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:16, marginBottom:16 }}>
          <DonutChart data={catData} title="Spend by category"
            subtitle="Click any segment to drill into those transactions"
            onSegmentClick={handlePieDrill} activeCat={drillCat} colorMap={CAT_COLORS}/>
          <DonutChart data={methodData} title="Spend by payment method"
            subtitle="Breakdown of how you pay" colorMap={METHOD_COLORS}/>
        </div>

        {/* Weekly Comparison */}
        {weeklyComp.length > 0 && (
          <div style={{ ...card, marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'#334155', marginBottom:12 }}>This week vs last week</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:10 }}>
              {weeklyComp.map(w => (
                <div key={w.cat} style={{ background:'#f8fafc', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>{w.cat}</div>
                  <div style={{ fontSize:16, fontWeight:600, color:'#0f172a' }}>{fmt(w.tw)}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:3 }}>
                    <span style={{ fontSize:11, color:w.diff>0?'#dc2626':w.diff<0?'#16a34a':'#64748b', fontWeight:500 }}>
                      {w.diff>0?'▲':w.diff<0?'▼':'–'} {fmt(Math.abs(w.diff))}
                    </span>
                    <span style={{ fontSize:11, color:'#94a3b8' }}>({w.pct>0?'+':''}{w.pct.toFixed(0)}%)</span>
                  </div>
                  {w.lw>0 && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Last week: {fmt(w.lw)}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category budgets */}
        <div style={{ ...card, marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:500, color:'#334155', marginBottom:3 }}>Budget vs actual — by category</div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:14 }}>Add budgets only for the categories you want to track. Edit or remove anytime.</div>
          {availableBudgetCats.length > 0 && (
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
              <select value={newBudgetCat} onChange={e=>setNewBudgetCat(e.target.value)}
                style={{ ...inp, minWidth:160 }}>
                <option value="">Select category...</option>
                {availableBudgetCats.map(c=><option key={c}>{c}</option>)}
              </select>
              <input type="number" placeholder="Budget amount ($)" value={newBudgetAmt}
                onChange={e=>setNewBudgetAmt(e.target.value)}
                style={{ ...inp, width:170 }}/>
              <button onClick={addBudget} disabled={!newBudgetCat||!newBudgetAmt}
                style={{ padding:'7px 16px', borderRadius:8, border:'none', fontWeight:500, fontSize:13, cursor:newBudgetCat&&newBudgetAmt?'pointer':'default',
                  background:newBudgetCat&&newBudgetAmt?'#378ADD':'#e2e8f0', color:newBudgetCat&&newBudgetAmt?'#fff':'#94a3b8' }}>
                + Add budget
              </button>
            </div>
          )}
          {budgetData.length === 0 ? (
            <div style={{ textAlign:'center', padding:'20px 0', color:'#94a3b8', fontSize:13 }}>
              No category budgets set. Pick a category above to get started.
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {budgetData.map(b => (
                <div key={b.id}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <div style={{ width:10, height:10, borderRadius:2, background:CAT_COLORS[b.category]||'#888' }}/>
                      <span style={{ fontSize:13, color:'#334155', fontWeight:500 }}>{b.category}</span>
                      {b.over && <span style={{ fontSize:10, background:'#FEE2E2', color:'#991B1B', padding:'1px 7px', borderRadius:10, fontWeight:600 }}>OVER</span>}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                      <span style={{ color:b.over?'#dc2626':'#334155', fontWeight:500 }}>{fmt(b.spent)}</span>
                      <span style={{ color:'#94a3b8' }}>of</span>
                      {editingBudgetId===b.id ? (
                        <form onSubmit={e=>{e.preventDefault();saveBudgetEdit(b.id);}} style={{ display:'flex', gap:4 }}>
                          <input autoFocus value={editBudgetAmt} onChange={e=>setEditBudgetAmt(e.target.value)}
                            style={{ width:80, padding:'2px 6px', borderRadius:6, border:'1px solid #378ADD', fontSize:12 }}/>
                          <button type="submit" style={{ fontSize:11, background:'#378ADD', color:'#fff', border:'none', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>Save</button>
                          <button type="button" onClick={()=>setEditingBudgetId(null)} style={{ fontSize:11, background:'#f1f5f9', border:'none', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>✕</button>
                        </form>
                      ) : (
                        <span onClick={()=>{setEditingBudgetId(b.id);setEditBudgetAmt(String(b.amount));}}
                          style={{ color:'#378ADD', cursor:'pointer', fontWeight:500, textDecoration:'underline dotted' }}>
                          {fmt(b.amount)}
                        </span>
                      )}
                      <button onClick={()=>removeBudget(b.id)}
                        style={{ fontSize:11, color:'#dc2626', background:'none', border:'0.5px solid #fecaca', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ height:8, background:'#f1f5f9', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ height:'100%', borderRadius:4, width:`${Math.min(b.pct,100)}%`,
                      background:b.pct>=100?'#dc2626':b.pct>=80?'#f59e0b':CAT_COLORS[b.category]||'#888',
                      transition:'width 0.4s ease' }}/>
                  </div>
                  <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{b.pct.toFixed(0)}% of budget used</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recurring */}
        {recurringTxns.length > 0 && (
          <div style={{ ...card, marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'#334155', marginBottom:3 }}>Recurring charges & subscriptions</div>
            <div style={{ fontSize:11, color:'#94a3b8', marginBottom:12 }}>Total: {fmt(recurringTotal)} · {recurringTxns.length} charges detected</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {recurringTxns.map((t,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'#f0f4ff', borderRadius:8, padding:'7px 12px', border:'0.5px solid #c7d7f9' }}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:'#7F77DD', flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:500, color:'#334155' }}>{t.merchant}</div>
                    <div style={{ fontSize:11, color:'#7F77DD', fontWeight:600 }}>{fmt(t.amount)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Secondary filters */}
        <div style={{ ...card, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:500, color:'#64748b', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>Transaction filters</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <input placeholder="Search merchant, category or note..." value={search}
              onChange={e=>{setSearch(e.target.value);setPage(1);}}
              style={{ ...inp, flex:1, minWidth:200 }}/>
            <select value={filterCat} onChange={e=>{setFilterCat(e.target.value);setDrillCat(null);setPage(1);}} style={inp}>
              <option value="All">All categories</option>
              {CATS.map(c=><option key={c}>{c}</option>)}
            </select>
            <select value={filterMethod} onChange={e=>{setFilterMethod(e.target.value);setPage(1);}} style={inp}>
              {METHODS.map(m=><option key={m}>{m}</option>)}
            </select>
            {hasSecondaryFilter && (
              <button onClick={clearSecondary} style={{ ...inp, color:'#dc2626', borderColor:'#fecaca', cursor:'pointer' }}>
                Clear filters
              </button>
            )}
            <div style={{ fontSize:12, color:'#94a3b8', marginLeft:'auto' }}>
              {filtered.length} transactions · {fmt(filteredSpend)}
            </div>
          </div>
        </div>

        {/* Transactions table */}
        <div style={{ ...card, padding:0, overflow:'hidden', marginBottom:20 }}>
          <div style={{ padding:'14px 20px', borderBottom:'0.5px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'#334155' }}>
              {drillCat ? `Transactions — ${drillCat}` : 'All transactions'}
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:11, background:'#FEE2E2', color:'#991B1B', padding:'2px 8px', borderRadius:6 }}>Red = $80+</span>
              <span style={{ fontSize:11, background:'#FEF9C3', color:'#854D0E', padding:'2px 8px', borderRadius:6 }}>Yellow = $40–$79</span>
              <span style={{ fontSize:11, background:'#f0f4ff', color:'#3730A3', padding:'2px 8px', borderRadius:6 }}>• = recurring</span>
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:720 }}>
              <thead>
                <tr>
                  {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCategory','Sub Cat']].map(([col,label])=>(
                    <th key={col} style={th} onClick={()=>handleSort(col)}>{label} {sortArrow(col)}</th>
                  ))}
                  <th style={{ ...th, cursor:'default' }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {paged.length===0
                  ? <tr><td colSpan={7} style={{ ...tdc, textAlign:'center', color:'#94a3b8', padding:32 }}>No transactions found</td></tr>
                  : paged.map((t,i)=>{
                      const flag=flagBg(t.amount);
                      const rec=isRecurring(t.merchant,t.category);
                      const rowBg=flag||(rec?'#f0f4ff':i%2===1?'#f8fafc':'#fff');
                      const txnNote=notes[t.id]||'';
                      const isEditingThis=editingNote===t.id;
                      return (
                        <tr key={t.id} style={{ background:rowBg }}>
                          <td style={{ ...tdc, whiteSpace:'nowrap' }}>{t.date}</td>
                          <td style={{ ...tdc, fontWeight:500, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {rec&&<span style={{ display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#7F77DD',marginRight:6,verticalAlign:'middle' }}/>}
                            {t.merchant}
                          </td>
                          <td style={{ ...tdc, textAlign:'right', fontWeight:600, whiteSpace:'nowrap',
                            color:flag==='#FEE2E2'?'#991B1B':flag==='#FEF9C3'?'#854D0E':'#dc2626' }}>
                            -{fmt(t.amount)}
                          </td>
                          <td style={tdc}>
                            <span style={{ fontSize:11,padding:'2px 8px',borderRadius:20,whiteSpace:'nowrap',
                              background:(METHOD_COLORS[t.method]||'#888')+'18',color:METHOD_COLORS[t.method]||'#475569',fontWeight:500 }}>
                              {t.method||'—'}
                            </span>
                          </td>
                          <td style={tdc}>
                            <span style={{ fontSize:11,padding:'2px 8px',borderRadius:20,whiteSpace:'nowrap',
                              background:(CAT_COLORS[t.category]||'#888')+'18',color:CAT_COLORS[t.category]||'#475569',fontWeight:500 }}>
                              {t.category}
                            </span>
                          </td>
                          <td style={{ ...tdc,color:'#64748b',fontSize:12,whiteSpace:'nowrap' }}>{t.subCategory}</td>
                          <td style={{ ...tdc, minWidth:180 }}>
                            {isEditingThis ? (
                              <div style={{ display:'flex',gap:4,alignItems:'flex-start' }}>
                                <textarea autoFocus value={noteInput} onChange={e=>setNoteInput(e.target.value)}
                                  placeholder="Add a note..." rows={2}
                                  style={{ flex:1,padding:'4px 6px',borderRadius:6,border:'1px solid #378ADD',fontSize:12,resize:'vertical',minWidth:130 }}
                                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveNote(t.id);}if(e.key==='Escape'){setEditingNote(null);setNoteInput('');}}}
                                />
                                <div style={{ display:'flex',flexDirection:'column',gap:3 }}>
                                  <button onClick={()=>saveNote(t.id)} style={{ fontSize:11,background:'#378ADD',color:'#fff',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer' }}>Save</button>
                                  <button onClick={()=>{setEditingNote(null);setNoteInput('');}} style={{ fontSize:11,background:'#f1f5f9',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer' }}>✕</button>
                                </div>
                              </div>
                            ):(
                              <div onClick={()=>{setEditingNote(t.id);setNoteInput(txnNote);}}
                                style={{ cursor:'pointer',minHeight:28,borderRadius:6,padding:'4px 6px',
                                  border:'0.5px dashed #e2e8f0',fontSize:12,
                                  color:txnNote?'#334155':'#94a3b8',
                                  background:txnNote?'#f8fafc':'transparent' }}>
                                {txnNote||'+ Add note'}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                }
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'12px 16px',borderTop:'0.5px solid #f1f5f9' }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ ...inp,opacity:page===1?0.4:1,cursor:'pointer' }}>← Prev</button>
              <span style={{ fontSize:13,color:'#64748b' }}>Page {page} of {totalPages}</span>
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                style={{ ...inp,opacity:page===totalPages?0.4:1,cursor:'pointer' }}>Next →</button>
            </div>
          )}
        </div>

        <div style={{ textAlign:'center',fontSize:11,color:'#cbd5e1',paddingBottom:24 }}>
          Live data from Google Sheets · Rish Finance Dashboard
        </div>
      </div>
    </div>
  );
}
