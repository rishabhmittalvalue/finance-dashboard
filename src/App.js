import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts';
import {
  supabase,
  loadPayPeriods, savePayPeriod, deletePayPeriod,
  loadBofaSettings, saveBofaSettings,
  loadOverallBudget, saveOverallBudget,
  loadCategoryBudgets, saveCategoryBudget, deleteCategoryBudget,
  loadTransactionNotes, saveTransactionNote,
} from './supabase';

// ─── Constants ───────────────────────────────────────────────────────────────
const SHEET_ID = '1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1`;

const AMEX_METHODS = ['Apple Pay Amex', 'Amex Credit Card'];
const BOFA_METHODS = ['Apple Pay BofA', 'BofA Debit Card', 'Zelle'];
const ALL_METHODS = [...AMEX_METHODS, ...BOFA_METHODS, 'Apple Pay Chase', 'Chase Debit Card'];

const CATEGORIES = ['Groceries','Dining','Transport','Subscriptions','Shopping','Housing','Health','Utilities','Travel','Education','Other'];
const SUBCATEGORIES = {
  Groceries: ['Supermarket','Delivery','Convenience'],
  Dining: ['Restaurant','Cafe','Fast Food','Delivery'],
  Transport: ['Rideshare','Public Transit','Fuel'],
  Subscriptions: ['Streaming','Apps','Memberships'],
  Shopping: ['Electronics','Clothing','Online','General'],
  Housing: ['Rent','Utilities','Internet'],
  Health: ['Gym','Medical','Pharmacy'],
  Utilities: ['Electricity','Phone','Water'],
  Travel: ['Flights','Hotels','Transit Fees'],
  Education: ['Tuition','Books','Courses'],
  Other: ['Fees','Charges','Miscellaneous'],
};

const CAT_COLORS = {
  Groceries:'#1D9E75', Dining:'#7F77DD', Transport:'#5F5E5A',
  Subscriptions:'#F59E0B', Shopping:'#EC4899', Housing:'#3B82F6',
  Health:'#10B981', Utilities:'#6366F1', Travel:'#F97316',
  Education:'#8B5CF6', Other:'#94A3B8',
};

const METHOD_COLORS = {
  'Apple Pay Amex':'#1A56DB','Amex Credit Card':'#1D4ED8',
  'Apple Pay BofA':'#D97706','BofA Debit Card':'#B45309',
  'Zelle':'#059669','Apple Pay Chase':'#7C3AED','Chase Debit Card':'#6D28D9',
};

const RECURRING_KEYWORDS = ['netflix','spotify','amazon prime','hulu','apple','google one','microsoft','adobe','visible','walmart+','gym','athletic'];

const fmt = (n) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(Math.abs(n));

// ─── CRITICAL FIX: parse "YYYY-MM-DD" as LOCAL date, not UTC ─────────────────
// new Date("2026-04-15") → UTC midnight → wrong in Chicago (CST/CDT = UTC-5/6)
// parseLocalDate("2026-04-15") → local midnight → correct ✅
function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d); // local midnight — same as transaction dateObjs
}

// ─── Parse Google Sheet date value ───────────────────────────────────────────
function parseSheetDate(v) {
  if (!v && v !== 0) return null;
  const s = String(v).trim();
  // Google Sheets gviz Date(year,month,day) format
  const gviz = s.match(/^Date\((\d+),(\d+),(\d+)\)$/);
  if (gviz) return new Date(+gviz[1], +gviz[2], +gviz[3]);
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(+mdy[3], +mdy[1]-1, +mdy[2]);
  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  // fallback
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// ─── Parse Google Sheets gviz JSON response ───────────────────────────────────
function parseSheet(raw) {
  const json = JSON.parse(raw.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, ''));
  return (json.table.rows || []).map((row, idx) => {
    const c = row.c;
    if (!c || !c[0] || !c[2]) return null;
    const merchant = (c[1]?.v || '').trim();
    const amount = parseFloat(c[2]?.v);
    if (isNaN(amount) || !merchant) return null;
    const method = (c[3]?.v || '').trim();
    const category = (c[4]?.v || 'Other').trim();
    const subCategory = (c[5]?.v || '').trim();
    const isIncome = method.toLowerCase() === 'income';
    const isTransfer = merchant.toLowerCase() === 'amex' && BOFA_METHODS.some(m => m.toLowerCase() === method.toLowerCase());
    const value = isIncome ? Math.abs(amount) : -Math.abs(amount);
    const dateObj = parseSheetDate(c[0]?.v);
    const dateStr = dateObj
      ? dateObj.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' })
      : String(c[0]?.v || '');
    return { id: idx, date: dateStr, dateObj, merchant, amount: value, method, category, subCategory, isIncome, isTransfer };
  }).filter(Boolean);
}

const isAmex = (tx) => AMEX_METHODS.includes(tx.method);
const isBofa = (tx) => BOFA_METHODS.includes(tx.method) || tx.method?.toLowerCase() === 'zelle';
const isRecurring = (tx) => RECURRING_KEYWORDS.some(k => tx.merchant.toLowerCase().includes(k)) || tx.category === 'Subscriptions';

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  card: { background:'#fff', borderRadius:12, border:'0.5px solid #e2e8f0', padding:'16px 20px' },
  th: { padding:'10px 12px', borderBottom:'1px solid #e2e8f0', fontSize:11, fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.05em', textAlign:'left', background:'#f8fafc', cursor:'pointer', whiteSpace:'nowrap' },
  td: { padding:'10px 12px', borderBottom:'0.5px solid #f1f5f9', fontSize:13, color:'#334155', verticalAlign:'middle' },
  inp: { padding:'7px 10px', borderRadius:8, border:'0.5px solid #e2e8f0', fontSize:13, background:'#fff', color:'#334155', outline:'none' },
  btn: (variant='primary') => ({
    padding:'7px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:500,
    background: variant==='primary'?'#3B82F6': variant==='danger'?'#EF4444':'#f1f5f9',
    color: variant==='ghost'?'#64748b':'#fff',
  }),
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState('overview');

  // Sheet data
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  // Supabase data
  const [payPeriods, setPayPeriods] = useState([]);
  const [bofaMinBalance, setBofaMinBalance] = useState(0);
  const [overallBudget, setOverallBudget] = useState(null);
  const [categoryBudgets, setCategoryBudgets] = useState([]);
  const [notes, setNotes] = useState({});

  // Tab 2 UI state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [filterMethod, setFilterMethod] = useState('All');
  const [search, setSearch] = useState('');
  const [drillCat, setDrillCat] = useState(null);
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  // Period modal
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null);
  const [periodForm, setPeriodForm] = useState({ label:'', start_date:'', end_date:'', budget_amount:'' });

  // Budget UI
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCat, setBudgetCat] = useState('');
  const [budgetAmt, setBudgetAmt] = useState('');
  const [editingOverallBudget, setEditingOverallBudget] = useState(false);
  const [overallBudgetInput, setOverallBudgetInput] = useState('');

  // Min balance editing
  const [editingMinBal, setEditingMinBal] = useState(false);
  const [minBalInput, setMinBalInput] = useState('');

  // ── Load sheet data ──────────────────────────────────────────────────────
  const refreshSheet = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(SHEET_URL);
      const text = await res.text();
      setTransactions(parseSheet(text));
      setLastRefresh(new Date());
    } catch {
      setError('Could not load sheet data. Make sure your Google Sheet is set to public viewer.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load Supabase data ───────────────────────────────────────────────────
  useEffect(() => {
    refreshSheet();
    (async () => {
      const [periods, settings, budget, catBudgets, txNotes] = await Promise.all([
        loadPayPeriods(), loadBofaSettings(), loadOverallBudget(), loadCategoryBudgets(), loadTransactionNotes(),
      ]);
      setPayPeriods(periods);
      if (settings?.min_balance != null) setBofaMinBalance(settings.min_balance);
      setOverallBudget(budget);
      setCategoryBudgets(catBudgets);
      setNotes(txNotes);
    })();
  }, []);

  // ── Derived transaction sets ─────────────────────────────────────────────
  const expenses = useMemo(() => transactions.filter(t => !t.isIncome && !t.isTransfer), [transactions]);
  const incomes = useMemo(() => transactions.filter(t => t.isIncome), [transactions]);
  const amexTransfers = useMemo(() => transactions.filter(t => t.isTransfer), [transactions]);

  const bofaExpenses = useMemo(() => expenses.filter(isBofa), [expenses]);
  const amexExpenses = useMemo(() => expenses.filter(isAmex), [expenses]);

  // ── Tab 1: Financial Overview calculations ───────────────────────────────
  const totalIncome = useMemo(() => incomes.reduce((s,t) => s + t.amount, 0), [incomes]);
  const totalBofaDirect = useMemo(() => bofaExpenses.reduce((s,t) => s + Math.abs(t.amount), 0), [bofaExpenses]);
  const totalAmexPaidFromBofa = useMemo(() => amexTransfers.reduce((s,t) => s + Math.abs(t.amount), 0), [amexTransfers]);
  const totalAmexCharged = useMemo(() => amexExpenses.reduce((s,t) => s + Math.abs(t.amount), 0), [amexExpenses]);
  const outstandingAmex = useMemo(() => Math.max(0, totalAmexCharged - totalAmexPaidFromBofa), [totalAmexCharged, totalAmexPaidFromBofa]);
  const bofaBalance = useMemo(() => totalIncome - totalBofaDirect - totalAmexPaidFromBofa - bofaMinBalance, [totalIncome, totalBofaDirect, totalAmexPaidFromBofa, bofaMinBalance]);

  // ── Tab 2: Date-filtered transactions ────────────────────────────────────
  const dateFiltered = useMemo(() => {
    let txs = expenses;
    if (dateFrom) { const d = parseLocalDate(dateFrom); if (d) txs = txs.filter(t => t.dateObj && t.dateObj >= d); }
    if (dateTo) { const d = parseLocalDate(dateTo + 'T23:59:59'); if (d) txs = txs.filter(t => t.dateObj && t.dateObj <= new Date(parseLocalDate(dateTo).getTime() + 86399999)); }
    return txs;
  }, [expenses, dateFrom, dateTo]);

  const filteredTxs = useMemo(() => {
    let txs = drillCat ? dateFiltered.filter(t => t.category === drillCat) : dateFiltered;
    if (filterCat !== 'All') txs = txs.filter(t => t.category === filterCat);
    if (filterMethod !== 'All') txs = txs.filter(t => t.method === filterMethod);
    if (search) txs = txs.filter(t => t.merchant.toLowerCase().includes(search.toLowerCase()) || (notes[t.id]||'').toLowerCase().includes(search.toLowerCase()));
    return txs;
  }, [dateFiltered, drillCat, filterCat, filterMethod, search, notes]);

  const sortedTxs = useMemo(() => [...filteredTxs].sort((a,b) => {
    if (sortCol === 'date') { const da = a.dateObj||new Date(0), db = b.dateObj||new Date(0); return sortDir==='asc'?da-db:db-da; }
    if (sortCol === 'amount') return sortDir==='asc'?Math.abs(a.amount)-Math.abs(b.amount):Math.abs(b.amount)-Math.abs(a.amount);
    return sortDir==='asc'?(a[sortCol]||'').localeCompare(b[sortCol]||''):(b[sortCol]||'').localeCompare(a[sortCol]||'');
  }), [filteredTxs, sortCol, sortDir]);

  const PAGE_SIZE = 20;
  const pagedTxs = useMemo(() => sortedTxs.slice(PAGE_SIZE*(page-1), PAGE_SIZE*page), [sortedTxs, page]);
  const totalPages = Math.ceil(sortedTxs.length / PAGE_SIZE);

  // ── Pay period calculations — THE FIX: use parseLocalDate ────────────────
  const enrichedPeriods = useMemo(() => payPeriods.map(p => {
    // FIX: parse as local date, not UTC
    const start = parseLocalDate(p.start_date);
    const end = parseLocalDate(p.end_date);
    if (!start || !end) return { ...p, bofaSpend:0, amexSpend:0, total:0, saved:p.budget_amount, days:0, daysPassed:0, isCurrent:false };

    // Set end to end of day (local)
    const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);

    // Filter transactions within this period
    const periodTxs = expenses.filter(t => t.dateObj && t.dateObj >= start && t.dateObj <= endOfDay);

    const bofaSpend = periodTxs.filter(isBofa).reduce((s,t) => s + Math.abs(t.amount), 0);
    const amexSpend = periodTxs.filter(isAmex).reduce((s,t) => s + Math.abs(t.amount), 0);
    const total = bofaSpend + amexSpend;
    const saved = p.budget_amount - total;
    const days = Math.ceil((endOfDay - start) / 86400000);
    const now = new Date();
    const daysPassed = Math.min(Math.ceil((now - start) / 86400000), days);
    const isCurrent = now >= start && now <= endOfDay;

    return { ...p, start, end: endOfDay, bofaSpend, amexSpend, total, saved, days, daysPassed, isCurrent, periodTxs };
  }), [payPeriods, expenses]);

  const currentPeriod = useMemo(() => enrichedPeriods.find(p => p.isCurrent) || enrichedPeriods[0] || null, [enrichedPeriods]);
  const lastPeriod = useMemo(() => {
    if (!currentPeriod) return enrichedPeriods[0] || null;
    const idx = enrichedPeriods.indexOf(currentPeriod);
    return enrichedPeriods[idx+1] || null;
  }, [enrichedPeriods, currentPeriod]);

  // ── Category donut data ──────────────────────────────────────────────────
  const catData = useMemo(() => {
    const map = {};
    dateFiltered.forEach(t => { map[t.category] = (map[t.category]||0) + Math.abs(t.amount); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a,b) => b.value-a.value);
  }, [dateFiltered]);

  const totalFiltered = useMemo(() => dateFiltered.reduce((s,t) => s + Math.abs(t.amount), 0), [dateFiltered]);

  // ── BofA vs AMEX bar data (for filtered range) ───────────────────────────
  const sourceData = useMemo(() => [
    { name:'BofA', amount: dateFiltered.filter(isBofa).reduce((s,t)=>s+Math.abs(t.amount),0) },
    { name:'AMEX', amount: dateFiltered.filter(isAmex).reduce((s,t)=>s+Math.abs(t.amount),0) },
  ], [dateFiltered]);

  // ── Recurring charges ────────────────────────────────────────────────────
  const recurringTxs = useMemo(() => dateFiltered.filter(isRecurring), [dateFiltered]);

  // ── Save period ──────────────────────────────────────────────────────────
  const handleSavePeriod = async () => {
    if (!periodForm.start_date || !periodForm.end_date || !periodForm.budget_amount) return;
    const toSave = {
      ...editingPeriod,
      label: periodForm.label,
      start_date: periodForm.start_date,
      end_date: periodForm.end_date,
      budget_amount: parseFloat(periodForm.budget_amount),
    };
    const saved = await savePayPeriod(toSave);
    setPayPeriods(prev => {
      const exists = prev.find(p => p.id === saved.id);
      return exists ? prev.map(p => p.id===saved.id?saved:p) : [saved, ...prev];
    });
    setShowPeriodModal(false); setEditingPeriod(null); setPeriodForm({label:'',start_date:'',end_date:'',budget_amount:''});
  };

  const handleDeletePeriod = async (id) => {
    await deletePayPeriod(id);
    setPayPeriods(prev => prev.filter(p => p.id !== id));
  };

  const handleSaveMinBalance = async () => {
    const val = parseFloat(minBalInput) || 0;
    setBofaMinBalance(val);
    await saveBofaSettings({ min_balance: val });
    setEditingMinBal(false);
  };

  const handleSaveOverallBudget = async () => {
    const val = parseFloat(overallBudgetInput) || null;
    setOverallBudget(val);
    if (val) await saveOverallBudget(val);
    setEditingOverallBudget(false);
  };

  const handleAddCategoryBudget = async () => {
    if (!budgetCat || !budgetAmt) return;
    const amt = parseFloat(budgetAmt);
    await saveCategoryBudget(budgetCat, amt);
    setCategoryBudgets(prev => { const exists = prev.find(b=>b.category===budgetCat); return exists?prev.map(b=>b.category===budgetCat?{...b,amount:amt}:b):[...prev,{category:budgetCat,amount:amt}]; });
    setBudgetCat(''); setBudgetAmt('');
  };

  const handleDeleteCategoryBudget = async (cat) => {
    await deleteCategoryBudget(cat);
    setCategoryBudgets(prev => prev.filter(b => b.category !== cat));
  };

  const handleSaveNote = async (txId, note) => {
    setNotes(prev => ({ ...prev, [txId]: note }));
    await saveTransactionNote(txId, note);
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d==='asc'?'desc':'asc');
    else { setSortCol(col); setSortDir('desc'); }
    setPage(1);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#f4f6fb', fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'0 24px', display:'flex', alignItems:'center', gap:24, position:'sticky', top:0, zIndex:100 }}>
        <div style={{ fontSize:18, fontWeight:700, color:'#1e293b', padding:'14px 0', marginRight:8 }}>💰 My Finance</div>
        {['overview','tracker'].map(tab => (
          <button key={tab} onClick={()=>setActiveTab(tab)} style={{ padding:'14px 4px', background:'none', border:'none', cursor:'pointer', fontSize:14, fontWeight:activeTab===tab?600:400, color:activeTab===tab?'#3B82F6':'#64748b', borderBottom:activeTab===tab?'2px solid #3B82F6':'2px solid transparent' }}>
            {tab==='overview'?'Financial Overview':'Pay Period Tracker'}
          </button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          {lastRefresh && <span style={{ fontSize:11, color:'#94a3b8' }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={refreshSheet} style={S.btn('ghost')} disabled={loading}>{loading?'Loading…':'↻ Refresh'}</button>
        </div>
      </div>

      {error && <div style={{ background:'#FEF2F2', color:'#B91C1C', padding:'10px 24px', fontSize:13 }}>{error}</div>}

      <div style={{ padding:24, maxWidth:1400, margin:'0 auto' }}>
        {/* ═══════════════════ TAB 1: FINANCIAL OVERVIEW ═══════════════════ */}
        {activeTab === 'overview' && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            {/* Two hero cards */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
              {/* BofA Card */}
              <div style={{ ...S.card, border:'1px solid #BFDBFE' }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#3B82F6', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Bank of America</div>
                <div style={{ fontSize:36, fontWeight:700, color: bofaBalance >= 0 ? '#1e293b' : '#DC2626', marginBottom:16 }}>{fmt(bofaBalance)}</div>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:2 }}>What should be in your account</div>
                <hr style={{ border:'none', borderTop:'1px solid #EFF6FF', margin:'12px 0' }}/>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {[
                    ['+ Total Income', totalIncome, '#10B981'],
                    ['− Direct BofA Spend', -totalBofaDirect, '#DC2626'],
                    ['− Paid to AMEX', -totalAmexPaidFromBofa, '#F59E0B'],
                    ['− Min Balance Reserve', -bofaMinBalance, '#6366F1'],
                  ].map(([label, val, color]) => (
                    <div key={label} style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
                      <span style={{ color:'#64748b' }}>{label}</span>
                      <span style={{ fontWeight:600, color }}>{fmt(val)}</span>
                    </div>
                  ))}
                </div>
                <hr style={{ border:'none', borderTop:'1px solid #EFF6FF', margin:'12px 0' }}/>
                {editingMinBal ? (
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ fontSize:12, color:'#64748b' }}>Min balance:</span>
                    <input value={minBalInput} onChange={e=>setMinBalInput(e.target.value)} style={{ ...S.inp, width:100 }} type="number"/>
                    <button onClick={handleSaveMinBalance} style={S.btn('primary')}>Save</button>
                    <button onClick={()=>setEditingMinBal(false)} style={S.btn('ghost')}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:12, color:'#64748b' }}>Min balance reserve: <strong>{fmt(bofaMinBalance)}</strong></span>
                    <button onClick={()=>{setMinBalInput(String(bofaMinBalance));setEditingMinBal(true);}} style={{ ...S.btn('ghost'), padding:'4px 10px', fontSize:12 }}>Edit</button>
                  </div>
                )}
              </div>

              {/* AMEX Card */}
              <div style={{ ...S.card, border:'1px solid #C7D2FE' }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#6366F1', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>American Express</div>
                <div style={{ fontSize:36, fontWeight:700, color:'#1e293b', marginBottom:16 }}>{fmt(outstandingAmex)}</div>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:2 }}>Total outstanding spend on your AMEX</div>
                <hr style={{ border:'none', borderTop:'1px solid #EEF2FF', margin:'12px 0' }}/>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {[
                    ['Total AMEX Charged', totalAmexCharged, '#DC2626'],
                    ['Paid from BofA', -totalAmexPaidFromBofa, '#10B981'],
                  ].map(([label, val, color]) => (
                    <div key={label} style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
                      <span style={{ color:'#64748b' }}>{label}</span>
                      <span style={{ fontWeight:600, color }}>{fmt(val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Income breakdown */}
            <div style={S.card}>
              <div style={{ fontWeight:600, color:'#1e293b', marginBottom:12 }}>Income Sources</div>
              {incomes.length === 0 ? (
                <div style={{ color:'#94a3b8', fontSize:13 }}>No income transactions found. Mark a transaction's Method as "Income" to include it here.</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><th style={S.th}>Date</th><th style={S.th}>Source</th><th style={{...S.th,textAlign:'right'}}>Amount</th></tr></thead>
                  <tbody>
                    {incomes.map(t => (
                      <tr key={t.id}>
                        <td style={S.td}>{t.date}</td>
                        <td style={S.td}>{t.merchant}</td>
                        <td style={{...S.td,textAlign:'right',color:'#10B981',fontWeight:600}}>{fmt(t.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════ TAB 2: PAY PERIOD TRACKER ═══════════════════ */}
        {activeTab === 'tracker' && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

            {/* Sticky date filter + overall budget */}
            <div style={{ ...S.card, position:'sticky', top:57, zIndex:90, display:'flex', flexWrap:'wrap', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:13, fontWeight:500, color:'#64748b' }}>Date Filter:</span>
              <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}} style={S.inp} placeholder="From"/>
              <span style={{ color:'#94a3b8' }}>→</span>
              <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}} style={S.inp} placeholder="To (today if blank)"/>
              {(dateFrom||dateTo) && (
                <button onClick={()=>{setDateFrom('');setDateTo('');setPage(1);}} style={{ ...S.btn('ghost'), fontSize:12 }}>✕ Clear</button>
              )}
              <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
                {overallBudget ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:13, color:'#64748b' }}>Budget: <strong>{fmt(overallBudget)}</strong></span>
                    <div style={{ width:120, height:6, background:'#e2e8f0', borderRadius:99 }}>
                      <div style={{ width:`${Math.min(100,totalFiltered/overallBudget*100)}%`, height:'100%', background: totalFiltered>overallBudget?'#DC2626':totalFiltered/overallBudget>0.8?'#F59E0B':'#10B981', borderRadius:99 }}/>
                    </div>
                    <span style={{ fontSize:12, color: totalFiltered>overallBudget?'#DC2626':'#10B981' }}>{fmt(overallBudget-totalFiltered)} {totalFiltered>overallBudget?'over':'left'}</span>
                    <button onClick={()=>{setOverallBudgetInput(String(overallBudget));setEditingOverallBudget(true);}} style={{ ...S.btn('ghost'), padding:'3px 8px', fontSize:11 }}>Edit</button>
                  </div>
                ) : editingOverallBudget ? (
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input value={overallBudgetInput} onChange={e=>setOverallBudgetInput(e.target.value)} style={{ ...S.inp, width:100 }} type="number" placeholder="Budget $"/>
                    <button onClick={handleSaveOverallBudget} style={S.btn()}>Save</button>
                    <button onClick={()=>setEditingOverallBudget(false)} style={S.btn('ghost')}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={()=>setEditingOverallBudget(true)} style={{ ...S.btn('ghost'), fontSize:12 }}>+ Set Overall Budget</button>
                )}
              </div>
            </div>

            {/* Current Period Card */}
            <div style={{ ...S.card, background: 'linear-gradient(135deg,#1e40af,#3B82F6)', color:'#fff', border:'none' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
                <div>
                  <div style={{ fontSize:11, opacity:.75, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.1em' }}>Current Pay Period</div>
                  <div style={{ fontSize:22, fontWeight:700 }}>{currentPeriod ? (currentPeriod.label || `${currentPeriod.start_date} → ${currentPeriod.end_date}`) : 'No period set'}</div>
                  {currentPeriod && <div style={{ fontSize:13, opacity:.75, marginTop:2 }}>Day {currentPeriod.daysPassed} of {currentPeriod.days}</div>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {currentPeriod && (
                    <button onClick={()=>{setEditingPeriod(currentPeriod);setPeriodForm({label:currentPeriod.label||'',start_date:currentPeriod.start_date,end_date:currentPeriod.end_date,budget_amount:String(currentPeriod.budget_amount)});setShowPeriodModal(true);}} style={{ ...S.btn('ghost'), background:'rgba(255,255,255,0.2)', color:'#fff' }}>Edit</button>
                  )}
                  <button onClick={()=>{setEditingPeriod(null);setPeriodForm({label:'',start_date:'',end_date:'',budget_amount:''});setShowPeriodModal(true);}} style={{ ...S.btn('ghost'), background:'rgba(255,255,255,0.2)', color:'#fff' }}>+ New Period</button>
                </div>
              </div>
              {currentPeriod && (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:16, marginTop:20 }}>
                    {[
                      ['Budget', fmt(currentPeriod.budget_amount)],
                      ['BofA Spend', fmt(currentPeriod.bofaSpend)],
                      ['AMEX Spend', fmt(currentPeriod.amexSpend)],
                      ['Total Spent', fmt(currentPeriod.total)],
                      [currentPeriod.saved>=0?'Remaining':'Over by', fmt(Math.abs(currentPeriod.saved))],
                    ].map(([label,val]) => (
                      <div key={label}>
                        <div style={{ fontSize:11, opacity:.7 }}>{label}</div>
                        <div style={{ fontSize:18, fontWeight:700 }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:16 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, opacity:.75, marginBottom:4 }}>
                      <span>{Math.round(currentPeriod.budget_amount>0?currentPeriod.total/currentPeriod.budget_amount*100:0)}% of budget used</span>
                      <span>{currentPeriod.days - currentPeriod.daysPassed} days left</span>
                    </div>
                    <div style={{ height:8, background:'rgba(255,255,255,0.3)', borderRadius:99 }}>
                      <div style={{ height:'100%', borderRadius:99, background: currentPeriod.total > currentPeriod.budget_amount ? '#FCA5A5' : '#fff', width:`${Math.min(100, currentPeriod.budget_amount>0?currentPeriod.total/currentPeriod.budget_amount*100:0)}%` }}/>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* This Period vs Last Period */}
            {(currentPeriod || lastPeriod) && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {[['This Period', currentPeriod], ['Last Period', lastPeriod]].map(([label, p]) => (
                  <div key={label} style={{ ...S.card, borderLeft: label==='This Period'?'3px solid #3B82F6':'3px solid #94a3b8' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{label}</div>
                    {p ? (
                      <>
                        <div style={{ fontSize:14, fontWeight:600, color:'#1e293b', marginBottom:10 }}>{p.label || `${p.start_date} → ${p.end_date}`}</div>
                        {[['Budget', fmt(p.budget_amount)],['BofA', fmt(p.bofaSpend)],['AMEX', fmt(p.amexSpend)],['Total', fmt(p.total)],[p.saved>=0?'Saved':'Over', fmt(Math.abs(p.saved))]].map(([l,v]) => (
                          <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4 }}>
                            <span style={{ color:'#64748b' }}>{l}</span>
                            <span style={{ fontWeight:600 }}>{v}</span>
                          </div>
                        ))}
                        <div style={{ fontSize:12, color: p.saved>=0?'#10B981':'#DC2626', marginTop:6, fontWeight:600 }}>
                          {p.budget_amount>0?Math.round((1-p.total/p.budget_amount)*100):0}% {p.saved>=0?'saved':'over budget'}
                        </div>
                      </>
                    ) : <div style={{ color:'#94a3b8', fontSize:13 }}>No data</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Charts Row */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
              {/* Category Donut */}
              <div style={S.card}>
                <div style={{ fontWeight:600, color:'#1e293b', marginBottom:8, fontSize:14 }}>Spend by Category</div>
                {catData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={catData} cx="50%" cy="50%" outerRadius={80} dataKey="value" onClick={d => setDrillCat(prev => prev===d.name?null:d.name)}>
                          {catData.map(d => <Cell key={d.name} fill={CAT_COLORS[d.name]||'#94a3b8'} opacity={drillCat&&drillCat!==d.name?0.4:1}/>)}
                        </Pie>
                        <Tooltip formatter={v=>[fmt(v),'Amount']}/>
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:8 }}>
                      {catData.slice(0,6).map(d => (
                        <div key={d.name} onClick={()=>setDrillCat(prev=>prev===d.name?null:d.name)} style={{ display:'flex', justifyContent:'space-between', fontSize:12, cursor:'pointer', opacity: drillCat&&drillCat!==d.name?0.4:1 }}>
                          <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <span style={{ width:8, height:8, borderRadius:'50%', background:CAT_COLORS[d.name]||'#94a3b8', display:'inline-block' }}/>
                            {d.name}
                          </span>
                          <span style={{ fontWeight:600 }}>{fmt(d.value)} <span style={{ color:'#94a3b8' }}>({totalFiltered>0?Math.round(d.value/totalFiltered*100):0}%)</span></span>
                        </div>
                      ))}
                    </div>
                    {drillCat && <button onClick={()=>setDrillCat(null)} style={{ marginTop:8, ...S.btn('ghost'), width:'100%', fontSize:12 }}>✕ Clear filter: {drillCat}</button>}
                  </>
                ) : <div style={{ color:'#94a3b8', fontSize:13 }}>No expense data</div>}
              </div>

              {/* BofA vs AMEX Bar */}
              <div style={S.card}>
                <div style={{ fontWeight:600, color:'#1e293b', marginBottom:8, fontSize:14 }}>BofA vs AMEX</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={sourceData} margin={{top:0,right:0,left:0,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="name" tick={{fontSize:12}}/>
                    <YAxis tick={{fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                    <Tooltip formatter={v=>[fmt(v),'Spend']}/>
                    <Bar dataKey="amount" radius={[6,6,0,0]}>
                      <Cell fill="#D97706"/>
                      <Cell fill="#1D4ED8"/>
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Recurring */}
              <div style={S.card}>
                <div style={{ fontWeight:600, color:'#1e293b', marginBottom:8, fontSize:14 }}>🔄 Recurring Charges</div>
                <div style={{ fontSize:12, color:'#6366F1', marginBottom:10 }}>
                  {recurringTxs.length} charges · {fmt(recurringTxs.reduce((s,t)=>s+Math.abs(t.amount),0))} total
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:220, overflowY:'auto' }}>
                  {recurringTxs.length===0 ? <div style={{ color:'#94a3b8', fontSize:12 }}>None detected</div> :
                    recurringTxs.map(t => (
                      <div key={t.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 8px', background:'#EEF2FF', borderRadius:6 }}>
                        <span style={{ fontSize:12, color:'#4338CA' }}>{t.merchant}</span>
                        <span style={{ fontSize:12, fontWeight:600, color:'#4338CA' }}>{fmt(t.amount)}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* Period History Table */}
            <div style={S.card}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div style={{ fontWeight:600, color:'#1e293b' }}>Period History</div>
                <button onClick={()=>{setEditingPeriod(null);setPeriodForm({label:'',start_date:'',end_date:'',budget_amount:''});setShowPeriodModal(true);}} style={S.btn()}>+ New Period</button>
              </div>
              {enrichedPeriods.length === 0 ? (
                <div style={{ color:'#94a3b8', fontSize:13 }}>No periods yet. Create your first pay period above.</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    {['Period','Budget','BofA','AMEX','Total','+/−','Rate',''].map(h=><th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {enrichedPeriods.map(p => (
                      <tr key={p.id} style={{ background: p.isCurrent?'#EFF6FF':'transparent' }}>
                        <td style={S.td}><span style={{ fontWeight:p.isCurrent?600:400 }}>{p.label||`${p.start_date} → ${p.end_date}`}</span>{p.isCurrent&&<span style={{ marginLeft:6, fontSize:10, background:'#BFDBFE', color:'#1D4ED8', padding:'1px 5px', borderRadius:99 }}>Current</span>}</td>
                        <td style={S.td}>{fmt(p.budget_amount)}</td>
                        <td style={S.td}>{fmt(p.bofaSpend)}</td>
                        <td style={S.td}>{fmt(p.amexSpend)}</td>
                        <td style={{...S.td,fontWeight:600}}>{fmt(p.total)}</td>
                        <td style={{...S.td,color:p.saved>=0?'#10B981':'#DC2626',fontWeight:600}}>{p.saved>=0?'+':''}{fmt(p.saved)}</td>
                        <td style={{...S.td,color:p.saved>=0?'#10B981':'#DC2626'}}>{p.budget_amount>0?Math.round((1-p.total/p.budget_amount)*100):0}% {p.saved>=0?'✅':'❌'}</td>
                        <td style={S.td}>
                          <div style={{ display:'flex', gap:6 }}>
                            <button onClick={()=>{setEditingPeriod(p);setPeriodForm({label:p.label||'',start_date:p.start_date,end_date:p.end_date,budget_amount:String(p.budget_amount)});setShowPeriodModal(true);}} style={{ ...S.btn('ghost'), padding:'3px 8px', fontSize:11 }}>Edit</button>
                            <button onClick={()=>handleDeletePeriod(p.id)} style={{ ...S.btn('danger'), padding:'3px 8px', fontSize:11 }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Savings Trend */}
            {enrichedPeriods.length > 0 && (
              <div style={S.card}>
                <div style={{ fontWeight:600, color:'#1e293b', marginBottom:12 }}>Savings Trend</div>
                {enrichedPeriods.map(p => {
                  const pct = p.budget_amount>0?Math.min(100,p.total/p.budget_amount*100):0;
                  return (
                    <div key={p.id} style={{ marginBottom:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#64748b', marginBottom:3 }}>
                        <span>{p.label||`${p.start_date} → ${p.end_date}`}</span>
                        <span style={{ fontWeight:600, color:p.saved>=0?'#10B981':'#DC2626' }}>{p.saved>=0?'Saved':'Over'} {fmt(Math.abs(p.saved))}</span>
                      </div>
                      <div style={{ height:6, background:'#e2e8f0', borderRadius:99 }}>
                        <div style={{ height:'100%', width:`${pct}%`, borderRadius:99, background:p.saved>=0?'#10B981':'#DC2626' }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Category Budgets */}
            <div style={S.card}>
              <div style={{ fontWeight:600, color:'#1e293b', marginBottom:12 }}>Category Budgets</div>
              <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
                <select value={budgetCat} onChange={e=>setBudgetCat(e.target.value)} style={S.inp}>
                  <option value="">Select category…</option>
                  {CATEGORIES.filter(c=>!categoryBudgets.find(b=>b.category===c)).map(c=><option key={c}>{c}</option>)}
                </select>
                <input type="number" placeholder="Budget $" value={budgetAmt} onChange={e=>setBudgetAmt(e.target.value)} style={{ ...S.inp, width:120 }}/>
                <button onClick={handleAddCategoryBudget} style={S.btn()}>+ Add Budget</button>
              </div>
              {categoryBudgets.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {categoryBudgets.map(b => {
                    const spent = dateFiltered.filter(t=>t.category===b.category).reduce((s,t)=>s+Math.abs(t.amount),0);
                    const pct = b.amount>0?Math.min(100,spent/b.amount*100):0;
                    return (
                      <div key={b.category}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4 }}>
                          <span style={{ fontWeight:500 }}>{b.category}</span>
                          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                            <span style={{ color:'#64748b' }}>{fmt(spent)} / {fmt(b.amount)}</span>
                            <button onClick={()=>handleDeleteCategoryBudget(b.category)} style={{ ...S.btn('ghost'), padding:'2px 6px', fontSize:11 }}>✕</button>
                          </div>
                        </div>
                        <div style={{ height:6, background:'#e2e8f0', borderRadius:99 }}>
                          <div style={{ height:'100%', width:`${pct}%`, borderRadius:99, background:pct>=100?'#DC2626':pct>=80?'#F59E0B':'#3B82F6' }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Transaction Filters */}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <input placeholder="Search merchant or note…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{ ...S.inp, flex:1, minWidth:200 }}/>
              <select value={filterCat} onChange={e=>{setFilterCat(e.target.value);setPage(1);}} style={S.inp}>
                <option value="All">All Categories</option>
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
              <select value={filterMethod} onChange={e=>{setFilterMethod(e.target.value);setPage(1);}} style={S.inp}>
                <option value="All">All Methods</option>
                {ALL_METHODS.map(m=><option key={m}>{m}</option>)}
              </select>
              {(search||filterCat!=='All'||filterMethod!=='All'||drillCat) && (
                <button onClick={()=>{setSearch('');setFilterCat('All');setFilterMethod('All');setDrillCat(null);setPage(1);}} style={S.btn('ghost')}>Clear all filters</button>
              )}
              <span style={{ fontSize:12, color:'#94a3b8', marginLeft:'auto' }}>{sortedTxs.length} transactions · {fmt(sortedTxs.reduce((s,t)=>s+Math.abs(t.amount),0))}</span>
            </div>

            {/* Transactions Table */}
            <div style={S.card}>
              {drillCat && (
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, background:'#EFF6FF', padding:'8px 12px', borderRadius:8 }}>
                  <span style={{ fontSize:13, color:'#1D4ED8' }}>Showing: <strong>{drillCat}</strong></span>
                  <button onClick={()=>setDrillCat(null)} style={{ ...S.btn('ghost'), padding:'2px 8px', fontSize:12 }}>✕</button>
                </div>
              )}
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCategory','Sub Category'],['note','Note']].map(([col,label])=>(
                      <th key={col} style={S.th} onClick={()=>col!=='note'&&handleSort(col)}>
                        {label}{sortCol===col?(sortDir==='asc'?' ↑':' ↓'):''}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {pagedTxs.length===0 ? (
                      <tr><td colSpan={7} style={{ ...S.td, textAlign:'center', color:'#94a3b8', padding:32 }}>No transactions found</td></tr>
                    ) : pagedTxs.map(t => {
                      const amt = Math.abs(t.amount);
                      const rowBg = isRecurring(t)?'#EEF2FF': amt>=80?'#FEF2F2': amt>=40?'#FFFBEB':'transparent';
                      const amtColor = amt>=80?'#DC2626': amt>=40?'#D97706':'#1e293b';
                      return (
                        <tr key={t.id} style={{ background:rowBg }}>
                          <td style={S.td}>{t.date}</td>
                          <td style={S.td}>
                            {t.merchant}
                            {isRecurring(t)&&<span style={{ marginLeft:5, fontSize:10, color:'#6366F1' }}>●</span>}
                          </td>
                          <td style={{...S.td,fontWeight:600,color:amtColor}}>{fmt(t.amount)}</td>
                          <td style={S.td}><span style={{ padding:'2px 8px', borderRadius:99, background:METHOD_COLORS[t.method]||'#e2e8f0', color:'#fff', fontSize:11 }}>{t.method}</span></td>
                          <td style={S.td}><span style={{ padding:'2px 8px', borderRadius:99, background:CAT_COLORS[t.category]||'#e2e8f0', color:'#fff', fontSize:11 }}>{t.category}</span></td>
                          <td style={{...S.td,fontSize:12,color:'#64748b'}}>{t.subCategory}</td>
                          <td style={S.td}><NoteCell txId={t.id} note={notes[t.id]||''} onSave={handleSaveNote}/></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display:'flex', justifyContent:'center', gap:8, marginTop:12 }}>
                  <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={S.btn('ghost')}>← Prev</button>
                  <span style={{ fontSize:13, color:'#64748b', alignSelf:'center' }}>Page {page} of {totalPages}</span>
                  <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} style={S.btn('ghost')}>Next →</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Period Modal */}
      {showPeriodModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <div style={{ ...S.card, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight:600, fontSize:16, color:'#1e293b', marginBottom:16 }}>{editingPeriod?'Edit Period':'New Pay Period'}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={{ fontSize:12, color:'#64748b', display:'block', marginBottom:4 }}>Label (optional)</label>
                <input value={periodForm.label} onChange={e=>setPeriodForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Apr 15–30" style={{ ...S.inp, width:'100%' }}/>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:12, color:'#64748b', display:'block', marginBottom:4 }}>Start Date</label>
                  <input type="date" value={periodForm.start_date} onChange={e=>setPeriodForm(f=>({...f,start_date:e.target.value}))} style={{ ...S.inp, width:'100%' }}/>
                </div>
                <div>
                  <label style={{ fontSize:12, color:'#64748b', display:'block', marginBottom:4 }}>End Date</label>
                  <input type="date" value={periodForm.end_date} onChange={e=>setPeriodForm(f=>({...f,end_date:e.target.value}))} style={{ ...S.inp, width:'100%' }}/>
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, color:'#64748b', display:'block', marginBottom:4 }}>Budget Amount ($)</label>
                <input type="number" value={periodForm.budget_amount} onChange={e=>setPeriodForm(f=>({...f,budget_amount:e.target.value}))} placeholder="e.g. 3200" style={{ ...S.inp, width:'100%' }}/>
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={()=>{setShowPeriodModal(false);setEditingPeriod(null);}} style={S.btn('ghost')}>Cancel</button>
              <button onClick={handleSavePeriod} style={S.btn()}>Save Period</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Note Cell ───────────────────────────────────────────────────────────────
function NoteCell({ txId, note, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(note);
  useEffect(() => setVal(note), [note]);
  if (editing) return (
    <div style={{ display:'flex', gap:4 }}>
      <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){onSave(txId,val);setEditing(false);} if(e.key==='Escape')setEditing(false); }} style={{ fontSize:12, padding:'3px 6px', borderRadius:6, border:'1px solid #CBD5E1', outline:'none', width:140 }} autoFocus/>
      <button onClick={()=>{onSave(txId,val);setEditing(false);}} style={{ fontSize:11, padding:'2px 6px', background:'#3B82F6', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>✓</button>
    </div>
  );
  return (
    <span onClick={()=>setEditing(true)} style={{ fontSize:12, color: note?'#334155':'#CBD5E1', cursor:'pointer', borderBottom:'1px dashed #CBD5E1', paddingBottom:1 }}>
      {note || '+ note'}
    </span>
  );
}
