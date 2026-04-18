import React, { useState, useEffect, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts';

const SHEET_ID = '1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ';
const SHEET_NAME = 'Sheet1';
const API_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;

const CAT_COLORS = {
  Groceries:     '#1D9E75',
  Dining:        '#7F77DD',
  Transport:     '#5F5E5A',
  Subscriptions: '#378ADD',
  Shopping:      '#D4537E',
  Housing:       '#185FA5',
  Health:        '#639922',
  Utilities:     '#BA7517',
  Travel:        '#D85A30',
  Education:     '#0F6E56',
  Other:         '#888780',
  Income:        '#27500A',
};

const METHOD_COLORS = {
  'Zelle':               '#6B46C1',
  'Apple Pay Amex':      '#1A56DB',
  'Apple Pay BofA':      '#D85A30',
  'Apple Pay Chase':     '#0E7490',
  'Amex Credit Card':    '#1D4ED8',
  'BofA Debit Card':     '#C2410C',
  'Chase Debit Card':    '#0369A1',
};

const fmt = (n) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CATS = ['All','Groceries','Dining','Transport','Subscriptions','Shopping','Housing','Health','Utilities','Travel','Education','Other'];
const METHODS = ['All','Zelle','Apple Pay Amex','Apple Pay BofA','Apple Pay Chase','Amex Credit Card','BofA Debit Card','Chase Debit Card'];

function parseSheetData(raw) {
  const json = JSON.parse(raw.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, ''));
  const rows = json.table.rows;
  return rows
    .map(r => {
      const cells = r.c;
      if (!cells || !cells[0] || !cells[2]) return null;
      const dateVal = cells[0]?.v;
      const merchant = cells[1]?.v || '';
      const amount = parseFloat(cells[2]?.v);
      const method = cells[3]?.v || '';
      const category = cells[4]?.v || 'Other';
      const subCategory = cells[5]?.v || '';
      if (isNaN(amount)) return null;
      let date = '';
      if (typeof dateVal === 'string') {
        date = dateVal;
      } else if (dateVal && typeof dateVal === 'object') {
        const d = new Date(dateVal.v || dateVal);
        date = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
      }
      return { date, merchant, amount, method, category, subCategory };
    })
    .filter(Boolean);
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '16px 20px',
      border: '0.5px solid #e2e8f0', flex: 1, minWidth: 140
    }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || '#0f172a' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{ background: '#fff', border: '0.5px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
      <div style={{ fontWeight: 500 }}>{d.name}</div>
      <div style={{ color: d.fill || '#334155' }}>{fmt(d.value)}</div>
    </div>
  );
}

function DonutChart({ data, title }) {
  const [active, setActive] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e2e8f0', padding: '16px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 160, height: 160, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data} cx="50%" cy="50%"
                innerRadius={45} outerRadius={72}
                dataKey="value" paddingAngle={2}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                {data.map((d, i) => (
                  <Cell
                    key={d.name}
                    fill={CAT_COLORS[d.name] || METHOD_COLORS[d.name] || '#888'}
                    opacity={active === null || active === i ? 1 : 0.4}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, overflow: 'hidden' }}>
          {data.slice(0, 8).map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
              <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: CAT_COLORS[d.name] || METHOD_COLORS[d.name] || '#888' }} />
              <span style={{ flex: 1, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              <span style={{ color: '#0f172a', fontWeight: 500, flexShrink: 0 }}>
                {((d.value / total) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BarChartCard({ data, title, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e2e8f0', padding: '16px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#334155', marginBottom: 12 }}>{title}</div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }}
              angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={v => '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v)} />
            <Tooltip formatter={(v) => [fmt(v), '']} labelStyle={{ fontWeight: 500 }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.name} fill={color || CAT_COLORS[d.name] || '#378ADD'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TransactionRow({ txn, odd }) {
  const isExp = txn.amount < 0;
  return (
    <tr style={{ background: odd ? '#f8fafc' : '#fff' }}>
      <td style={td}>{txn.date}</td>
      <td style={{ ...td, fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txn.merchant}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: isExp ? '#dc2626' : '#16a34a' }}>
        {isExp ? '-' : '+'}{fmt(txn.amount)}
      </td>
      <td style={td}>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20,
          background: METHOD_COLORS[txn.method] ? METHOD_COLORS[txn.method] + '18' : '#f1f5f9',
          color: METHOD_COLORS[txn.method] || '#475569', fontWeight: 500
        }}>{txn.method || '—'}</span>
      </td>
      <td style={td}>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20,
          background: (CAT_COLORS[txn.category] || '#888') + '18',
          color: CAT_COLORS[txn.category] || '#475569', fontWeight: 500
        }}>{txn.category}</span>
      </td>
      <td style={{ ...td, color: '#64748b', fontSize: 12 }}>{txn.subCategory}</td>
    </tr>
  );
}

const td = { padding: '10px 12px', borderBottom: '0.5px solid #f1f5f9', fontSize: 13, color: '#334155' };
const th = { padding: '10px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', background: '#f8fafc' };

export default function App() {
  const [allTxns, setAllTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filterCat, setFilterCat] = useState('All');
  const [filterMethod, setFilterMethod] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API_URL);
      const text = await res.text();
      const parsed = parseSheetData(text);
      setAllTxns(parsed);
      setLastRefresh(new Date());
    } catch (e) {
      setError('Could not load data. Make sure your Google Sheet is set to "Anyone with the link can view".');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    return allTxns.filter(t => {
      if (filterCat !== 'All' && t.category !== filterCat) return false;
      if (filterMethod !== 'All' && t.method !== filterMethod) return false;
      if (filterType === 'Expense' && t.amount >= 0) return false;
      if (filterType === 'Income' && t.amount < 0) return false;
      if (search && !t.merchant.toLowerCase().includes(search.toLowerCase()) &&
          !t.category.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [allTxns, filterCat, filterMethod, filterType, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (sortCol === 'amount') { va = Math.abs(va); vb = Math.abs(vb); }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [filtered, sortCol, sortDir]);

  const paged = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(sorted.length / PER_PAGE);

  const expenses = filtered.filter(t => t.amount < 0);
  const income = filtered.filter(t => t.amount > 0);
  const totalSpend = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIncome = income.reduce((s, t) => s + t.amount, 0);
  const avgTxn = expenses.length ? totalSpend / expenses.length : 0;
  const biggestTxn = expenses.length ? Math.max(...expenses.map(t => Math.abs(t.amount))) : 0;

  const catData = useMemo(() => {
    const m = {};
    expenses.forEach(t => { m[t.category] = (m[t.category] || 0) + Math.abs(t.amount); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const methodData = useMemo(() => {
    const m = {};
    filtered.filter(t => t.amount < 0).forEach(t => { m[t.method] = (m[t.method] || 0) + Math.abs(t.amount); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const topMerchants = useMemo(() => {
    const m = {};
    expenses.forEach(t => { m[t.merchant] = (m[t.merchant] || 0) + Math.abs(t.amount); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const sel = {
    padding: '7px 12px', borderRadius: 8, border: '0.5px solid #e2e8f0',
    fontSize: 13, background: '#fff', color: '#334155', cursor: 'pointer'
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTop: '3px solid #378ADD', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ color: '#64748b', fontSize: 14 }}>Loading your transactions...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12, padding: 24 }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ color: '#dc2626', fontWeight: 500, textAlign: 'center' }}>{error}</div>
      <button onClick={fetchData} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 14 }}>Try again</button>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6fb', padding: '20px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0f172a' }}>My Finance Dashboard</h1>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {allTxns.length} transactions · Last synced {lastRefresh?.toLocaleTimeString()}
            </div>
          </div>
          <button onClick={fetchData} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, border: '0.5px solid #e2e8f0', background: '#fff',
            cursor: 'pointer', fontSize: 13, color: '#334155', fontWeight: 500
          }}>
            ↻ Refresh from Sheet
          </button>
        </div>

        {/* Metric Cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatCard label="Total spend" value={fmt(totalSpend)} sub={`${expenses.length} transactions`} color="#dc2626" />
          <StatCard label="Total income" value={fmt(totalIncome)} sub={`${income.length} credits`} color="#16a34a" />
          <StatCard label="Net" value={(totalIncome - totalSpend >= 0 ? '+' : '-') + fmt(totalIncome - totalSpend)}
            sub="income minus spend" color={totalIncome - totalSpend >= 0 ? '#16a34a' : '#dc2626'} />
          <StatCard label="Avg transaction" value={fmt(avgTxn)} sub="expenses only" />
          <StatCard label="Largest expense" value={fmt(biggestTxn)} />
        </div>

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
          {catData.length > 0 && <DonutChart data={catData} title="Spend by category" />}
          {methodData.length > 0 && <DonutChart data={methodData} title="Spend by payment method" />}
          {topMerchants.length > 0 && <BarChartCard data={topMerchants} title="Top merchants by spend" />}
        </div>

        {/* Filters */}
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e2e8f0', padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Search merchant or category..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ ...sel, flex: 1, minWidth: 180 }}
            />
            <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1); }} style={sel}>
              {CATS.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterMethod} onChange={e => { setFilterMethod(e.target.value); setPage(1); }} style={sel}>
              {METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} style={sel}>
              <option>All</option>
              <option>Expense</option>
              <option>Income</option>
            </select>
            {(filterCat !== 'All' || filterMethod !== 'All' || filterType !== 'All' || search) && (
              <button onClick={() => { setFilterCat('All'); setFilterMethod('All'); setFilterType('All'); setSearch(''); setPage(1); }}
                style={{ ...sel, color: '#dc2626', borderColor: '#fecaca' }}>
                Clear filters
              </button>
            )}
            <div style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
              {filtered.length} of {allTxns.length} shown
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e2e8f0', overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 100 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead>
                <tr>
                  {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCategory','Sub Category']].map(([col, label]) => (
                    <th key={col} style={{ ...th, cursor: 'pointer' }} onClick={() => handleSort(col)}>
                      {label}{sortArrow(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0
                  ? <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No transactions found</td></tr>
                  : paged.map((t, i) => <TransactionRow key={i} txn={t} odd={i % 2 === 1} />)
                }
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderTop: '0.5px solid #f1f5f9' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ ...sel, opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ fontSize: 13, color: '#64748b' }}>Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ ...sel, opacity: page === totalPages ? 0.4 : 1 }}>Next →</button>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1' }}>
          Live data from Google Sheets · Rish Finance Dashboard
        </div>
      </div>
    </div>
  );
}
