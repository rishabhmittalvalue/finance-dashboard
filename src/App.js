import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  loadPayPeriods, savePayPeriod, deletePayPeriod,
  loadBofaSettings, saveBofaSettings,
  loadOverallBudget, saveOverallBudget,
  loadCategoryBudgets, saveCategoryBudget, deleteCategoryBudget,
  loadTransactionNotes, saveTransactionNote,
  loadOverviewNote, saveOverviewNote,
} from './supabase';

// ─── Sheet ────────────────────────────────────────────────────────────────────
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ/gviz/tq?tqx=out:json&sheet=Sheet1';

// ─── Rules ────────────────────────────────────────────────────────────────────
// 1. ALL amounts = Math.abs() — ignore sign completely
// 2. method === 'Income' → income
// 3. merchant contains 'amex'/'american express' + method === 'BofA' → transfer
// 4. method === 'Amex' → AMEX expense
// 5. method === 'BofA' (not transfer) → BofA expense
// BofA Balance = MinBalance + Income − BofA direct − paid to AMEX

// ─── Data ─────────────────────────────────────────────────────────────────────
const CATS = ['Groceries','Dining','Transport','Subscriptions','Shopping','Housing','Health','Utilities','Travel','Education','Entertainment','Gift','Other'];
const CAT_COLOR = { Groceries:'#10B981',Dining:'#8B5CF6',Transport:'#3B82F6',Subscriptions:'#F59E0B',Shopping:'#EC4899',Housing:'#06B6D4',Health:'#14B8A6',Utilities:'#6366F1',Travel:'#F97316',Education:'#A855F7',Entertainment:'#0EA5E9',Gift:'#F43F5E',Other:'#94A3B8' };
const RECUR_KW = ['netflix','spotify','hulu','apple','google one','microsoft','adobe','visible','walmart+','shortmax','netshort','amazon prime'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const currency = n => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2 }).format(Math.abs(n ?? 0));

function toLocalDate(s) {
  if (!s) return null;
  const [y,m,d] = String(s).split('-').map(Number);
  return (y && m && d) ? new Date(y, m-1, d) : null;
}

function parseGvizDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const g = s.match(/^Date\((\d+),(\d+),(\d+)\)$/);
  if (g) return new Date(+g[1], +g[2], +g[3]);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) { const y = +mdy[3] < 100 ? 2000 + +mdy[3] : +mdy[3]; return new Date(y, +mdy[1]-1, +mdy[2]); }
  return null;
}

function parseSheet(raw) {
  let json;
  try { json = JSON.parse(raw.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '')); } catch { return []; }
  return (json.table?.rows || []).map((row, i) => {
    const c = row.c || [];
    if (!c[0] || !c[1] || !c[2]) return null;
    const merchant = String(c[1]?.v || '').trim();
    if (!merchant) return null;
    const amount = Math.abs(parseFloat(c[2]?.v ?? 0));
    if (isNaN(amount) || amount === 0) return null;
    const method   = String(c[3]?.v || '').trim();
    const category = String(c[4]?.v || 'Other').trim();
    const subCat   = String(c[5]?.v || '').trim();
    const dateObj  = parseGvizDate(c[0]?.v);
    const date     = dateObj ? dateObj.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' }) : String(c[0]?.v || '');
    const isIncome   = method === 'Income';
    const isTransfer = method === 'BofA' && (merchant.toLowerCase() === 'amex' || merchant.toLowerCase().includes('american express'));
    return { id:i, date, dateObj, merchant, amount, method, category, subCat, isIncome, isTransfer };
  }).filter(Boolean);
}

const isAmex  = t => t.method === 'Amex';
const isBofa  = t => t.method === 'BofA' && !t.isTransfer;
const isRecur = t => RECUR_KW.some(k => t.merchant.toLowerCase().includes(k)) || t.category === 'Subscriptions';

// ─── localStorage helpers ─────────────────────────────────────────────────────
const ls = { get: (k, fb) => { try { const v = localStorage.getItem(k); return v !== null ? v : fb; } catch { return fb; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg: #F6F8FA;
  --surface: #FFFFFF;
  --border: #E2E8F0;
  --border-hover: #CBD5E1;
  --text-primary: #0F172A;
  --text-secondary: #475569;
  --text-muted: #94A3B8;
  --blue: #2563EB;
  --blue-light: #EFF6FF;
  --blue-mid: #BFDBFE;
  --green: #059669;
  --green-light: #ECFDF5;
  --red: #DC2626;
  --red-light: #FEF2F2;
  --amber: #D97706;
  --amber-light: #FFFBEB;
  --purple: #7C3AED;
  --purple-light: #F5F3FF;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 20px 40px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.06);
  --radius: 12px;
  --radius-lg: 16px;
  --font: 'Plus Jakarta Sans', sans-serif;
  --mono: 'JetBrains Mono', monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body { background: var(--bg); font-family: var(--font); color: var(--text-primary); -webkit-font-smoothing: antialiased; }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

/* ── Layout ── */
.nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  display: flex; align-items: center; gap: 0; height: 56px;
}
.nav-brand { display: flex; align-items: center; gap: 8px; margin-right: 24px; text-decoration: none; flex-shrink: 0; }
.nav-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #2563EB, #7C3AED); display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.nav-title { font-size: 15px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; }
.nav-tabs { display: flex; gap: 0; height: 100%; }
.nav-tab { height: 100%; padding: 0 14px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: var(--font); font-size: 13px; font-weight: 500; color: var(--text-muted); transition: all 0.15s; white-space: nowrap; display: flex; align-items: center; }
.nav-tab:hover { color: var(--text-secondary); }
.nav-tab.active { color: var(--blue); border-bottom-color: var(--blue); font-weight: 600; }
.nav-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.page { padding: 20px 16px; max-width: 1280px; margin: 0 auto; }
@media (min-width: 640px) { .nav { padding: 0 32px; } .page { padding: 24px 24px; } }
@media (min-width: 1024px) { .page { padding: 32px 32px; } }

.stack { display: flex; flex-direction: column; gap: 16px; }
@media (min-width: 640px) { .stack { gap: 20px; } }

/* ── Cards ── */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.card-pad { padding: 20px; }
@media (min-width: 640px) { .card-pad { padding: 24px; } }
.card-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px; }

/* ── Grids ── */
.grid-2 { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 640px) { .grid-2 { grid-template-columns: 1fr 1fr; gap: 20px; } }

.grid-3 { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 640px) { .grid-3 { grid-template-columns: 1fr 1fr; gap: 16px; } }
@media (min-width: 900px) { .grid-3 { grid-template-columns: 1fr 1fr 1fr; } }

.grid-chart { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 900px) { .grid-chart { grid-template-columns: 3fr 2fr; gap: 20px; } }

/* ── Hero number ── */
.hero-amount { font-family: var(--mono); font-size: clamp(28px, 5vw, 40px); font-weight: 500; letter-spacing: -0.03em; line-height: 1; }

/* ── Stat row ── */
.stat-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; border-radius: 8px; background: var(--bg); margin-bottom: 6px; }
.stat-label { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
.stat-sign { font-size: 13px; font-weight: 700; width: 14px; }
.stat-val { font-family: var(--mono); font-size: 13px; font-weight: 500; }

/* ── Buttons ── */
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: none; cursor: pointer; font-family: var(--font); font-size: 13px; font-weight: 600; transition: all 0.15s; white-space: nowrap; }
.btn-primary { background: var(--blue); color: #fff; box-shadow: 0 1px 3px rgba(37,99,235,0.3); }
.btn-primary:hover { background: #1D4ED8; box-shadow: 0 4px 12px rgba(37,99,235,0.35); }
.btn-secondary { background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border); }
.btn-secondary:hover { border-color: var(--border-hover); color: var(--text-primary); background: var(--bg); }
.btn-ghost { background: transparent; color: var(--text-muted); border: none; padding: 6px 10px; font-weight: 500; }
.btn-ghost:hover { color: var(--text-secondary); background: var(--bg); }
.btn-danger { background: var(--red-light); color: var(--red); border: none; padding: 6px 10px; }
.btn-danger:hover { background: #FEE2E2; }
.btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 7px; }

/* ── Inputs ── */
.input { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); font-family: var(--font); font-size: 13px; color: var(--text-primary); outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
.input:focus { border-color: #93C5FD; box-shadow: 0 0 0 3px rgba(37,99,235,0.08); }
.input::placeholder { color: var(--text-muted); }
.input option { background: var(--surface); }
.input-full { width: 100%; }

/* ── Badges ── */
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

/* ── Progress ── */
.pbar-track { height: 5px; border-radius: 99px; background: var(--bg); overflow: hidden; }
.pbar-fill { height: 100%; border-radius: 99px; transition: width 0.5s cubic-bezier(.4,0,.2,1); }

/* ── Period hero card ── */
.period-hero { background: linear-gradient(135deg, #EFF6FF 0%, #F0F7FF 100%); border: 1px solid #BFDBFE; border-radius: var(--radius-lg); padding: 24px 20px; }
@media (min-width: 640px) { .period-hero { padding: 28px 28px; } }
.period-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 20px; }
@media (min-width: 500px) { .period-stats { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 760px) { .period-stats { grid-template-columns: repeat(5, 1fr); } }
.period-stat-label { font-size: 11px; color: #6B93C9; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.period-stat-val { font-family: var(--mono); font-size: 20px; font-weight: 500; }
@media (min-width: 640px) { .period-stat-val { font-size: 22px; } }

/* ── Filter bar ── */
.filter-bar { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px; position: sticky; top: 56px; z-index: 90; box-shadow: var(--shadow-sm); }
.filter-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.filter-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap; }

/* ── Table ── */
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
.table { width: 100%; min-width: 700px; border-collapse: collapse; }
.table th { padding: 10px 14px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; text-align: left; background: var(--bg); cursor: pointer; white-space: nowrap; border-bottom: 1px solid var(--border); }
.table th:hover { color: var(--text-secondary); }
.table td { padding: 11px 14px; font-size: 13px; border-bottom: 1px solid #F8FAFC; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table tbody tr:hover { background: #F8FAFC; }
.table-amount { font-family: var(--mono); font-weight: 600; white-space: nowrap; }

/* ── Row highlight ── */
.row-red { background: #FFF8F8 !important; }
.row-amber { background: #FFFDF0 !important; }
.row-purple { background: #FDFAFF !important; }

/* ── Period history ── */
.period-table { width: 100%; min-width: 740px; border-collapse: collapse; }
.period-table th { padding: 9px 14px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; text-align: left; background: var(--bg); border-bottom: 1px solid var(--border); }
.period-table td { padding: 12px 14px; font-size: 13px; border-bottom: 1px solid #F8FAFC; vertical-align: middle; }
.period-table tr:last-child td { border-bottom: none; }
.period-table tbody tr:hover { background: #F8FAFC; }
.period-table .current-row { background: var(--blue-light) !important; }

/* ── Donut legend ── */
.legend-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 7px; cursor: pointer; transition: background 0.1s; }
.legend-row:hover { background: var(--bg); }
.legend-row.dimmed { opacity: 0.25; }
.legend-row.active { background: var(--blue-light); }

/* ── Recurring ── */
.recur-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--purple-light); border: 1px solid #DDD6FE; border-radius: 8px; margin-bottom: 6px; }

/* ── Budget bar ── */
.budget-item { margin-bottom: 14px; }
.budget-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }

/* ── Modal ── */
.modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.35); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: flex-end; justify-content: center; z-index: 200; }
.modal-box { background: var(--surface); border-radius: 20px 20px 0 0; padding: 24px 20px; width: 100%; max-width: 480px; box-shadow: var(--shadow-lg); border: 1px solid var(--border); border-bottom: none; }
@media (min-width: 600px) { .modal-overlay { align-items: center; } .modal-box { border-radius: 16px; padding: 28px; border-bottom: 1px solid var(--border); max-height: 90vh; overflow-y: auto; } }
.modal-title { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 20px; letter-spacing: -0.01em; }
.form-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; display: block; margin-bottom: 6px; }
.form-group { margin-bottom: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* ── Info row ── */
.income-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; border: 1px solid #F1F5F9; border-radius: 8px; margin-bottom: 5px; background: var(--surface); }

/* ── Notes textarea ── */
.notes-area { width: 100%; min-height: 110px; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: var(--font); font-size: 13px; color: var(--text-primary); background: var(--bg); resize: vertical; outline: none; line-height: 1.6; transition: border-color 0.15s, box-shadow 0.15s; }
.notes-area:focus { border-color: #93C5FD; box-shadow: 0 0 0 3px rgba(37,99,235,0.08); background: var(--surface); }
.notes-area::placeholder { color: var(--text-muted); }

/* ── Pill tag ── */
.tag { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }

/* ── Drill-down banner ── */
.drill-banner { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: var(--blue-light); border: 1px solid var(--blue-mid); border-radius: 8px; }

/* ── Animate in ── */
@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.fade-up { animation: fadeUp 0.25s ease forwards; }

/* ── Error bar ── */
.error-bar { background: #FEF2F2; border-bottom: 1px solid #FECACA; color: var(--red); padding: 10px 24px; font-size: 13px; }

/* ── Empty state ── */
.empty { text-align: center; padding: 32px 20px; color: var(--text-muted); font-size: 13px; }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────
function MethodBadge({ method }) {
  const m = {
    Amex:   { bg:'#EEF2FF', color:'#4F46E5', border:'#C7D2FE' },
    BofA:   { bg:'#FFFBEB', color:'#B45309', border:'#FDE68A' },
    Income: { bg:'#ECFDF5', color:'#065F46', border:'#A7F3D0' },
  }[method] || { bg:'#F1F5F9', color:'#64748B', border:'#E2E8F0' };
  return (
    <span className="badge" style={{ background:m.bg, color:m.color, border:`1px solid ${m.border}` }}>
      {method}
    </span>
  );
}

function CatBadge({ cat }) {
  const c = CAT_COLOR[cat] || '#94A3B8';
  return (
    <span className="badge" style={{ background:c+'15', color:c, border:`1px solid ${c}28` }}>
      <span className="dot" style={{ background:c }} />
      {cat}
    </span>
  );
}

function PBar({ value, max, color = '#2563EB' }) {
  const pct = max > 0 ? Math.min(100, value / max * 100) : 0;
  const bg = pct >= 100 ? '#DC2626' : pct >= 80 ? '#D97706' : color;
  return (
    <div className="pbar-track">
      <div className="pbar-fill" style={{ width:`${pct}%`, background:bg }} />
    </div>
  );
}

function NoteCell({ txId, note, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(note);
  useEffect(() => setVal(note), [note]);
  if (editing) return (
    <div style={{ display:'flex', gap:5 }}>
      <input className="input" value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key==='Enter') { onSave(txId,val); setEditing(false); } if (e.key==='Escape') setEditing(false); }}
        style={{ fontSize:12, padding:'4px 8px', width:150 }} autoFocus />
      <button onClick={() => { onSave(txId,val); setEditing(false); }}
        style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:6, color:'#2563EB', padding:'3px 8px', cursor:'pointer', fontSize:11, fontWeight:600 }}>✓</button>
    </div>
  );
  return (
    <span onClick={() => setEditing(true)}
      style={{ fontSize:12, color:note?'#64748B':'#CBD5E1', cursor:'pointer', borderBottom:'1px dashed #E2E8F0', paddingBottom:1 }}>
      {note || '+ note'}
    </span>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // inject CSS once
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  // ── data state ──────────────────────────────────────────────────────────────
  const [tab, setTab]           = useState(() => ls.get('f_tab','overview'));
  const [txns, setTxns]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [refreshed, setRefreshed] = useState(null);
  const [periods, setPeriods]   = useState([]);
  const [minBal, setMinBal]     = useState(0);
  const [ovBudget, setOvBudget] = useState(null);
  const [catBudgets, setCatBudgets] = useState([]);
  const [notes, setNotes]       = useState({});
  const [ovNote, setOvNote]     = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // ── filter state (all persisted) ────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState(() => ls.get('f_from',''));
  const [dateTo, setDateTo]     = useState(() => ls.get('f_to',''));
  const [fCat, setFCat]         = useState(() => ls.get('f_cat','All'));
  const [fMethod, setFMethod]   = useState(() => ls.get('f_method','All'));
  const [search, setSearch]     = useState(() => ls.get('f_search',''));
  const [drillCat, setDrillCat] = useState(() => ls.get('f_drill','') || null);
  const [sortCol, setSortCol]   = useState(() => ls.get('f_scol','date'));
  const [sortDir, setSortDir]   = useState(() => ls.get('f_sdir','desc'));
  const [page, setPage]         = useState(1);

  // ── modal state ──────────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editPeriod, setEditPeriod] = useState(null);
  const [pForm, setPForm] = useState({ label:'', start_date:'', end_date:'', budget_amount:'' });
  const [newBCat, setNewBCat] = useState('');
  const [newBAmt, setNewBAmt] = useState('');
  const [editOvB, setEditOvB] = useState(false);
  const [ovBInput, setOvBInput] = useState('');
  const [editMinB, setEditMinB] = useState(false);
  const [minBInput, setMinBInput] = useState('');

  // ── persist filters ──────────────────────────────────────────────────────────
  useEffect(() => { ls.set('f_tab', tab); }, [tab]);
  useEffect(() => { ls.set('f_from', dateFrom); }, [dateFrom]);
  useEffect(() => { ls.set('f_to', dateTo); }, [dateTo]);
  useEffect(() => { ls.set('f_cat', fCat); }, [fCat]);
  useEffect(() => { ls.set('f_method', fMethod); }, [fMethod]);
  useEffect(() => { ls.set('f_search', search); }, [search]);
  useEffect(() => { ls.set('f_drill', drillCat || ''); }, [drillCat]);
  useEffect(() => { ls.set('f_scol', sortCol); }, [sortCol]);
  useEffect(() => { ls.set('f_sdir', sortDir); }, [sortDir]);

  // ── load data ────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(SHEET_URL);
      setTxns(parseSheet(await r.text()));
      setRefreshed(new Date());
    } catch { setError('Could not load sheet. Make sure it is set to "Anyone with link can view".'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    (async () => {
      const [p, s, ob, cb, n, on] = await Promise.all([
        loadPayPeriods(), loadBofaSettings(), loadOverallBudget(),
        loadCategoryBudgets(), loadTransactionNotes(), loadOverviewNote(),
      ]);
      setPeriods(p);
      if (s?.minimum_balance != null) setMinBal(s.minimum_balance);
      setOvBudget(ob); setCatBudgets(cb); setNotes(n); setOvNote(on || '');
    })();
  }, []);

  // ── derived groups ────────────────────────────────────────────────────────────
  const incomes   = useMemo(() => txns.filter(t => t.isIncome), [txns]);
  const transfers = useMemo(() => txns.filter(t => t.isTransfer), [txns]);
  const expenses  = useMemo(() => txns.filter(t => !t.isIncome && !t.isTransfer), [txns]);

  // ── tab 1 calculations ────────────────────────────────────────────────────────
  const totalIncome  = useMemo(() => incomes.reduce((s,t) => s+t.amount, 0), [incomes]);
  const totalBofaExp = useMemo(() => expenses.filter(isBofa).reduce((s,t) => s+t.amount, 0), [expenses]);
  const totalPaidAmex= useMemo(() => transfers.reduce((s,t) => s+t.amount, 0), [transfers]);
  const totalAmexChg = useMemo(() => expenses.filter(isAmex).reduce((s,t) => s+t.amount, 0), [expenses]);
  const outstandingAmex = useMemo(() => Math.max(0, totalAmexChg - totalPaidAmex), [totalAmexChg, totalPaidAmex]);
  const bofaBalance  = useMemo(() => minBal + totalIncome - totalBofaExp - totalPaidAmex, [minBal, totalIncome, totalBofaExp, totalPaidAmex]);

  // ── tab 2 filtering ────────────────────────────────────────────────────────────
  const dateFilt = useMemo(() => {
    let t = expenses;
    if (dateFrom) { const d = toLocalDate(dateFrom); if (d) t = t.filter(x => x.dateObj && x.dateObj >= d); }
    if (dateTo)   { const d = toLocalDate(dateTo);   if (d) { const e = new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59); t = t.filter(x => x.dateObj && x.dateObj <= e); } }
    return t;
  }, [expenses, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    let t = drillCat ? dateFilt.filter(x => x.category === drillCat) : dateFilt;
    if (fCat !== 'All')    t = t.filter(x => x.category === fCat);
    if (fMethod !== 'All') t = t.filter(x => x.method   === fMethod);
    if (search)            t = t.filter(x => x.merchant.toLowerCase().includes(search.toLowerCase()) || (notes[x.id]||'').toLowerCase().includes(search.toLowerCase()));
    return t;
  }, [dateFilt, drillCat, fCat, fMethod, search, notes]);

  const sorted = useMemo(() => [...filtered].sort((a,b) => {
    if (sortCol === 'date')   { const da=a.dateObj||new Date(0), db=b.dateObj||new Date(0); return sortDir==='asc' ? da-db : db-da; }
    if (sortCol === 'amount') return sortDir==='asc' ? a.amount-b.amount : b.amount-a.amount;
    return sortDir==='asc' ? (a[sortCol]||'').localeCompare(b[sortCol]||'') : (b[sortCol]||'').localeCompare(a[sortCol]||'');
  }), [filtered, sortCol, sortDir]);

  const PAGE = 25;
  const paged      = useMemo(() => sorted.slice(PAGE*(page-1), PAGE*page), [sorted, page]);
  const totalPages = Math.ceil(sorted.length / PAGE);
  const totalFilt  = useMemo(() => dateFilt.reduce((s,t) => s+t.amount, 0), [dateFilt]);
  const totalShown = useMemo(() => sorted.reduce((s,t) => s+t.amount, 0), [sorted]);

  // ── period enrichment ─────────────────────────────────────────────────────────
  const enriched = useMemo(() => periods.map(p => {
    const start  = toLocalDate(p.start_date);
    const endRaw = toLocalDate(p.end_date);
    if (!start || !endRaw) return { ...p, bofaSpend:0, amexSpend:0, total:0, saved:0, budget:0, days:0, daysPassed:0, isCurrent:false };
    const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate(), 23,59,59);
    const pt = expenses.filter(t => t.dateObj && t.dateObj >= start && t.dateObj <= end);
    const bofaSpend = pt.filter(isBofa).reduce((s,t) => s+t.amount, 0);
    const amexSpend = pt.filter(isAmex).reduce((s,t) => s+t.amount, 0);
    const total = bofaSpend + amexSpend;
    const budget = p.budget_amount || 0;
    const saved  = budget - total;
    const days   = Math.max(1, Math.ceil((end - start) / 86400000));
    const now    = new Date();
    const daysPassed = Math.min(Math.max(0, Math.ceil((now - start) / 86400000)), days);
    return { ...p, start, end, bofaSpend, amexSpend, total, budget, saved, days, daysPassed, isCurrent: now >= start && now <= end };
  }), [periods, expenses]);

  const currentP = useMemo(() => enriched.find(p => p.isCurrent) || enriched[0] || null, [enriched]);

  // ── chart data ────────────────────────────────────────────────────────────────
  const catData = useMemo(() => {
    const m = {};
    dateFilt.forEach(t => { m[t.category] = (m[t.category]||0) + t.amount; });
    return Object.entries(m).map(([name,value]) => ({name,value})).sort((a,b) => b.value-a.value);
  }, [dateFilt]);

  const recurring = useMemo(() => dateFilt.filter(isRecur), [dateFilt]);

  // ── handlers ─────────────────────────────────────────────────────────────────
  const savePer = async () => {
    if (!pForm.start_date || !pForm.end_date || !pForm.budget_amount) return;
    const sv = await savePayPeriod({ ...editPeriod, ...pForm, budget_amount:parseFloat(pForm.budget_amount) });
    setPeriods(prev => { const ex = prev.find(p=>p.id===sv.id); return ex ? prev.map(p=>p.id===sv.id?sv:p) : [sv,...prev]; });
    setShowModal(false); setEditPeriod(null); setPForm({label:'',start_date:'',end_date:'',budget_amount:''});
  };
  const delPer     = async id => { await deletePayPeriod(id); setPeriods(prev => prev.filter(p=>p.id!==id)); };
  const saveMinBal = async () => { const v=parseFloat(minBInput)||0; setMinBal(v); await saveBofaSettings(v); setEditMinB(false); };
  const saveOvB    = async () => { const v=parseFloat(ovBInput)||null; setOvBudget(v); if(v) await saveOverallBudget(v); setEditOvB(false); };
  const addCatB    = async () => { if(!newBCat||!newBAmt) return; const a=parseFloat(newBAmt); await saveCategoryBudget(newBCat,a); setCatBudgets(prev=>{const ex=prev.find(b=>b.category===newBCat);return ex?prev.map(b=>b.category===newBCat?{...b,amount:a}:b):[...prev,{category:newBCat,amount:a}];}); setNewBCat(''); setNewBAmt(''); };
  const delCatB    = async cat => { await deleteCategoryBudget(cat); setCatBudgets(prev=>prev.filter(b=>b.category!==cat)); };
  const saveNote   = async (id,note) => { setNotes(prev=>({...prev,[id]:note})); await saveTransactionNote(id,note); };
  const handleSort = col => { if(sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc'); else {setSortCol(col);setSortDir('desc');} setPage(1); };
  const clearFilters = () => { setDateFrom(''); setDateTo(''); setFCat('All'); setFMethod('All'); setSearch(''); setDrillCat(null); setPage(1); };
  const hasFilters = dateFrom || dateTo || fCat!=='All' || fMethod!=='All' || search || drillCat;

  const handleOvNote = async val => {
    setOvNote(val); setSavingNote(true);
    clearTimeout(window.__noteT);
    window.__noteT = setTimeout(async () => { await saveOverviewNote(val); setSavingNote(false); }, 900);
  };

  const openNewPeriod = () => { setEditPeriod(null); setPForm({label:'',start_date:'',end_date:'',budget_amount:''}); setShowModal(true); };
  const openEditPeriod = p => { setEditPeriod(p); setPForm({label:p.label||'',start_date:p.start_date,end_date:p.end_date,budget_amount:String(p.budget_amount)}); setShowModal(true); };

  const sortArrow = col => sortCol===col ? (sortDir==='asc'?' ↑':' ↓') : '';

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>

      {/* ── Nav ── */}
      <nav className="nav">
        <div className="nav-brand">
          <div className="nav-icon">💰</div>
          <span className="nav-title">MyFinance</span>
        </div>
        <div className="nav-tabs">
          {[['overview','Overview'],['tracker','Pay Periods']].map(([t,l]) => (
            <button key={t} className={`nav-tab${tab===t?' active':''}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>
        <div className="nav-actions">
          {refreshed && <span style={{fontSize:11,color:'var(--text-muted)',fontFamily:'var(--mono)',display:'none'}} className="hide-xs">{refreshed.toLocaleTimeString()}</span>}
          <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={loading}>{loading?'Loading…':'↻ Refresh'}</button>
        </div>
      </nav>

      {error && <div className="error-bar">{error}</div>}

      {/* ══════════════ TAB 1: OVERVIEW ══════════════ */}
      {tab === 'overview' && (
        <div className="page fade-up">
          <div className="stack">

            {/* Hero cards */}
            <div className="grid-2">

              {/* BofA */}
              <div className="card card-pad">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                  <div>
                    <div className="card-title" style={{color:'#B45309'}}>Bank of America</div>
                    <div className="hero-amount" style={{color:bofaBalance>=0?'var(--text-primary)':'var(--red)'}}>{currency(bofaBalance)}</div>
                    <div style={{fontSize:12,color:'var(--text-muted)',marginTop:6}}>Calculated account balance</div>
                  </div>
                  <div style={{width:40,height:40,borderRadius:10,background:'#FFFBEB',border:'1px solid #FDE68A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🏦</div>
                </div>
                <div>
                  {[['+','Total Income',totalIncome,'var(--green)'],['-','BofA Direct Spend',totalBofaExp,'var(--red)'],['-','Paid to AMEX',totalPaidAmex,'var(--amber)'],['-','Min Balance Reserve',minBal,'var(--purple)']].map(([sign,label,val,color])=>(
                    <div key={label} className="stat-row">
                      <span className="stat-label"><span className="stat-sign" style={{color}}>{sign}</span>{label}</span>
                      <span className="stat-val" style={{color}}>{currency(val)}</span>
                    </div>
                  ))}
                </div>
                <div style={{paddingTop:12,borderTop:'1px solid var(--border)',marginTop:4}}>
                  {editMinB ? (
                    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{fontSize:12,color:'var(--text-muted)'}}>Min reserve:</span>
                      <input className="input" value={minBInput} onChange={e=>setMinBInput(e.target.value)} type="number" style={{width:110}} />
                      <button className="btn btn-primary btn-sm" onClick={saveMinBal}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setEditMinB(false)}>Cancel</button>
                    </div>
                  ):(
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:12,color:'var(--text-muted)'}}>Min reserve: <span style={{fontFamily:'var(--mono)',color:'var(--purple)',fontWeight:600}}>{currency(minBal)}</span></span>
                      <button className="btn btn-ghost btn-sm" onClick={()=>{setMinBInput(String(minBal));setEditMinB(true);}}>Edit</button>
                    </div>
                  )}
                </div>
              </div>

              {/* AMEX */}
              <div className="card card-pad">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                  <div>
                    <div className="card-title" style={{color:'var(--purple)'}}>American Express</div>
                    <div className="hero-amount" style={{color:outstandingAmex>0?'var(--red)':'var(--green)'}}>{currency(outstandingAmex)}</div>
                    <div style={{fontSize:12,color:'var(--text-muted)',marginTop:6}}>Outstanding card balance</div>
                  </div>
                  <div style={{width:40,height:40,borderRadius:10,background:'#F5F3FF',border:'1px solid #DDD6FE',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>💳</div>
                </div>
                <div>
                  {[['-','Total AMEX Charged',totalAmexChg,'var(--red)'],['+','Paid from BofA',totalPaidAmex,'var(--green)']].map(([sign,label,val,color])=>(
                    <div key={label} className="stat-row">
                      <span className="stat-label"><span className="stat-sign" style={{color}}>{sign}</span>{label}</span>
                      <span className="stat-val" style={{color}}>{currency(val)}</span>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:14,padding:'10px 14px',borderRadius:10,background:outstandingAmex>0?'var(--red-light)':'var(--green-light)',border:`1px solid ${outstandingAmex>0?'#FECACA':'#A7F3D0'}`}}>
                  <span style={{fontSize:13,fontWeight:600,color:outstandingAmex>0?'var(--red)':'var(--green)'}}>
                    {outstandingAmex>0?`⚠️  ${currency(outstandingAmex)} still owed on AMEX`:'✅  AMEX fully paid off'}
                  </span>
                </div>
              </div>
            </div>

            {/* Income */}
            <div className="card card-pad">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <div className="card-title" style={{margin:0}}>Income Sources</div>
                <span style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--green)',fontWeight:600}}>{currency(totalIncome)} · {incomes.length} entries</span>
              </div>
              {incomes.length === 0
                ? <p className="empty">No income found. Add rows with Method = "Income" in your sheet.</p>
                : <>
                  {incomes.map(t => (
                    <div key={t.id} className="income-row">
                      <div style={{display:'flex',alignItems:'center',gap:12}}>
                        <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text-muted)',width:86,flexShrink:0}}>{t.date}</span>
                        <span style={{fontSize:13,fontWeight:500}}>{t.merchant}</span>
                      </div>
                      <span style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600,color:'var(--green)'}}>{currency(t.amount)}</span>
                    </div>
                  ))}
                  <div style={{display:'flex',justifyContent:'flex-end',paddingTop:10,borderTop:'1px solid var(--border)',marginTop:6}}>
                    <span style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:'var(--green)'}}>{currency(totalIncome)}</span>
                  </div>
                </>
              }
            </div>

            {/* Notes */}
            <div className="card card-pad">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div className="card-title" style={{margin:0}}>Notes</div>
                <span style={{fontSize:11,color:savingNote?'var(--amber)':'var(--text-muted)',transition:'color 0.3s'}}>{savingNote?'Saving…':'Auto-saved'}</span>
              </div>
              <textarea className="notes-area" value={ovNote} onChange={e=>handleOvNote(e.target.value)} placeholder="Add notes, goals, reminders about your finances…" />
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ TAB 2: PAY PERIODS ══════════════ */}
      {tab === 'tracker' && (
        <div className="page fade-up">
          <div className="stack">

            {/* Filter bar */}
            <div className="filter-bar">
              <div className="filter-row">
                <span className="filter-label">Range</span>
                <input type="date" className="input" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}} style={{width:'auto'}} />
                <span style={{color:'var(--text-muted)',fontSize:13}}>→</span>
                <input type="date" className="input" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}} style={{width:'auto'}} />
                {hasFilters && <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{color:'var(--red)'}}>✕ Clear all</button>}
                <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  {ovBudget ? (
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:12,color:'var(--text-secondary)'}}>Budget <span style={{fontFamily:'var(--mono)',fontWeight:600,color:'var(--text-primary)'}}>{currency(ovBudget)}</span></span>
                      <div style={{width:80,height:4,borderRadius:99,background:'var(--border)',overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.min(100,totalFilt/ovBudget*100)}%`,background:totalFilt>ovBudget?'var(--red)':totalFilt/ovBudget>0.8?'var(--amber)':'var(--green)',borderRadius:99,transition:'width 0.5s'}}/>
                      </div>
                      <span style={{fontSize:12,fontFamily:'var(--mono)',fontWeight:600,color:totalFilt>ovBudget?'var(--red)':'var(--green)'}}>{currency(Math.abs(ovBudget-totalFilt))} {totalFilt>ovBudget?'over':'left'}</span>
                      <button className="btn btn-ghost btn-sm" onClick={()=>{setOvBInput(String(ovBudget));setEditOvB(true);}}>Edit</button>
                    </div>
                  ) : editOvB ? (
                    <div style={{display:'flex',gap:6}}>
                      <input className="input" value={ovBInput} onChange={e=>setOvBInput(e.target.value)} type="number" placeholder="Overall budget $" style={{width:160}}/>
                      <button className="btn btn-primary btn-sm" onClick={saveOvB}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setEditOvB(false)}>✕</button>
                    </div>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={()=>setEditOvB(true)}>+ Set Budget</button>
                  )}
                </div>
              </div>
            </div>

            {/* Current period */}
            <div className="period-hero">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:'#2563EB',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>Current Pay Period</div>
                  <div style={{fontSize:'clamp(18px,4vw,24px)',fontWeight:700,color:'#1E3A8A',letterSpacing:'-0.02em'}}>
                    {currentP ? (currentP.label || `${currentP.start_date} → ${currentP.end_date}`) : 'No active period'}
                  </div>
                  {currentP && <div style={{fontSize:12,color:'#60A5FA',marginTop:4}}>Day {currentP.daysPassed} of {currentP.days}</div>}
                </div>
                <div style={{display:'flex',gap:8,flexShrink:0}}>
                  {currentP && <button className="btn btn-secondary btn-sm" style={{borderColor:'#BFDBFE',color:'#2563EB'}} onClick={()=>openEditPeriod(currentP)}>Edit</button>}
                  <button className="btn btn-primary btn-sm" onClick={openNewPeriod}>+ New Period</button>
                </div>
              </div>
              {currentP && <>
                <div className="period-stats">
                  {[['Budget',currentP.budget,'#1D4ED8'],['BofA Spend',currentP.bofaSpend,'#D97706'],['AMEX Spend',currentP.amexSpend,'#7C3AED'],['Total Spent',currentP.total,'#DC2626'],[currentP.saved>=0?'Remaining':'Over by',Math.abs(currentP.saved),currentP.saved>=0?'#059669':'#DC2626']].map(([l,v,c])=>(
                    <div key={l}>
                      <div className="period-stat-label">{l}</div>
                      <div className="period-stat-val" style={{color:c}}>{currency(v)}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B93C9',marginBottom:5}}>
                    <span>{currentP.budget>0?Math.round(currentP.total/currentP.budget*100):0}% used</span>
                    <span>{currentP.days-currentP.daysPassed} days left</span>
                  </div>
                  <PBar value={currentP.total} max={currentP.budget} color="#2563EB" />
                </div>
              </>}
            </div>

            {/* Charts + Recurring */}
            <div className="grid-chart">
              {/* Category donut */}
              <div className="card card-pad">
                <div className="card-title">Spend by Category</div>
                {catData.length === 0
                  ? <p className="empty">No data for selected range</p>
                  : <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
                    <div style={{flexShrink:0,width:160,height:160}}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={catData} cx="50%" cy="50%" outerRadius={76} innerRadius={46} dataKey="value" strokeWidth={0} onClick={d=>setDrillCat(prev=>prev===d.name?null:d.name)}>
                            {catData.map(d=><Cell key={d.name} fill={CAT_COLOR[d.name]||'#94A3B8'} opacity={drillCat&&drillCat!==d.name?0.2:1}/>)}
                          </Pie>
                          <Tooltip formatter={v=>[currency(v),'Spend']} contentStyle={{background:'#fff',border:'1px solid var(--border)',borderRadius:8,fontSize:12,boxShadow:'var(--shadow-md)'}}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{flex:1,minWidth:140,maxHeight:180,overflowY:'auto'}}>
                      {catData.map(d=>(
                        <div key={d.name} className={`legend-row${drillCat===d.name?' active':drillCat&&drillCat!==d.name?' dimmed':''}`} onClick={()=>setDrillCat(prev=>prev===d.name?null:d.name)}>
                          <span style={{display:'flex',alignItems:'center',gap:7,fontSize:13,color:'var(--text-secondary)'}}>
                            <span className="dot" style={{background:CAT_COLOR[d.name]||'#94A3B8',width:8,height:8}}/>{d.name}
                          </span>
                          <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--text-primary)',fontWeight:500}}>{currency(d.value)}</span>
                            <span style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--text-muted)',width:30,textAlign:'right'}}>{totalFilt>0?Math.round(d.value/totalFilt*100):0}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                }
                {drillCat && <button className="btn btn-ghost btn-sm" onClick={()=>setDrillCat(null)} style={{width:'100%',marginTop:10}}>✕ Clear category filter: {drillCat}</button>}
              </div>

              {/* Recurring */}
              <div className="card card-pad">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div className="card-title" style={{margin:0}}>Recurring</div>
                  <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--purple)',fontWeight:600}}>{currency(recurring.reduce((s,t)=>s+t.amount,0))}</span>
                </div>
                {recurring.length === 0
                  ? <p className="empty" style={{padding:'16px 0'}}>None detected</p>
                  : <div style={{maxHeight:220,overflowY:'auto'}}>
                    {recurring.map(t=>(
                      <div key={t.id} className="recur-row">
                        <div>
                          <div style={{fontSize:13,fontWeight:600,color:'#5B21B6'}}>{t.merchant}</div>
                          <div style={{fontFamily:'var(--mono)',fontSize:10,color:'#A78BFA'}}>{t.date}</div>
                        </div>
                        <span style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600,color:'#5B21B6'}}>{currency(t.amount)}</span>
                      </div>
                    ))}
                  </div>
                }
              </div>
            </div>

            {/* Period history */}
            <div className="card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 20px',borderBottom:'1px solid var(--border)'}}>
                <div className="card-title" style={{margin:0}}>Period History</div>
                <button className="btn btn-primary btn-sm" onClick={openNewPeriod}>+ New Period</button>
              </div>
              {enriched.length === 0
                ? <p className="empty">No periods yet. Create your first above.</p>
                : <div className="table-wrap">
                  <table className="period-table">
                    <thead><tr>
                      <th>Period</th><th>Budget</th><th>BofA</th><th>AMEX</th><th>Total</th><th>Saved / Over</th><th>Rate</th><th></th>
                    </tr></thead>
                    <tbody>
                      {enriched.map(p=>(
                        <tr key={p.id} className={p.isCurrent?'current-row':''}>
                          <td>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontSize:13,fontWeight:p.isCurrent?700:400}}>{p.label||`${p.start_date} → ${p.end_date}`}</span>
                              {p.isCurrent && <span className="tag" style={{background:'var(--blue-light)',color:'var(--blue)'}}>Now</span>}
                            </div>
                          </td>
                          <td><span style={{fontFamily:'var(--mono)',fontSize:13}}>{currency(p.budget)}</span></td>
                          <td><span style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--amber)',fontWeight:500}}>{currency(p.bofaSpend)}</span></td>
                          <td><span style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--purple)',fontWeight:500}}>{currency(p.amexSpend)}</span></td>
                          <td><span style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600}}>{currency(p.total)}</span></td>
                          <td><span style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:p.saved>=0?'var(--green)':'var(--red)'}}>{p.saved>=0?'+':''}{currency(p.saved)}</span></td>
                          <td>
                            <span style={{fontSize:13,fontWeight:600,color:p.saved>=0?'var(--green)':'var(--red)'}}>
                              {p.budget>0?`${Math.abs(Math.round((1-p.total/p.budget)*100))}%`:'—'} {p.saved>=0?'✅':'❌'}
                            </span>
                          </td>
                          <td>
                            <div style={{display:'flex',gap:6}}>
                              <button className="btn btn-secondary btn-sm" onClick={()=>openEditPeriod(p)}>Edit</button>
                              <button className="btn btn-danger btn-sm" onClick={()=>delPer(p.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            </div>

            {/* Savings trend */}
            {enriched.length > 0 && (
              <div className="card card-pad">
                <div className="card-title">Savings Trend</div>
                {enriched.map(p=>(
                  <div key={p.id} className="budget-item">
                    <div className="budget-header">
                      <span style={{fontSize:13,color:'var(--text-secondary)',fontWeight:500}}>{p.label||`${p.start_date} → ${p.end_date}`}</span>
                      <span style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:600,color:p.saved>=0?'var(--green)':'var(--red)'}}>{p.saved>=0?'↑ ':' ↓ '}{currency(Math.abs(p.saved))}</span>
                    </div>
                    <PBar value={p.total} max={p.budget} color="#2563EB" />
                  </div>
                ))}
              </div>
            )}

            {/* Category budgets */}
            <div className="card card-pad">
              <div className="card-title">Category Budgets</div>
              <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                <select className="input" value={newBCat} onChange={e=>setNewBCat(e.target.value)} style={{flex:1,minWidth:160}}>
                  <option value="">Select category…</option>
                  {CATS.filter(c=>!catBudgets.find(b=>b.category===c)).map(c=><option key={c}>{c}</option>)}
                </select>
                <input className="input" type="number" placeholder="$ amount" value={newBAmt} onChange={e=>setNewBAmt(e.target.value)} style={{width:120}} />
                <button className="btn btn-primary btn-sm" onClick={addCatB}>+ Add</button>
              </div>
              {catBudgets.map(b=>{
                const spent = dateFilt.filter(t=>t.category===b.category).reduce((s,t)=>s+t.amount,0);
                const pct   = b.amount>0?Math.min(100,spent/b.amount*100):0;
                const col   = pct>=100?'var(--red)':pct>=80?'var(--amber)':'var(--blue)';
                return (
                  <div key={b.category} className="budget-item">
                    <div className="budget-header">
                      <span style={{display:'flex',alignItems:'center',gap:7,fontSize:13,fontWeight:500}}>
                        <span className="dot" style={{background:CAT_COLOR[b.category]||'#94A3B8',width:8,height:8}}/>{b.category}
                      </span>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <span style={{fontFamily:'var(--mono)',fontSize:12,color:col,fontWeight:600}}>{currency(spent)}</span>
                        <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--text-muted)'}}>/ {currency(b.amount)}</span>
                        <button className="btn btn-danger btn-sm" style={{padding:'2px 8px',fontSize:11}} onClick={()=>delCatB(b.category)}>✕</button>
                      </div>
                    </div>
                    <PBar value={spent} max={b.amount} color="#2563EB" />
                  </div>
                );
              })}
            </div>

            {/* Transaction filters */}
            <div className="card card-pad">
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <div style={{position:'relative',flex:'1 1 200px'}}>
                  <span style={{position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)',fontSize:14,pointerEvents:'none'}}>🔍</span>
                  <input className="input input-full" placeholder="Search merchant or note…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{paddingLeft:34}} />
                </div>
                <select className="input" value={fCat} onChange={e=>{setFCat(e.target.value);setPage(1);}} style={{flex:'0 1 160px',minWidth:130}}>
                  <option value="All">All Categories</option>
                  {CATS.map(c=><option key={c}>{c}</option>)}
                </select>
                <select className="input" value={fMethod} onChange={e=>{setFMethod(e.target.value);setPage(1);}} style={{flex:'0 1 120px',minWidth:100}}>
                  <option value="All">All Methods</option>
                  <option>Amex</option>
                  <option>BofA</option>
                </select>
                {hasFilters && <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{color:'var(--red)'}}>✕ Clear</button>}
                <span style={{fontSize:12,color:'var(--text-muted)',fontFamily:'var(--mono)',marginLeft:'auto',whiteSpace:'nowrap'}}>{sorted.length} txns · {currency(totalShown)}</span>
              </div>
            </div>

            {drillCat && (
              <div className="drill-banner">
                <span style={{fontSize:13,color:'var(--blue)',fontWeight:600}}>Category filter: <strong>{drillCat}</strong></span>
                <button className="btn btn-ghost btn-sm" onClick={()=>setDrillCat(null)}>✕ Clear</button>
              </div>
            )}

            {/* Transactions table */}
            <div className="card">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCat','Sub Cat'],['note','Note']].map(([col,label])=>(
                        <th key={col} onClick={()=>col!=='note'&&handleSort(col)}>{label}{sortArrow(col)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.length === 0
                      ? <tr><td colSpan={7}><p className="empty">No transactions match your filters.</p></td></tr>
                      : paged.map(t=>{
                        const amt = t.amount;
                        const rowCls = isRecur(t)?'row-purple':amt>=80?'row-red':amt>=40?'row-amber':'';
                        const amtColor = amt>=80?'var(--red)':amt>=40?'var(--amber)':'var(--text-primary)';
                        return (
                          <tr key={t.id} className={rowCls}>
                            <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{t.date}</td>
                            <td style={{fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                              {t.merchant}
                              {isRecur(t) && <span style={{marginLeft:6,fontSize:10,color:'var(--purple)',fontWeight:700}}>↻</span>}
                            </td>
                            <td className="table-amount" style={{color:amtColor}}>{currency(amt)}</td>
                            <td><MethodBadge method={t.method}/></td>
                            <td><CatBadge cat={t.category}/></td>
                            <td style={{fontSize:11,color:'var(--text-muted)'}}>{t.subCat}</td>
                            <td><NoteCell txId={t.id} note={notes[t.id]||''} onSave={saveNote}/></td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:10,padding:'14px 20px',borderTop:'1px solid var(--border)'}}>
                  <button className="btn btn-secondary btn-sm" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>← Prev</button>
                  <span style={{fontSize:12,color:'var(--text-muted)',fontFamily:'var(--mono)'}}>Page {page} of {totalPages}</span>
                  <button className="btn btn-secondary btn-sm" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next →</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget){setShowModal(false);setEditPeriod(null);}}}>
          <div className="modal-box">
            <div className="modal-title">{editPeriod?'Edit Pay Period':'New Pay Period'}</div>
            <div className="form-group">
              <label className="form-label">Label (optional)</label>
              <input className="input input-full" value={pForm.label} onChange={e=>setPForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Apr 15 – Apr 30" />
            </div>
            <div className="form-grid" style={{marginBottom:14}}>
              <div>
                <label className="form-label">Start Date</label>
                <input type="date" className="input input-full" value={pForm.start_date} onChange={e=>setPForm(f=>({...f,start_date:e.target.value}))} />
              </div>
              <div>
                <label className="form-label">End Date</label>
                <input type="date" className="input input-full" value={pForm.end_date} onChange={e=>setPForm(f=>({...f,end_date:e.target.value}))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Budget Amount ($)</label>
              <input type="number" className="input input-full" value={pForm.budget_amount} onChange={e=>setPForm(f=>({...f,budget_amount:e.target.value}))} placeholder="e.g. 3200" />
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:20}}>
              <button className="btn btn-secondary" onClick={()=>{setShowModal(false);setEditPeriod(null);}}>Cancel</button>
              <button className="btn btn-primary" onClick={savePer}>Save Period</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
