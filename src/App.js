import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  loadPayPeriods, savePayPeriod, deletePayPeriod,
  loadBofaSettings, saveBofaSettings,
  loadOverallBudget, saveOverallBudget,
  loadCategoryBudgets, saveCategoryBudget, deleteCategoryBudget,
  loadTransactionNotes, saveTransactionNote,
} from './supabase';

// ─── Google Sheet ─────────────────────────────────────────────────────────────
const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ/gviz/tq?tqx=out:json&sheet=Sheet1';

// ─── RULES (source of truth) ──────────────────────────────────────────────────
// Rule 1: ALL amounts are treated as positive expenses — ignore any negative signs
// Rule 2: Method === 'Income'  →  income (added to BofA balance)
// Rule 3: Merchant contains 'amex' OR 'american express' AND Method === 'BofA'  →  transfer (BofA paying AMEX bill)
// Rule 4: Method === 'Amex'   →  AMEX expense
// Rule 5: Method === 'BofA'   →  BofA direct expense (unless rule 3)
// BofA Balance = MinBalance + Income − BofA direct expenses − paid to AMEX (transfers)

// ─── Categories & colors ─────────────────────────────────────────────────────
const CATEGORIES = [
  'Groceries','Dining','Transport','Subscriptions','Shopping',
  'Housing','Health','Utilities','Travel','Education',
  'Entertainment','Gift','Other',
];

const CAT_COLOR = {
  Groceries:     '#4CAF82',
  Dining:        '#7B6CF6',
  Transport:     '#4A9EDB',
  Subscriptions: '#E8A838',
  Shopping:      '#E87878',
  Housing:       '#5B8DEF',
  Health:        '#3DBFA0',
  Utilities:     '#8B78E8',
  Travel:        '#EF8C4A',
  Education:     '#A878E8',
  Entertainment: '#38B8C8',
  Gift:          '#E8689A',
  Other:         '#A8B8C8',
};

const RECURRING_KW = [
  'netflix','spotify','hulu','apple','google one','microsoft',
  'adobe','visible','walmart+','shortmax','netshort','amazon prime',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n ?? 0));

// Parse Supabase "YYYY-MM-DD" as LOCAL midnight — avoids UTC timezone shift bug
function toLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Parse Google Sheets gviz date value (returns local Date)
function parseGvizDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  // gviz format: Date(2026,3,17) — month is 0-indexed
  const gviz = s.match(/^Date\((\d+),(\d+),(\d+)\)$/);
  if (gviz) return new Date(+gviz[1], +gviz[2], +gviz[3]);
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const yr = +mdy[3] < 100 ? 2000 + +mdy[3] : +mdy[3];
    return new Date(yr, +mdy[1] - 1, +mdy[2]);
  }
  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
  return null;
}

// Parse the full gviz JSON response into transaction objects
function parseSheet(raw) {
  let json;
  try {
    json = JSON.parse(raw.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, ''));
  } catch { return []; }

  return (json.table?.rows || []).map((row, idx) => {
    const c = row.c || [];
    // Need at least date, merchant, amount
    if (!c[0] || !c[1] || !c[2]) return null;

    const merchant = String(c[1]?.v || '').trim();
    if (!merchant) return null;

    // Rule 1: always use absolute value — ignore sign
    const amount = Math.abs(parseFloat(c[2]?.v ?? 0));
    if (isNaN(amount) || amount === 0) return null;

    const method   = String(c[3]?.v || '').trim();
    const category = String(c[4]?.v || 'Other').trim();
    const subCat   = String(c[5]?.v || '').trim();
    const dateObj  = parseGvizDate(c[0]?.v);
    const dateStr  = dateObj
      ? dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
      : String(c[0]?.v || '');

    // Rule 2: Income
    const isIncome = method === 'Income';
    // Rule 3: Transfer (BofA paying AMEX bill)
    const isTransfer =
      method === 'BofA' &&
      (merchant.toLowerCase() === 'amex' || merchant.toLowerCase().includes('american express'));

    return { id: idx, date: dateStr, dateObj, merchant, amount, method, category, subCat, isIncome, isTransfer };
  }).filter(Boolean);
}

const isAmex     = (t) => t.method === 'Amex';
const isBofa     = (t) => t.method === 'BofA' && !t.isTransfer;
const isRecur    = (t) => RECURRING_KW.some(k => t.merchant.toLowerCase().includes(k)) || t.category === 'Subscriptions';

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:       '#F0F4F8',
  surface:  '#FFFFFF',
  border:   '#E4EAF0',
  text:     '#1A2332',
  muted:    '#6B7A8D',
  faint:    '#F7F9FC',
  green:    '#2DB87A',
  red:      '#E05252',
  amber:    '#E8A838',
  blue:     '#4A7EDB',
  purple:   '#7B6CF6',
  indigo:   '#5B6CF6',
};

const card = {
  background: T.surface,
  borderRadius: 14,
  border: `1px solid ${T.border}`,
  padding: '20px 24px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
};

const inp = {
  padding: '8px 12px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  fontSize: 13,
  color: T.text,
  background: T.surface,
  outline: 'none',
};

const btn = (v = 'primary') => ({
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  background:
    v === 'primary' ? T.indigo :
    v === 'danger'  ? T.red    :
    v === 'success' ? T.green  : T.faint,
  color: v === 'ghost' ? T.muted : '#fff',
});

const th = {
  padding: '10px 14px',
  borderBottom: `2px solid ${T.border}`,
  fontSize: 11,
  fontWeight: 700,
  color: T.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  textAlign: 'left',
  background: T.faint,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const td = {
  padding: '10px 14px',
  borderBottom: `1px solid ${T.border}`,
  fontSize: 13,
  color: T.text,
  verticalAlign: 'middle',
};

// ─── Small components ─────────────────────────────────────────────────────────
function MethodBadge({ method }) {
  const cfg = {
    Amex:   { bg: '#EEF0FF', color: '#5B6CF6' },
    BofA:   { bg: '#FFF7E6', color: '#B07D20' },
    Income: { bg: '#E8F8F0', color: '#1F8A55' },
  };
  const c = cfg[method] || { bg: T.faint, color: T.muted };
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color }}>
      {method}
    </span>
  );
}

function NoteCell({ txId, note, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(note);
  useEffect(() => setVal(note), [note]);
  if (editing) return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onSave(txId, val); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{ ...inp, fontSize: 12, padding: '3px 8px', width: 150 }}
        autoFocus
      />
      <button onClick={() => { onSave(txId, val); setEditing(false); }} style={{ ...btn(), padding: '3px 10px', fontSize: 11 }}>✓</button>
    </div>
  );
  return (
    <span
      onClick={() => setEditing(true)}
      style={{ fontSize: 12, color: note ? T.text : '#C5CDD8', cursor: 'pointer', borderBottom: `1px dashed ${T.border}` }}
    >
      {note || '+ add note'}
    </span>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]               = useState('overview');
  const [txns, setTxns]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [refreshed, setRefreshed]   = useState(null);

  // Supabase
  const [periods, setPeriods]           = useState([]);
  const [minBal, setMinBal]             = useState(0);
  const [overallBudget, setOverallBudget] = useState(null);
  const [catBudgets, setCatBudgets]     = useState([]);
  const [notes, setNotes]               = useState({});

  // Tab 2 UI
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [fCat, setFCat]             = useState('All');
  const [fMethod, setFMethod]       = useState('All');
  const [search, setSearch]         = useState('');
  const [drillCat, setDrillCat]     = useState(null);
  const [sortCol, setSortCol]       = useState('date');
  const [sortDir, setSortDir]       = useState('desc');
  const [page, setPage]             = useState(1);

  // Period modal
  const [showModal, setShowModal]   = useState(false);
  const [editPeriod, setEditPeriod] = useState(null);
  const [pForm, setPForm]           = useState({ label: '', start_date: '', end_date: '', budget_amount: '' });

  // Budget editing
  const [newBudgetCat, setNewBudgetCat] = useState('');
  const [newBudgetAmt, setNewBudgetAmt] = useState('');
  const [editOvBudget, setEditOvBudget] = useState(false);
  const [ovBudgetInput, setOvBudgetInput] = useState('');
  const [editMinBal, setEditMinBal]   = useState(false);
  const [minBalInput, setMinBalInput] = useState('');

  // ── Load ────────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(SHEET_URL);
      const text = await res.text();
      setTxns(parseSheet(text));
      setRefreshed(new Date());
    } catch {
      setError('Could not load Google Sheet. Make sure it is set to "Anyone with link can view".');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    (async () => {
      const [p, s, ob, cb, n] = await Promise.all([
        loadPayPeriods(), loadBofaSettings(), loadOverallBudget(),
        loadCategoryBudgets(), loadTransactionNotes(),
      ]);
      setPeriods(p);
      if (s?.min_balance != null) setMinBal(s.min_balance);
      setOverallBudget(ob);
      setCatBudgets(cb);
      setNotes(n);
    })();
  }, []);

  // ── Transaction groups ───────────────────────────────────────────────────────
  // Rule 2: income
  const incomes   = useMemo(() => txns.filter(t => t.isIncome), [txns]);
  // Rule 3: transfers
  const transfers = useMemo(() => txns.filter(t => t.isTransfer), [txns]);
  // Everything else = expenses
  const expenses  = useMemo(() => txns.filter(t => !t.isIncome && !t.isTransfer), [txns]);

  const amexExp = useMemo(() => expenses.filter(isAmex), [expenses]);
  const bofaExp = useMemo(() => expenses.filter(isBofa), [expenses]);

  // ── Tab 1 calculations ───────────────────────────────────────────────────────
  // BofA Balance = MinBalance + Income − BofA direct expenses − paid to AMEX
  const totalIncome     = useMemo(() => incomes.reduce((s, t) => s + t.amount, 0), [incomes]);
  const totalBofaDirect = useMemo(() => bofaExp.reduce((s, t) => s + t.amount, 0), [bofaExp]);
  const totalPaidAmex   = useMemo(() => transfers.reduce((s, t) => s + t.amount, 0), [transfers]);
  const totalAmexCharged= useMemo(() => amexExp.reduce((s, t) => s + t.amount, 0), [amexExp]);
  const outstandingAmex = useMemo(() => Math.max(0, totalAmexCharged - totalPaidAmex), [totalAmexCharged, totalPaidAmex]);
  const bofaBalance     = useMemo(() => minBal + totalIncome - totalBofaDirect - totalPaidAmex, [minBal, totalIncome, totalBofaDirect, totalPaidAmex]);

  // ── Tab 2: date-filtered expenses ────────────────────────────────────────────
  const dateFilt = useMemo(() => {
    let t = expenses;
    if (dateFrom) {
      const d = toLocalDate(dateFrom);
      if (d) t = t.filter(x => x.dateObj && x.dateObj >= d);
    }
    if (dateTo) {
      const d = toLocalDate(dateTo);
      if (d) {
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        t = t.filter(x => x.dateObj && x.dateObj <= end);
      }
    }
    return t;
  }, [expenses, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    let t = drillCat ? dateFilt.filter(x => x.category === drillCat) : dateFilt;
    if (fCat !== 'All')    t = t.filter(x => x.category === fCat);
    if (fMethod !== 'All') t = t.filter(x => x.method   === fMethod);
    if (search)            t = t.filter(x =>
      x.merchant.toLowerCase().includes(search.toLowerCase()) ||
      (notes[x.id] || '').toLowerCase().includes(search.toLowerCase())
    );
    return t;
  }, [dateFilt, drillCat, fCat, fMethod, search, notes]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sortCol === 'date') {
      const da = a.dateObj || new Date(0), db = b.dateObj || new Date(0);
      return sortDir === 'asc' ? da - db : db - da;
    }
    if (sortCol === 'amount') return sortDir === 'asc' ? a.amount - b.amount : b.amount - a.amount;
    return sortDir === 'asc'
      ? (a[sortCol] || '').localeCompare(b[sortCol] || '')
      : (b[sortCol] || '').localeCompare(a[sortCol] || '');
  }), [filtered, sortCol, sortDir]);

  const PAGE = 25;
  const paged      = useMemo(() => sorted.slice(PAGE * (page - 1), PAGE * page), [sorted, page]);
  const totalPages = Math.ceil(sorted.length / PAGE);
  const totalSpend = useMemo(() => sorted.reduce((s, t) => s + t.amount, 0), [sorted]);

  // ── Period enrichment ─────────────────────────────────────────────────────────
  // THE FIX: toLocalDate() ensures period dates match transaction dateObjs (both local midnight)
  const enriched = useMemo(() => periods.map(p => {
    const start = toLocalDate(p.start_date);
    const endRaw = toLocalDate(p.end_date);
    if (!start || !endRaw) return { ...p, bofaSpend: 0, amexSpend: 0, total: 0, saved: 0, days: 0, daysPassed: 0, isCurrent: false };
    const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate(), 23, 59, 59);

    const pTxns    = expenses.filter(t => t.dateObj && t.dateObj >= start && t.dateObj <= end);
    const bofaSpend = pTxns.filter(isBofa).reduce((s, t) => s + t.amount, 0);
    const amexSpend = pTxns.filter(isAmex).reduce((s, t) => s + t.amount, 0);
    const total     = bofaSpend + amexSpend;
    const budget    = p.budget_amount || 0;
    const saved     = budget - total;
    const days      = Math.max(1, Math.ceil((end - start) / 86400000));
    const now       = new Date();
    const daysPassed = Math.min(Math.max(0, Math.ceil((now - start) / 86400000)), days);
    const isCurrent = now >= start && now <= end;

    return { ...p, start, end, bofaSpend, amexSpend, total, budget, saved, days, daysPassed, isCurrent };
  }), [periods, expenses]);

  const currentPeriod = useMemo(() => enriched.find(p => p.isCurrent) || enriched[0] || null, [enriched]);

  // ── Chart data ────────────────────────────────────────────────────────────────
  const catChartData = useMemo(() => {
    const map = {};
    dateFilt.forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [dateFilt]);

  const totalFilt = useMemo(() => dateFilt.reduce((s, t) => s + t.amount, 0), [dateFilt]);
  const recurringTxns = useMemo(() => dateFilt.filter(isRecur), [dateFilt]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const savePeriod = async () => {
    if (!pForm.start_date || !pForm.end_date || !pForm.budget_amount) return;
    const toSave = { ...editPeriod, ...pForm, budget_amount: parseFloat(pForm.budget_amount) };
    const saved  = await savePayPeriod(toSave);
    setPeriods(prev => {
      const exists = prev.find(p => p.id === saved.id);
      return exists ? prev.map(p => p.id === saved.id ? saved : p) : [saved, ...prev];
    });
    setShowModal(false); setEditPeriod(null); setPForm({ label: '', start_date: '', end_date: '', budget_amount: '' });
  };

  const delPeriod = async (id) => { await deletePayPeriod(id); setPeriods(prev => prev.filter(p => p.id !== id)); };

  const saveMinBal = async () => {
    const v = parseFloat(minBalInput) || 0;
    setMinBal(v); await saveBofaSettings({ min_balance: v }); setEditMinBal(false);
  };

  const saveOvBudget = async () => {
    const v = parseFloat(ovBudgetInput) || null;
    setOverallBudget(v); if (v) await saveOverallBudget(v); setEditOvBudget(false);
  };

  const addCatBudget = async () => {
    if (!newBudgetCat || !newBudgetAmt) return;
    const amt = parseFloat(newBudgetAmt);
    await saveCategoryBudget(newBudgetCat, amt);
    setCatBudgets(prev => {
      const ex = prev.find(b => b.category === newBudgetCat);
      return ex ? prev.map(b => b.category === newBudgetCat ? { ...b, amount: amt } : b) : [...prev, { category: newBudgetCat, amount: amt }];
    });
    setNewBudgetCat(''); setNewBudgetAmt('');
  };

  const delCatBudget = async (cat) => { await deleteCategoryBudget(cat); setCatBudgets(prev => prev.filter(b => b.category !== cat)); };
  const saveNote     = async (id, note) => { setNotes(prev => ({ ...prev, [id]: note })); await saveTransactionNote(id, note); };
  const handleSort   = (col) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } setPage(1); };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: T.text }}>

      {/* ── Topbar ── */}
      <div style={{ background: '#1C2536', padding: '0 28px', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(0,0,0,0.18)' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', padding: '15px 0', marginRight: 16, letterSpacing: '-0.02em' }}>💰 My Finance</span>
        {[['overview', '📊 Financial Overview'], ['tracker', '📅 Pay Period Tracker']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '15px 6px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 400, color: tab === t ? '#7EB8F7' : '#8A9BB0', borderBottom: tab === t ? '2px solid #7EB8F7' : '2px solid transparent', whiteSpace: 'nowrap' }}>
            {label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {refreshed && <span style={{ fontSize: 11, color: '#5A6A7A' }}>Updated {refreshed.toLocaleTimeString()}</span>}
          <button onClick={refresh} disabled={loading} style={{ ...btn('ghost'), background: '#2A3548', color: '#8A9BB0', fontSize: 12, padding: '7px 14px' }}>
            {loading ? '⟳ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#FEF0EF', color: '#C0392B', padding: '10px 28px', fontSize: 13, borderBottom: '1px solid #FAD0CC' }}>{error}</div>}

      <div style={{ padding: '24px 28px', maxWidth: 1380, margin: '0 auto' }}>

        {/* ════════════════ TAB 1: FINANCIAL OVERVIEW ════════════════ */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

            {/* Hero cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>

              {/* BofA Card */}
              <div style={{ ...card, borderTop: '3px solid #E8A838' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#B07D20', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>🏦 Bank of America — Calculated Balance</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: bofaBalance >= 0 ? T.text : T.red, letterSpacing: '-0.03em', marginBottom: 4 }}>
                  {fmt(bofaBalance)}
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 18 }}>Min Balance + Income − BofA Spend − Paid to AMEX</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Minimum Balance Reserve', value: minBal,         color: T.indigo, sign: '+' },
                    { label: 'Total Income Received',   value: totalIncome,    color: T.green,  sign: '+' },
                    { label: 'Direct BofA Expenses',    value: totalBofaDirect,color: T.red,    sign: '−' },
                    { label: 'Paid to AMEX (transfers)',value: totalPaidAmex,  color: T.amber,  sign: '−' },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: T.faint, borderRadius: 8 }}>
                      <span style={{ fontSize: 13, color: T.muted }}><span style={{ fontWeight: 700, marginRight: 6, color: r.color }}>{r.sign}</span>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: r.color }}>{fmt(r.value)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
                  {editMinBal ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: T.muted }}>Min balance reserve:</span>
                      <input value={minBalInput} onChange={e => setMinBalInput(e.target.value)} style={{ ...inp, width: 110 }} type="number" />
                      <button onClick={saveMinBal} style={{ ...btn(), padding: '6px 14px' }}>Save</button>
                      <button onClick={() => setEditMinBal(false)} style={{ ...btn('ghost'), padding: '6px 10px' }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: T.muted }}>Min reserve: <strong style={{ color: T.indigo }}>{fmt(minBal)}</strong></span>
                      <button onClick={() => { setMinBalInput(String(minBal)); setEditMinBal(true); }} style={{ ...btn('ghost'), padding: '5px 12px', fontSize: 12 }}>Edit</button>
                    </div>
                  )}
                </div>
              </div>

              {/* AMEX Card */}
              <div style={{ ...card, borderTop: '3px solid #7B6CF6' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5B4CC6', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>💳 American Express — Outstanding Balance</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: outstandingAmex > 0 ? T.red : T.green, letterSpacing: '-0.03em', marginBottom: 4 }}>
                  {fmt(outstandingAmex)}
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 18 }}>Total AMEX charged minus payments made from BofA</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Total Charged on AMEX', value: totalAmexCharged, color: T.red,   sign: '−' },
                    { label: 'Paid from BofA',         value: totalPaidAmex,   color: T.green, sign: '+' },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: T.faint, borderRadius: 8 }}>
                      <span style={{ fontSize: 13, color: T.muted }}><span style={{ fontWeight: 700, marginRight: 6, color: r.color }}>{r.sign}</span>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: r.color }}>{fmt(r.value)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
                  <div style={{ padding: '10px 14px', borderRadius: 10, background: outstandingAmex > 0 ? '#FFF0F0' : '#EDFAF4', fontSize: 13, fontWeight: 600, color: outstandingAmex > 0 ? T.red : T.green }}>
                    {outstandingAmex > 0 ? `⚠️  ${fmt(outstandingAmex)} still owed on AMEX` : '✅  AMEX fully paid off'}
                  </div>
                </div>
              </div>
            </div>

            {/* Income table */}
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 14 }}>
                💰 Income Sources <span style={{ fontWeight: 400, fontSize: 13, color: T.muted }}>({incomes.length} transactions · {fmt(totalIncome)} total)</span>
              </div>
              {incomes.length === 0 ? (
                <div style={{ color: T.muted, fontSize: 13 }}>No income found. Add a row with Method = "Income" in your sheet.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Date</th><th style={th}>Source</th><th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  </tr></thead>
                  <tbody>
                    {incomes.map(t => (
                      <tr key={t.id}>
                        <td style={{ ...td, color: T.muted, fontSize: 12 }}>{t.date}</td>
                        <td style={{ ...td, fontWeight: 500 }}>{t.merchant}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: T.green }}>{fmt(t.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#EDFAF4' }}>
                      <td colSpan={2} style={{ ...td, fontWeight: 700 }}>Total Income</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: T.green, fontSize: 15 }}>{fmt(totalIncome)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ════════════════ TAB 2: PAY PERIOD TRACKER ════════════════ */}
        {tab === 'tracker' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Sticky date filter bar */}
            <div style={{ ...card, position: 'sticky', top: 53, zIndex: 90, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: '0.05em' }}>DATE RANGE</span>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={inp} />
              <span style={{ color: T.muted }}>→</span>
              <input type="date" value={dateTo}   onChange={e => { setDateTo(e.target.value);   setPage(1); }} style={inp} />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }} style={{ ...btn('ghost'), padding: '6px 12px', fontSize: 12 }}>✕ Clear</button>
              )}
              {(dateFrom || dateTo) && (
                <span style={{ fontSize: 12, color: T.indigo, fontWeight: 600 }}>
                  {sorted.length} txns · {fmt(totalSpend)}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {overallBudget ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: T.muted }}>Budget: <strong>{fmt(overallBudget)}</strong></span>
                    <div style={{ width: 100, height: 7, background: T.border, borderRadius: 99 }}>
                      <div style={{ width: `${Math.min(100, totalFilt / overallBudget * 100)}%`, height: '100%', borderRadius: 99, background: totalFilt > overallBudget ? T.red : totalFilt / overallBudget > 0.8 ? T.amber : T.green }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: totalFilt > overallBudget ? T.red : T.green }}>
                      {fmt(Math.abs(overallBudget - totalFilt))} {totalFilt > overallBudget ? 'over' : 'left'}
                    </span>
                    <button onClick={() => { setOvBudgetInput(String(overallBudget)); setEditOvBudget(true); }} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 12 }}>Edit</button>
                  </div>
                ) : editOvBudget ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={ovBudgetInput} onChange={e => setOvBudgetInput(e.target.value)} style={{ ...inp, width: 110 }} type="number" placeholder="$ overall budget" />
                    <button onClick={saveOvBudget} style={{ ...btn(), padding: '6px 14px' }}>Save</button>
                    <button onClick={() => setEditOvBudget(false)} style={{ ...btn('ghost'), padding: '6px 10px' }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditOvBudget(true)} style={{ ...btn('ghost'), fontSize: 12 }}>+ Set Overall Budget</button>
                )}
              </div>
            </div>

            {/* Current Period hero */}
            <div style={{ background: 'linear-gradient(135deg, #1C3358 0%, #2A5298 100%)', borderRadius: 16, padding: '26px 30px', color: '#fff', boxShadow: '0 6px 24px rgba(42,82,152,0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: currentPeriod ? 24 : 0 }}>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Current Pay Period</div>
                  <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>
                    {currentPeriod ? (currentPeriod.label || `${currentPeriod.start_date} → ${currentPeriod.end_date}`) : 'No active period set'}
                  </div>
                  {currentPeriod && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>Day {currentPeriod.daysPassed} of {currentPeriod.days}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {currentPeriod && (
                    <button onClick={() => { setEditPeriod(currentPeriod); setPForm({ label: currentPeriod.label || '', start_date: currentPeriod.start_date, end_date: currentPeriod.end_date, budget_amount: String(currentPeriod.budget_amount) }); setShowModal(true); }}
                      style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, color: '#fff', padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
                      Edit
                    </button>
                  )}
                  <button onClick={() => { setEditPeriod(null); setPForm({ label: '', start_date: '', end_date: '', budget_amount: '' }); setShowModal(true); }}
                    style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, color: '#fff', padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    + New Period
                  </button>
                </div>
              </div>

              {currentPeriod && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20 }}>
                    {[
                      ['Budget',                    fmt(currentPeriod.budget)],
                      ['BofA Spend',                fmt(currentPeriod.bofaSpend)],
                      ['AMEX Spend',                fmt(currentPeriod.amexSpend)],
                      ['Total Spent',               fmt(currentPeriod.total)],
                      [currentPeriod.saved >= 0 ? '✅ Remaining' : '❌ Over by', fmt(Math.abs(currentPeriod.saved))],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 5 }}>{l}</div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 22 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.65, marginBottom: 6 }}>
                      <span>{currentPeriod.budget > 0 ? Math.round(currentPeriod.total / currentPeriod.budget * 100) : 0}% of budget used</span>
                      <span>{currentPeriod.days - currentPeriod.daysPassed} days remaining</span>
                    </div>
                    <div style={{ height: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 99 }}>
                      <div style={{ height: '100%', borderRadius: 99, transition: 'width 0.5s', background: currentPeriod.total > currentPeriod.budget ? '#FF8080' : 'rgba(255,255,255,0.9)', width: `${Math.min(100, currentPeriod.budget > 0 ? currentPeriod.total / currentPeriod.budget * 100 : 0)}%` }} />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Charts row: category donut + recurring */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>

              {/* Category donut */}
              <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 12 }}>Spend by Category</div>
                {catChartData.length > 0 ? (
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0 }}>
                      <ResponsiveContainer width={180} height={180}>
                        <PieChart>
                          <Pie data={catChartData} cx="50%" cy="50%" outerRadius={82} innerRadius={46} dataKey="value"
                            onClick={d => setDrillCat(prev => prev === d.name ? null : d.name)} strokeWidth={0}>
                            {catChartData.map(d => (
                              <Cell key={d.name} fill={CAT_COLOR[d.name] || T.muted} opacity={drillCat && drillCat !== d.name ? 0.25 : 1} />
                            ))}
                          </Pie>
                          <Tooltip formatter={v => [fmt(v), 'Spend']} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                      {catChartData.map(d => (
                        <div key={d.name} onClick={() => setDrillCat(prev => prev === d.name ? null : d.name)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: 8, cursor: 'pointer', background: drillCat === d.name ? '#EEF2FF' : 'transparent', opacity: drillCat && drillCat !== d.name ? 0.35 : 1, transition: 'all 0.15s' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: CAT_COLOR[d.name] || T.muted, flexShrink: 0 }} />
                            {d.name}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>
                            {fmt(d.value)} <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>({totalFilt > 0 ? Math.round(d.value / totalFilt * 100) : 0}%)</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <div style={{ color: T.muted, fontSize: 13 }}>No data for selected range</div>}
                {drillCat && (
                  <button onClick={() => setDrillCat(null)} style={{ ...btn('ghost'), width: '100%', marginTop: 10, fontSize: 12 }}>✕ Clear filter: {drillCat}</button>
                )}
              </div>

              {/* Recurring */}
              <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 4 }}>🔄 Recurring Charges</div>
                <div style={{ fontSize: 12, color: T.purple, marginBottom: 12, fontWeight: 600 }}>
                  {recurringTxns.length} charges · {fmt(recurringTxns.reduce((s, t) => s + t.amount, 0))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
                  {recurringTxns.length === 0
                    ? <div style={{ color: T.muted, fontSize: 13 }}>None detected in this range</div>
                    : recurringTxns.map(t => (
                      <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', background: '#F3F0FF', borderRadius: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#4C3AA8' }}>{t.merchant}</div>
                          <div style={{ fontSize: 11, color: '#8B7EC8' }}>{t.date}</div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#4C3AA8' }}>{fmt(t.amount)}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* Period history */}
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Period History</div>
                <button onClick={() => { setEditPeriod(null); setPForm({ label: '', start_date: '', end_date: '', budget_amount: '' }); setShowModal(true); }} style={btn()}>+ New Period</button>
              </div>
              {enriched.length === 0 ? (
                <div style={{ color: T.muted, fontSize: 13 }}>No periods yet. Click "+ New Period" to get started.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      {['Period', 'Budget', 'BofA Spend', 'AMEX Spend', 'Total Spent', 'Saved / Over', 'Rate', ''].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {enriched.map(p => (
                        <tr key={p.id} style={{ background: p.isCurrent ? '#F0F6FF' : 'transparent' }}>
                          <td style={td}>
                            <div style={{ fontWeight: p.isCurrent ? 700 : 500 }}>{p.label || `${p.start_date} → ${p.end_date}`}</div>
                            {p.isCurrent && <span style={{ fontSize: 10, background: '#DBEAFE', color: '#1D4ED8', padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>CURRENT</span>}
                          </td>
                          <td style={td}>{fmt(p.budget)}</td>
                          <td style={{ ...td, color: '#B07D20', fontWeight: 600 }}>{fmt(p.bofaSpend)}</td>
                          <td style={{ ...td, color: '#5B4CC6', fontWeight: 600 }}>{fmt(p.amexSpend)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{fmt(p.total)}</td>
                          <td style={{ ...td, fontWeight: 700, color: p.saved >= 0 ? T.green : T.red }}>{p.saved >= 0 ? '+' : ''}{fmt(p.saved)}</td>
                          <td style={td}>
                            <span style={{ fontWeight: 600, color: p.saved >= 0 ? T.green : T.red }}>
                              {p.budget > 0 ? `${Math.abs(Math.round((1 - p.total / p.budget) * 100))}%` : '—'} {p.saved >= 0 ? '✅' : '❌'}
                            </span>
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => { setEditPeriod(p); setPForm({ label: p.label || '', start_date: p.start_date, end_date: p.end_date, budget_amount: String(p.budget_amount) }); setShowModal(true); }}
                                style={{ ...btn('ghost'), padding: '4px 12px', fontSize: 12 }}>Edit</button>
                              <button onClick={() => delPeriod(p.id)} style={{ ...btn('danger'), padding: '4px 12px', fontSize: 12 }}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Savings trend */}
            {enriched.length > 0 && (
              <div style={card}>
                <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 16 }}>Savings Trend</div>
                {enriched.map(p => {
                  const pct = p.budget > 0 ? Math.min(100, p.total / p.budget * 100) : 0;
                  return (
                    <div key={p.id} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                        <span style={{ fontWeight: 500 }}>{p.label || `${p.start_date} → ${p.end_date}`}</span>
                        <span style={{ fontWeight: 700, color: p.saved >= 0 ? T.green : T.red }}>{p.saved >= 0 ? 'Saved' : 'Over'} {fmt(Math.abs(p.saved))}</span>
                      </div>
                      <div style={{ height: 8, background: T.border, borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: p.saved >= 0 ? T.green : T.red, borderRadius: 99, transition: 'width 0.6s' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Category budgets */}
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 14 }}>Category Budgets</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <select value={newBudgetCat} onChange={e => setNewBudgetCat(e.target.value)} style={inp}>
                  <option value="">Select category…</option>
                  {CATEGORIES.filter(c => !catBudgets.find(b => b.category === c)).map(c => <option key={c}>{c}</option>)}
                </select>
                <input type="number" placeholder="$ amount" value={newBudgetAmt} onChange={e => setNewBudgetAmt(e.target.value)} style={{ ...inp, width: 120 }} />
                <button onClick={addCatBudget} style={btn()}>+ Add Budget</button>
              </div>
              {catBudgets.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {catBudgets.map(b => {
                    const spent = dateFilt.filter(t => t.category === b.category).reduce((s, t) => s + t.amount, 0);
                    const pct   = b.amount > 0 ? Math.min(100, spent / b.amount * 100) : 0;
                    const col   = pct >= 100 ? T.red : pct >= 80 ? T.amber : T.blue;
                    return (
                      <div key={b.category}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                          <span style={{ fontWeight: 600 }}>{b.category}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ color: col, fontWeight: 600 }}>{fmt(spent)}</span>
                            <span style={{ color: T.muted }}>/ {fmt(b.amount)}</span>
                            <button onClick={() => delCatBudget(b.category)} style={{ ...btn('ghost'), padding: '2px 8px', fontSize: 12 }}>✕</button>
                          </div>
                        </div>
                        <div style={{ height: 7, background: T.border, borderRadius: 99 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 99, transition: 'width 0.5s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Transaction filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input placeholder="🔍 Search merchant or note…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ ...inp, flex: 1, minWidth: 220 }} />
              <select value={fCat}    onChange={e => { setFCat(e.target.value);    setPage(1); }} style={inp}>
                <option value="All">All Categories</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={fMethod} onChange={e => { setFMethod(e.target.value); setPage(1); }} style={inp}>
                <option value="All">All Methods</option>
                <option>Amex</option>
                <option>BofA</option>
              </select>
              {(search || fCat !== 'All' || fMethod !== 'All' || drillCat) && (
                <button onClick={() => { setSearch(''); setFCat('All'); setFMethod('All'); setDrillCat(null); setPage(1); }} style={{ ...btn('ghost') }}>✕ Clear all</button>
              )}
              <span style={{ fontSize: 12, color: T.muted, marginLeft: 'auto' }}>{sorted.length} transactions · {fmt(totalSpend)}</span>
            </div>

            {drillCat && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#EEF2FF', borderRadius: 10, border: '1px solid #C7D2FE' }}>
                <span style={{ fontSize: 13, color: T.indigo, fontWeight: 600 }}>Filtered by category: <strong>{drillCat}</strong></span>
                <button onClick={() => setDrillCat(null)} style={{ ...btn('ghost'), padding: '3px 10px', fontSize: 12 }}>✕ Clear</button>
              </div>
            )}

            {/* Transactions table */}
            <div style={card}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCat','Sub Category'],['note','Note']].map(([col, label]) => (
                      <th key={col} style={th} onClick={() => col !== 'note' && handleSort(col)}>
                        {label}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {paged.length === 0
                      ? <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: T.muted, padding: 40 }}>No transactions match your filters</td></tr>
                      : paged.map(t => {
                        const amt    = t.amount;
                        const rowBg  = isRecur(t) ? '#FAF7FF' : amt >= 80 ? '#FFF5F5' : amt >= 40 ? '#FFFBF0' : T.surface;
                        const amtCol = amt >= 80 ? T.red : amt >= 40 ? T.amber : T.text;
                        return (
                          <tr key={t.id} style={{ background: rowBg }}>
                            <td style={{ ...td, color: T.muted, fontSize: 12, whiteSpace: 'nowrap' }}>{t.date}</td>
                            <td style={{ ...td, fontWeight: 500 }}>
                              {t.merchant}
                              {isRecur(t) && <span style={{ marginLeft: 6, fontSize: 11, color: T.purple, fontWeight: 700 }}>↻</span>}
                            </td>
                            <td style={{ ...td, fontWeight: 700, color: amtCol, whiteSpace: 'nowrap' }}>{fmt(amt)}</td>
                            <td style={td}><MethodBadge method={t.method} /></td>
                            <td style={td}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: (CAT_COLOR[t.category] || T.muted) + '22', color: CAT_COLOR[t.category] || T.muted }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: CAT_COLOR[t.category] || T.muted }} />
                                {t.category}
                              </span>
                            </td>
                            <td style={{ ...td, fontSize: 12, color: T.muted }}>{t.subCat}</td>
                            <td style={td}><NoteCell txId={t.id} note={notes[t.id] || ''} onSave={saveNote} /></td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...btn('ghost'), padding: '6px 14px' }}>← Prev</button>
                  <span style={{ fontSize: 13, color: T.muted }}>Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...btn('ghost'), padding: '6px 14px' }}>Next →</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Period Modal ── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div style={{ ...card, width: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: T.text, marginBottom: 20 }}>
              {editPeriod ? 'Edit Pay Period' : 'New Pay Period'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: T.muted, display: 'block', marginBottom: 5, fontWeight: 600 }}>Label (optional)</label>
                <input value={pForm.label} onChange={e => setPForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Apr 15 – Apr 30" style={{ ...inp, width: '100%' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: T.muted, display: 'block', marginBottom: 5, fontWeight: 600 }}>Start Date</label>
                  <input type="date" value={pForm.start_date} onChange={e => setPForm(f => ({ ...f, start_date: e.target.value }))} style={{ ...inp, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: T.muted, display: 'block', marginBottom: 5, fontWeight: 600 }}>End Date</label>
                  <input type="date" value={pForm.end_date} onChange={e => setPForm(f => ({ ...f, end_date: e.target.value }))} style={{ ...inp, width: '100%' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: T.muted, display: 'block', marginBottom: 5, fontWeight: 600 }}>Budget Amount ($)</label>
                <input type="number" value={pForm.budget_amount} onChange={e => setPForm(f => ({ ...f, budget_amount: e.target.value }))} placeholder="e.g. 3200" style={{ ...inp, width: '100%' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button onClick={() => { setShowModal(false); setEditPeriod(null); }} style={{ ...btn('ghost'), padding: '8px 18px' }}>Cancel</button>
              <button onClick={savePeriod} style={{ ...btn(), padding: '8px 22px' }}>Save Period</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
