import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  supabase, getBofaSettings, setBofaMinBalance, getOverallBudget, setOverallBudget,
  getCategoryBudgets, upsertCategoryBudget, deleteCategoryBudget,
  getPayPeriods, upsertPayPeriod, deletePayPeriod,
  getTransactionNotes, setTransactionNote, getPref, setPref
} from './supabase';

// ── Constants ─────────────────────────────────────────────────────────────────
const SHEET_ID = '1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ';
const API_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1`;

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
const AMEX_METHODS = ['Apple Pay Amex','Amex Credit Card'];
const BOFA_METHODS = ['Apple Pay BofA','BofA Debit Card','Zelle'];
const RECURRING_KW = ['netflix','spotify','amazon prime','hulu','apple','google one','microsoft','adobe','dropbox','visible','walmart+','notion','openai','claude','linkedin','youtube','disney','paramount','peacock','gym','membership'];

const fmt  = n => '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtK = n => { const a=Math.abs(n); return a>=1000?'$'+(a/1000).toFixed(1)+'k':fmt(n); };
const isAmexTransfer = t => t.merchant.toLowerCase().includes('amex') && BOFA_METHODS.includes(t.method);
const isAmexCharge   = t => AMEX_METHODS.includes(t.method);
const isBofaDirect   = t => BOFA_METHODS.includes(t.method) && !isAmexTransfer(t);
const isRecurring    = (merchant,cat) => cat==='Subscriptions'||RECURRING_KW.some(k=>merchant.toLowerCase().includes(k));

function parseGDate(raw) {
  if (!raw && raw!==0) return null;
  const s=String(raw).trim();
  const gm=s.match(/Date\((\d+),(\d+),(\d+)\)/);
  if (gm) return new Date(+gm[1],+gm[2],+gm[3]);
  const d=new Date(s); if (!isNaN(d.getTime())) return d;
  const mdy=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(+mdy[3],+mdy[1]-1,+mdy[2]);
  const ymd=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1],+ymd[2]-1,+ymd[3]);
  return null;
}
function displayDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'});
}
function parseSheetData(raw) {
  const json=JSON.parse(raw.replace(/^[^(]+\(/,'').replace(/\);?\s*$/,''));
  return (json.table.rows||[]).map((r,idx)=>{
    const c=r.c; if (!c||!c[0]||!c[2]) return null;
    const merchant=(c[1]?.v||'').trim();
    const rawAmt=parseFloat(c[2]?.v);
    if (isNaN(rawAmt)||!merchant) return null;
    const method=(c[3]?.v||'').trim();
    const category=(c[4]?.v||'Other').trim();
    const subCategory=(c[5]?.v||'').trim();
    const isIncome=method.toLowerCase().includes('income');
    const amount=isIncome?Math.abs(rawAmt):-Math.abs(rawAmt);
    const dateObj=parseGDate(c[0]?.v);
    const date=displayDate(dateObj)||String(c[0]?.v||'');
    return {id:idx,date,dateObj,merchant,amount,method,category,subCategory,isIncome};
  }).filter(Boolean);
}

// ── Styles ───────────────────────────────────────────────────────────────────
const S = {
  inp:  {padding:'7px 10px',borderRadius:8,border:'0.5px solid #e2e8f0',fontSize:13,background:'#fff',color:'#334155'},
  card: {background:'#fff',borderRadius:12,border:'0.5px solid #e2e8f0',padding:'16px 20px'},
  th:   {padding:'10px 12px',borderBottom:'1px solid #e2e8f0',fontSize:11,fontWeight:600,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.05em',textAlign:'left',background:'#f8fafc',cursor:'pointer',whiteSpace:'nowrap'},
  td:   {padding:'10px 12px',borderBottom:'0.5px solid #f1f5f9',fontSize:13,color:'#334155',verticalAlign:'top'},
};

// ── Small reusable components ─────────────────────────────────────────────────
function BigHeroCard({label,value,sub,color,detail}) {
  return (
    <div style={{background:'#fff',borderRadius:16,padding:'24px 28px',border:'0.5px solid #e2e8f0',flex:1}}>
      <div style={{fontSize:13,color:'#64748b',marginBottom:8,fontWeight:500}}>{label}</div>
      <div style={{fontSize:36,fontWeight:700,color:color||'#0f172a',marginBottom:6}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:'#94a3b8'}}>{sub}</div>}
      {detail&&<div style={{marginTop:16,display:'flex',flexDirection:'column',gap:6}}>{detail}</div>}
    </div>
  );
}

function DetailRow({label,value,color}) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:13}}>
      <span style={{color:'#64748b'}}>{label}</span>
      <span style={{fontWeight:600,color:color||'#334155'}}>{value}</span>
    </div>
  );
}

function StatCard({label,value,sub,color}) {
  return (
    <div style={{background:'#fff',borderRadius:12,padding:'14px 18px',border:'0.5px solid #e2e8f0'}}>
      <div style={{fontSize:12,color:'#64748b',marginBottom:5}}>{label}</div>
      <div style={{fontSize:20,fontWeight:600,color:color||'#0f172a'}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

function DonutChart({data,title,subtitle,onSegmentClick,activeCat,colorMap}) {
  const total=data.reduce((s,d)=>s+d.value,0);
  return (
    <div style={S.card}>
      <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:2}}>{title}</div>
      {subtitle&&<div style={{fontSize:11,color:'#94a3b8',marginBottom:10}}>{subtitle}</div>}
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:150,height:150,flexShrink:0}}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={38} outerRadius={65}
                dataKey="value" paddingAngle={2}
                onClick={onSegmentClick?(_,i)=>onSegmentClick(data[i].name):undefined}>
                {data.map(d=>(
                  <Cell key={d.name} fill={colorMap[d.name]||'#888'}
                    opacity={activeCat&&activeCat!==d.name?0.22:1}
                    stroke={activeCat===d.name?'#0f172a':'none'} strokeWidth={2}
                    style={{cursor:onSegmentClick?'pointer':'default'}}/>
                ))}
              </Pie>
              <Tooltip formatter={(v,n)=>[fmt(v),n]}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:5,overflow:'hidden'}}>
          {data.slice(0,8).map(d=>(
            <div key={d.name}
              onClick={onSegmentClick?()=>onSegmentClick(d.name):undefined}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:12,
                cursor:onSegmentClick?'pointer':'default',
                opacity:activeCat&&activeCat!==d.name?0.3:1}}>
              <div style={{width:8,height:8,borderRadius:2,flexShrink:0,background:colorMap[d.name]||'#888'}}/>
              <span style={{flex:1,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}</span>
              <div style={{textAlign:'right',flexShrink:0}}>
                <span style={{color:'#0f172a',fontWeight:500}}>{fmt(d.value)}</span>
                <span style={{color:'#94a3b8',marginLeft:4}}>({((d.value/total)*100).toFixed(0)}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BudgetBar({label,spent,budget,color,onEdit,onRemove}) {
  const pct=budget>0?Math.min((spent/budget)*100,150):0;
  const over=spent>budget&&budget>0;
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <div style={{width:10,height:10,borderRadius:2,background:color||'#888'}}/>
          <span style={{fontSize:13,color:'#334155',fontWeight:500}}>{label}</span>
          {over&&<span style={{fontSize:10,background:'#FEE2E2',color:'#991B1B',padding:'1px 7px',borderRadius:10,fontWeight:600}}>OVER</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
          <span style={{color:over?'#dc2626':'#334155',fontWeight:500}}>{fmt(spent)}</span>
          <span style={{color:'#94a3b8'}}>of</span>
          <span onClick={onEdit} style={{color:'#378ADD',cursor:'pointer',fontWeight:500,textDecoration:'underline dotted'}}>{fmt(budget)}</span>
          {onRemove&&<button onClick={onRemove} style={{fontSize:11,color:'#dc2626',background:'none',border:'0.5px solid #fecaca',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Remove</button>}
        </div>
      </div>
      <div style={{height:8,background:'#f1f5f9',borderRadius:4,overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:4,width:`${Math.min(pct,100)}%`,
          background:pct>=100?'#dc2626':pct>=80?'#f59e0b':color||'#888',transition:'width 0.4s ease'}}/>
      </div>
      <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{pct.toFixed(0)}% used</div>
    </div>
  );
}

function TransactionTable({rows,notes,onNoteEdit,editingNote,noteInput,setNoteInput,onNoteSave,onNoteCancel,sortCol,sortDir,onSort}) {
  const flagBg=amt=>{const a=Math.abs(amt);if(a>=80)return'#FEE2E2';if(a>=40)return'#FEF9C3';return null;};
  const sa=col=>sortCol===col?(sortDir==='asc'?'↑':'↓'):'';
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',minWidth:720}}>
        <thead>
          <tr>
            {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCategory','Sub Cat']].map(([col,label])=>(
              <th key={col} style={S.th} onClick={()=>onSort(col)}>{label} {sa(col)}</th>
            ))}
            <th style={{...S.th,cursor:'default'}}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.length===0
            ?<tr><td colSpan={7} style={{...S.td,textAlign:'center',color:'#94a3b8',padding:32}}>No transactions found</td></tr>
            :rows.map((t,i)=>{
              const flag=flagBg(t.amount);
              const rec=isRecurring(t.merchant,t.category);
              const rowBg=flag||(rec?'#f0f4ff':i%2===1?'#f8fafc':'#fff');
              const txnNote=notes[t.id]||'';
              return (
                <tr key={t.id} style={{background:rowBg}}>
                  <td style={{...S.td,whiteSpace:'nowrap'}}>{t.date}</td>
                  <td style={{...S.td,fontWeight:500,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {rec&&<span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#7F77DD',marginRight:6,verticalAlign:'middle'}}/>}
                    {t.merchant}
                  </td>
                  <td style={{...S.td,textAlign:'right',fontWeight:600,whiteSpace:'nowrap',
                    color:flag==='#FEE2E2'?'#991B1B':flag==='#FEF9C3'?'#854D0E':'#dc2626'}}>
                    -{fmt(t.amount)}
                  </td>
                  <td style={S.td}>
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,whiteSpace:'nowrap',
                      background:(METHOD_COLORS[t.method]||'#888')+'18',color:METHOD_COLORS[t.method]||'#475569',fontWeight:500}}>
                      {t.method||'—'}
                    </span>
                  </td>
                  <td style={S.td}>
                    <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,whiteSpace:'nowrap',
                      background:(CAT_COLORS[t.category]||'#888')+'18',color:CAT_COLORS[t.category]||'#475569',fontWeight:500}}>
                      {t.category}
                    </span>
                  </td>
                  <td style={{...S.td,color:'#64748b',fontSize:12,whiteSpace:'nowrap'}}>{t.subCategory}</td>
                  <td style={{...S.td,minWidth:160}}>
                    {editingNote===t.id?(
                      <div style={{display:'flex',gap:4,alignItems:'flex-start'}}>
                        <textarea autoFocus value={noteInput} onChange={e=>setNoteInput(e.target.value)}
                          rows={2} placeholder="Add a note..."
                          style={{flex:1,padding:'4px 6px',borderRadius:6,border:'1px solid #378ADD',fontSize:12,resize:'vertical',minWidth:120}}
                          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onNoteSave(t.id);}if(e.key==='Escape')onNoteCancel();}}/>
                        <div style={{display:'flex',flexDirection:'column',gap:3}}>
                          <button onClick={()=>onNoteSave(t.id)} style={{fontSize:11,background:'#378ADD',color:'#fff',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>Save</button>
                          <button onClick={onNoteCancel} style={{fontSize:11,background:'#f1f5f9',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>✕</button>
                        </div>
                      </div>
                    ):(
                      <div onClick={()=>onNoteEdit(t.id,txnNote)}
                        style={{cursor:'pointer',minHeight:28,borderRadius:6,padding:'4px 6px',
                          border:'0.5px dashed #e2e8f0',fontSize:12,
                          color:txnNote?'#334155':'#94a3b8',background:txnNote?'#f8fafc':'transparent'}}>
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
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab,    setActiveTab]    = useState('overview');
  const [allTxns,      setAllTxns]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [dbLoading,    setDbLoading]    = useState(true);
  const [error,        setError]        = useState('');
  const [lastRefresh,  setLastRefresh]  = useState(null);

  // ── Supabase state ───────────────────────────────────────────────────────
  const [notes,             setNotes]             = useState({});
  const [bofaMinBalance,    setBofaMinBalState]    = useState(0);
  const [overallBudget,     setOverallBudgetState] = useState(0);
  const [categoryBudgets,   setCategoryBudgets]    = useState([]);
  const [payPeriods,        setPayPeriods]         = useState([]);

  // ── UI editing state ─────────────────────────────────────────────────────
  const [editingMinBal,     setEditingMinBal]      = useState(false);
  const [minBalInput,       setMinBalInput]        = useState('');
  const [editingOvBudget,   setEditingOvBudget]    = useState(false);
  const [ovBudgetInput,     setOvBudgetInput]      = useState('');
  const [newBudgetCat,      setNewBudgetCat]       = useState('');
  const [newBudgetAmt,      setNewBudgetAmt]       = useState('');
  const [editingBudgetCat,  setEditingBudgetCat]   = useState(null);
  const [editBudgetAmt,     setEditBudgetAmt]      = useState('');
  const [editingNote,       setEditingNote]        = useState(null);
  const [noteInput,         setNoteInput]          = useState('');

  // ── Period management ────────────────────────────────────────────────────
  const [showPeriodForm,    setShowPeriodForm]     = useState(false);
  const [periodForm,        setPeriodForm]         = useState({label:'',start_date:'',end_date:'',budget_amount:''});
  const [editingPeriodId,   setEditingPeriodId]    = useState(null);

  // ── Filters (Tab 2) ──────────────────────────────────────────────────────
  const [dateFrom,          setDateFrom]           = useState('');
  const [dateTo,            setDateTo]             = useState('');
  const [filterCat,         setFilterCat]          = useState('All');
  const [filterMethod,      setFilterMethod]       = useState('All');
  const [search,            setSearch]             = useState('');
  const [drillCat,          setDrillCat]           = useState(null);
  const [sortCol,           setSortCol]            = useState('date');
  const [sortDir,           setSortDir]            = useState('desc');
  const [page,              setPage]               = useState(1);
  const PER_PAGE = 20;

  // ── Load from Supabase ───────────────────────────────────────────────────
  const loadFromDb = useCallback(async () => {
    setDbLoading(true);
    try {
      const [bofaS, ovB, catB, periods, txnNotes] = await Promise.all([
        getBofaSettings(), getOverallBudget(), getCategoryBudgets(),
        getPayPeriods(), getTransactionNotes(),
      ]);
      setBofaMinBalState(bofaS.minimum_balance || 0);
      setOverallBudgetState(ovB || 0);
      setCategoryBudgets(catB);
      setPayPeriods(periods);
      setNotes(txnNotes);
    } catch(e) { console.error('DB load error:', e); }
    finally { setDbLoading(false); }
  }, []);

  // ── Load sheet data ──────────────────────────────────────────────────────
  const fetchSheet = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(API_URL);
      const text = await res.text();
      setAllTxns(parseSheetData(text));
      setLastRefresh(new Date());
    } catch {
      setError('Could not load sheet data. Check that your Google Sheet is publicly viewable.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSheet(); loadFromDb(); }, []);

  // ── Derived transaction sets ─────────────────────────────────────────────
  const expenses     = useMemo(()=>allTxns.filter(t=>!t.isIncome),[allTxns]);
  const incomeRows   = useMemo(()=>allTxns.filter(t=>t.isIncome),[allTxns]);
  const amexCharges  = useMemo(()=>expenses.filter(isAmexCharge),[expenses]);
  const amexPaid     = useMemo(()=>expenses.filter(isAmexTransfer),[expenses]);
  const bofaDirect   = useMemo(()=>expenses.filter(isBofaDirect),[expenses]);

  // ── Tab 1 calculations ───────────────────────────────────────────────────
  const totalIncome       = incomeRows.reduce((s,t)=>s+t.amount,0);
  const totalBofaDirect   = bofaDirect.reduce((s,t)=>s+Math.abs(t.amount),0);
  const totalAmexPaid     = amexPaid.reduce((s,t)=>s+Math.abs(t.amount),0);
  const totalAmexCharged  = amexCharges.reduce((s,t)=>s+Math.abs(t.amount),0);
  const amexOutstanding   = totalAmexCharged - totalAmexPaid;
  const bofaBalance       = totalIncome - totalBofaDirect - totalAmexPaid - bofaMinBalance;

  // ── Date-filtered expenses (Tab 2) ───────────────────────────────────────
  const dfExp = useMemo(()=>{
    let l=expenses;
    if (dateFrom){const d=new Date(dateFrom);l=l.filter(t=>t.dateObj&&t.dateObj>=d);}
    if (dateTo){const d=new Date(dateTo+'T23:59:59');l=l.filter(t=>t.dateObj&&t.dateObj<=d);}
    return l;
  },[expenses,dateFrom,dateTo]);

  // ── Secondary filtered (table) ───────────────────────────────────────────
  const filtered = useMemo(()=>{
    let l=drillCat?dfExp.filter(t=>t.category===drillCat):dfExp;
    if (filterCat!=='All') l=l.filter(t=>t.category===filterCat);
    if (filterMethod!=='All') l=l.filter(t=>t.method===filterMethod);
    if (search) l=l.filter(t=>
      t.merchant.toLowerCase().includes(search.toLowerCase())||
      t.category.toLowerCase().includes(search.toLowerCase())||
      (notes[t.id]||'').toLowerCase().includes(search.toLowerCase())
    );
    return l;
  },[dfExp,drillCat,filterCat,filterMethod,search,notes]);

  const sorted = useMemo(()=>[...filtered].sort((a,b)=>{
    if (sortCol==='date'){const va=a.dateObj||new Date(0),vb=b.dateObj||new Date(0);return sortDir==='asc'?va-vb:vb-va;}
    if (sortCol==='amount'){return sortDir==='asc'?Math.abs(a.amount)-Math.abs(b.amount):Math.abs(b.amount)-Math.abs(a.amount);}
    return sortDir==='asc'?(a[sortCol]||'').localeCompare(b[sortCol]||''):(b[sortCol]||'').localeCompare(a[sortCol]||'');
  }),[filtered,sortCol,sortDir]);

  const paged      = sorted.slice((page-1)*PER_PAGE,page*PER_PAGE);
  const totalPages = Math.ceil(sorted.length/PER_PAGE);

  // ── Period calculations ──────────────────────────────────────────────────
  const enrichedPeriods = useMemo(()=>payPeriods.map(p=>{
    const sd=new Date(p.start_date), ed=new Date(p.end_date+'T23:59:59');
    const pExp=expenses.filter(t=>t.dateObj&&t.dateObj>=sd&&t.dateObj<=ed&&!isAmexTransfer(t));
    const bofaSpend=pExp.filter(isBofaDirect).reduce((s,t)=>s+Math.abs(t.amount),0);
    const amexSpend=pExp.filter(isAmexCharge).reduce((s,t)=>s+Math.abs(t.amount),0);
    const total=bofaSpend+amexSpend;
    const saved=p.budget_amount-total;
    const rate=p.budget_amount>0?(saved/p.budget_amount)*100:0;
    const days=Math.ceil((ed-sd)/(1000*60*60*24));
    const today=new Date(); const daysPassed=Math.min(Math.ceil((today-sd)/(1000*60*60*24)),days);
    const isCurrent=today>=sd&&today<=ed;
    return {...p,bofaSpend,amexSpend,total,saved,rate,days,daysPassed,isCurrent,pExp};
  }),[payPeriods,expenses]);

  const currentPeriod=enrichedPeriods.find(p=>p.isCurrent)||null;
  const lastPeriod   =enrichedPeriods.find(p=>!p.isCurrent&&enrichedPeriods.indexOf(p)===1)||enrichedPeriods[1]||null;

  // ── Chart data ───────────────────────────────────────────────────────────
  const catData = useMemo(()=>{
    const m={};dfExp.forEach(t=>{if(!isAmexTransfer(t)){m[t.category]=(m[t.category]||0)+Math.abs(t.amount);}});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));
  },[dfExp]);

  const bofaVsAmex = useMemo(()=>{
    const b=dfExp.filter(isBofaDirect).reduce((s,t)=>s+Math.abs(t.amount),0);
    const a=dfExp.filter(isAmexCharge).reduce((s,t)=>s+Math.abs(t.amount),0);
    return [{name:'BofA',value:parseFloat(b.toFixed(2))},{name:'AMEX',value:parseFloat(a.toFixed(2))}];
  },[dfExp]);

  const totalSpend = dfExp.filter(t=>!isAmexTransfer(t)).reduce((s,t)=>s+Math.abs(t.amount),0);
  const recurringTxns = useMemo(()=>dfExp.filter(t=>isRecurring(t.merchant,t.category)&&!isAmexTransfer(t)),[dfExp]);
  const recurringTotal= recurringTxns.reduce((s,t)=>s+Math.abs(t.amount),0);
  const top3 = catData.slice(0,3);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSort  = col=>{if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('desc');}setPage(1);};
  const handleDrill = name=>{setDrillCat(drillCat===name?null:name);setFilterCat('All');setPage(1);};
  const clearFilters= ()=>{setFilterCat('All');setFilterMethod('All');setSearch('');setDrillCat(null);setPage(1);};

  const saveMinBal = async()=>{
    const v=parseFloat(minBalInput)||0;
    await setBofaMinBalance(v); setBofaMinBalState(v); setEditingMinBal(false);
  };
  const saveOvBudget = async()=>{
    const v=parseFloat(ovBudgetInput)||0;
    await setOverallBudget(v); setOverallBudgetState(v); setEditingOvBudget(false);
  };
  const addCatBudget = async()=>{
    if (!newBudgetCat||!newBudgetAmt) return;
    const amt=parseFloat(newBudgetAmt)||0;
    await upsertCategoryBudget(newBudgetCat,amt);
    setCategoryBudgets(prev=>{
      const exists=prev.find(b=>b.category===newBudgetCat);
      if (exists) return prev.map(b=>b.category===newBudgetCat?{...b,amount:amt}:b);
      return [...prev,{category:newBudgetCat,amount:amt}];
    });
    setNewBudgetCat(''); setNewBudgetAmt('');
  };
  const saveCatBudget = async(cat)=>{
    const amt=parseFloat(editBudgetAmt)||0;
    await upsertCategoryBudget(cat,amt);
    setCategoryBudgets(prev=>prev.map(b=>b.category===cat?{...b,amount:amt}:b));
    setEditingBudgetCat(null);
  };
  const removeCatBudget = async(cat)=>{
    await deleteCategoryBudget(cat);
    setCategoryBudgets(prev=>prev.filter(b=>b.category!==cat));
  };
  const saveNote = async(id)=>{
    await setTransactionNote(id,noteInput.trim());
    setNotes(prev=>({...prev,[id]:noteInput.trim()}));
    setEditingNote(null); setNoteInput('');
  };

  const savePeriod = async()=>{
    const p={...periodForm,budget_amount:parseFloat(periodForm.budget_amount)||0};
    if (editingPeriodId) p.id=editingPeriodId;
    await upsertPayPeriod(p);
    await loadFromDb();
    setShowPeriodForm(false); setPeriodForm({label:'',start_date:'',end_date:'',budget_amount:''}); setEditingPeriodId(null);
  };
  const removePeriod = async(id)=>{
    await deletePayPeriod(id); setPayPeriods(prev=>prev.filter(p=>p.id!==id));
  };

  const hasDateFilter = dateFrom||dateTo;
  const hasFilter     = filterCat!=='All'||filterMethod!=='All'||search||drillCat;

  // ── Overall budget bar ───────────────────────────────────────────────────
  const obPct      = overallBudget>0?Math.min((totalSpend/overallBudget)*100,100):0;
  const obOver     = overallBudget>0&&totalSpend>overallBudget;
  const obBarColor = obPct>=100?'#dc2626':obPct>=80?'#f59e0b':'#1D9E75';

  if (loading||dbLoading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:16}}>
      <div style={{width:36,height:36,border:'3px solid #e2e8f0',borderTop:'3px solid #378ADD',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <div style={{color:'#64748b',fontSize:14}}>Loading your dashboard...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (error) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:12,padding:24}}>
      <div style={{fontSize:32}}>⚠</div>
      <div style={{color:'#dc2626',fontWeight:500,textAlign:'center',maxWidth:400}}>{error}</div>
      <button onClick={fetchSheet} style={{...S.inp,cursor:'pointer'}}>Try again</button>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:'#f4f6fb',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'}}>

      {/* ══ STICKY HEADER ══ */}
      <div style={{background:'#fff',borderBottom:'0.5px solid #e2e8f0',position:'sticky',top:0,zIndex:100}}>
        <div style={{maxWidth:1160,margin:'0 auto',padding:'12px 20px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
            <div>
              <div style={{fontSize:18,fontWeight:600,color:'#0f172a'}}>My Finance Dashboard</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{allTxns.length} transactions · {lastRefresh?.toLocaleTimeString()}</div>
            </div>
            {/* Tabs */}
            <div style={{display:'flex',gap:4,background:'#f1f5f9',borderRadius:10,padding:4}}>
              {[['overview','Financial Overview'],['tracker','Pay Period Tracker']].map(([t,l])=>(
                <button key={t} onClick={()=>setActiveTab(t)}
                  style={{padding:'7px 18px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:500,
                    background:activeTab===t?'#fff':'transparent',
                    color:activeTab===t?'#0f172a':'#64748b',
                    boxShadow:activeTab===t?'0 1px 3px rgba(0,0,0,0.08)':'none'}}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={()=>{fetchSheet();loadFromDb();}} style={{...S.inp,cursor:'pointer',fontWeight:500}}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* ══ TAB 1: FINANCIAL OVERVIEW ══ */}
      {activeTab==='overview'&&(
        <div style={{maxWidth:1160,margin:'0 auto',padding:'24px 20px'}}>

          {/* Two hero cards */}
          <div style={{display:'flex',gap:16,marginBottom:20,flexWrap:'wrap'}}>

            {/* BofA Hero */}
            <BigHeroCard
              label="Bank of America — Account Balance"
              value={fmt(bofaBalance)}
              color={bofaBalance<0?'#dc2626':'#185FA5'}
              sub={bofaBalance<0?'⚠ Balance is negative — check your transactions':'Calculated from all your transactions'}
              detail={<>
                <DetailRow label="Total income received" value={fmt(totalIncome)} color="#16a34a"/>
                <DetailRow label="Direct BofA spend" value={'-'+fmt(totalBofaDirect)} color="#dc2626"/>
                <DetailRow label="Paid to AMEX from BofA" value={'-'+fmt(totalAmexPaid)} color="#dc2626"/>
                <div style={{borderTop:'0.5px solid #f1f5f9',marginTop:4,paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:12,color:'#64748b'}}>Minimum balance floor</span>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    {editingMinBal?(
                      <form onSubmit={e=>{e.preventDefault();saveMinBal();}} style={{display:'flex',gap:4}}>
                        <input autoFocus type="number" value={minBalInput} onChange={e=>setMinBalInput(e.target.value)}
                          style={{width:90,padding:'3px 7px',borderRadius:6,border:'1px solid #378ADD',fontSize:12}}/>
                        <button type="submit" style={{fontSize:11,background:'#378ADD',color:'#fff',border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>Save</button>
                        <button type="button" onClick={()=>setEditingMinBal(false)} style={{fontSize:11,background:'#f1f5f9',border:'none',borderRadius:6,padding:'3px 6px',cursor:'pointer'}}>✕</button>
                      </form>
                    ):(
                      <span onClick={()=>{setMinBalInput(String(bofaMinBalance));setEditingMinBal(true);}}
                        style={{fontSize:12,fontWeight:600,color:'#378ADD',cursor:'pointer',textDecoration:'underline dotted'}}>
                        -{fmt(bofaMinBalance)}
                      </span>
                    )}
                  </div>
                </div>
              </>}
            />

            {/* AMEX Hero */}
            <BigHeroCard
              label="American Express — Total Spend"
              value={fmt(amexOutstanding)}
              color={amexOutstanding>0?'#1A56DB':'#16a34a'}
              sub={amexOutstanding>0?'Outstanding balance on your AMEX card':'No outstanding AMEX balance'}
              detail={<>
                <DetailRow label="Total charged on AMEX" value={fmt(totalAmexCharged)} color="#dc2626"/>
                <DetailRow label="Paid from BofA to AMEX" value={'-'+fmt(totalAmexPaid)} color="#16a34a"/>
                <div style={{borderTop:'0.5px solid #f1f5f9',marginTop:4,paddingTop:8,display:'flex',justifyContent:'space-between'}}>
                  <span style={{fontSize:12,color:'#64748b'}}>Outstanding balance</span>
                  <span style={{fontSize:13,fontWeight:700,color:amexOutstanding>0?'#1A56DB':'#16a34a'}}>{fmt(amexOutstanding)}</span>
                </div>
              </>}
            />
          </div>

          {/* Overall budget */}
          <div style={{...S.card,marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:overallBudget>0?12:0,flexWrap:'wrap',gap:8}}>
              <span style={{fontSize:13,fontWeight:500,color:'#334155'}}>Overall spending budget</span>
              {editingOvBudget?(
                <form onSubmit={e=>{e.preventDefault();saveOvBudget();}} style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:13,color:'#64748b'}}>$</span>
                  <input autoFocus type="number" value={ovBudgetInput} onChange={e=>setOvBudgetInput(e.target.value)}
                    placeholder="e.g. 5000"
                    style={{width:110,padding:'4px 8px',borderRadius:7,border:'1px solid #378ADD',fontSize:13}}/>
                  <button type="submit" style={{fontSize:12,background:'#378ADD',color:'#fff',border:'none',borderRadius:7,padding:'5px 14px',cursor:'pointer',fontWeight:500}}>Save</button>
                  <button type="button" onClick={()=>setEditingOvBudget(false)} style={{fontSize:12,background:'#f1f5f9',border:'none',borderRadius:7,padding:'5px 10px',cursor:'pointer'}}>Cancel</button>
                </form>
              ):overallBudget>0?(
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:13,color:'#0f172a',fontWeight:600}}>{fmt(totalSpend)}</span>
                  <span style={{fontSize:12,color:'#94a3b8'}}>spent of</span>
                  <span style={{fontSize:13,fontWeight:600,color:'#334155'}}>{fmt(overallBudget)}</span>
                  {obOver
                    ?<span style={{fontSize:12,background:'#FEE2E2',color:'#991B1B',padding:'2px 10px',borderRadius:20,fontWeight:600}}>{fmt(totalSpend-overallBudget)} over budget</span>
                    :<span style={{fontSize:12,background:'#D1FAE5',color:'#065F46',padding:'2px 10px',borderRadius:20,fontWeight:600}}>{fmt(overallBudget-totalSpend)} remaining</span>
                  }
                  <button onClick={()=>{setOvBudgetInput(String(overallBudget));setEditingOvBudget(true);}} style={{fontSize:11,color:'#378ADD',background:'none',border:'0.5px solid #bfdbfe',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Edit</button>
                  <button onClick={async()=>{await setOverallBudget(0);setOverallBudgetState(0);}} style={{fontSize:11,color:'#dc2626',background:'none',border:'0.5px solid #fecaca',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Remove</button>
                </div>
              ):(
                <button onClick={()=>setEditingOvBudget(true)} style={{fontSize:12,color:'#378ADD',background:'#eff6ff',border:'0.5px solid #bfdbfe',borderRadius:8,padding:'5px 14px',cursor:'pointer',fontWeight:500}}>+ Set overall budget</button>
              )}
            </div>
            {overallBudget>0&&(
              <>
                <div style={{height:10,background:'#e2e8f0',borderRadius:5,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:5,width:`${obPct}%`,background:obBarColor,transition:'width 0.5s ease'}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',marginTop:3,fontSize:10,color:'#94a3b8'}}>
                  <span>$0</span><span>{fmtK(overallBudget*0.25)}</span><span>{fmtK(overallBudget*0.5)}</span><span>{fmtK(overallBudget*0.75)}</span><span>{fmt(overallBudget)}</span>
                </div>
              </>
            )}
          </div>

          {/* Category budgets */}
          <div style={{...S.card,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:3}}>Category budgets</div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:14}}>Add budgets only for categories you want to track.</div>
            {(() => {
              const usedCats=categoryBudgets.map(b=>b.category);
              const available=CATS.filter(c=>!usedCats.includes(c));
              return available.length>0&&(
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
                  <select value={newBudgetCat} onChange={e=>setNewBudgetCat(e.target.value)} style={{...S.inp,minWidth:160}}>
                    <option value="">Select category...</option>
                    {available.map(c=><option key={c}>{c}</option>)}
                  </select>
                  <input type="number" placeholder="Budget ($)" value={newBudgetAmt} onChange={e=>setNewBudgetAmt(e.target.value)} style={{...S.inp,width:150}}/>
                  <button onClick={addCatBudget} disabled={!newBudgetCat||!newBudgetAmt}
                    style={{padding:'7px 16px',borderRadius:8,border:'none',fontWeight:500,fontSize:13,
                      background:newBudgetCat&&newBudgetAmt?'#378ADD':'#e2e8f0',
                      color:newBudgetCat&&newBudgetAmt?'#fff':'#94a3b8',
                      cursor:newBudgetCat&&newBudgetAmt?'pointer':'default'}}>
                    + Add
                  </button>
                </div>
              );
            })()}
            {categoryBudgets.length===0
              ?<div style={{textAlign:'center',padding:'20px 0',color:'#94a3b8',fontSize:13}}>No category budgets yet.</div>
              :<div style={{display:'flex',flexDirection:'column',gap:14}}>
                {categoryBudgets.map(b=>{
                  const spent=expenses.filter(t=>t.category===b.category&&!isAmexTransfer(t)).reduce((s,t)=>s+Math.abs(t.amount),0);
                  return editingBudgetCat===b.category?(
                    <div key={b.category} style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:13,fontWeight:500,color:'#334155',minWidth:100}}>{b.category}</span>
                      <form onSubmit={e=>{e.preventDefault();saveCatBudget(b.category);}} style={{display:'flex',gap:4}}>
                        <input autoFocus value={editBudgetAmt} onChange={e=>setEditBudgetAmt(e.target.value)}
                          style={{width:90,padding:'4px 7px',borderRadius:6,border:'1px solid #378ADD',fontSize:13}}/>
                        <button type="submit" style={{fontSize:12,background:'#378ADD',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>Save</button>
                        <button type="button" onClick={()=>setEditingBudgetCat(null)} style={{fontSize:12,background:'#f1f5f9',border:'none',borderRadius:6,padding:'4px 8px',cursor:'pointer'}}>✕</button>
                      </form>
                    </div>
                  ):(
                    <BudgetBar key={b.category} label={b.category} spent={spent} budget={b.amount}
                      color={CAT_COLORS[b.category]}
                      onEdit={()=>{setEditingBudgetCat(b.category);setEditBudgetAmt(String(b.amount));}}
                      onRemove={()=>removeCatBudget(b.category)}/>
                  );
                })}
              </div>
            }
          </div>
        </div>
      )}

      {/* ══ TAB 2: PAY PERIOD TRACKER ══ */}
      {activeTab==='tracker'&&(
        <div style={{maxWidth:1160,margin:'0 auto',padding:'20px'}}>

          {/* Date filter — sticky within tab */}
          <div style={{...S.card,marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <span style={{fontSize:12,fontWeight:500,color:'#334155'}}>Date range</span>
              <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}}
                style={{...S.inp,borderColor:hasDateFilter?'#378ADD':'#e2e8f0'}}/>
              <span style={{fontSize:12,color:'#94a3b8'}}>→</span>
              <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}}
                style={{...S.inp,borderColor:hasDateFilter?'#378ADD':'#e2e8f0'}}/>
              {hasDateFilter&&(
                <button onClick={()=>{setDateFrom('');setDateTo('');setPage(1);}}
                  style={{fontSize:12,color:'#dc2626',background:'#FEE2E2',border:'none',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontWeight:500}}>
                  ✕ Clear
                </button>
              )}
              {hasDateFilter&&(
                <span style={{fontSize:12,color:'#1e40af',background:'#eff6ff',padding:'3px 12px',borderRadius:20,fontWeight:500}}>
                  {dateFrom?new Date(dateFrom).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'All past'}
                  {' → '}
                  {dateTo?new Date(dateTo).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' (today)'}
                </span>
              )}
            </div>
          </div>

          {/* Current Period Card */}
          {currentPeriod?(
            <div style={{background:'linear-gradient(135deg,#185FA5 0%,#1A56DB 100%)',borderRadius:16,padding:'24px 28px',marginBottom:16,color:'#fff'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:16}}>
                <div>
                  <div style={{fontSize:12,opacity:0.75,marginBottom:4}}>Current Pay Period</div>
                  <div style={{fontSize:20,fontWeight:600}}>{currentPeriod.label||`${currentPeriod.start_date} → ${currentPeriod.end_date}`}</div>
                  <div style={{fontSize:13,opacity:0.75,marginTop:2}}>Day {currentPeriod.daysPassed} of {currentPeriod.days}</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>{setPeriodForm({label:currentPeriod.label||'',start_date:currentPeriod.start_date,end_date:currentPeriod.end_date,budget_amount:String(currentPeriod.budget_amount)});setEditingPeriodId(currentPeriod.id);setShowPeriodForm(true);}}
                    style={{fontSize:12,background:'rgba(255,255,255,0.2)',color:'#fff',border:'0.5px solid rgba(255,255,255,0.4)',borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>
                    Edit period
                  </button>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:16}}>
                {[
                  {label:'Budget',value:fmt(currentPeriod.budget_amount)},
                  {label:'BofA Spend',value:fmt(currentPeriod.bofaSpend)},
                  {label:'AMEX Spend',value:fmt(currentPeriod.amexSpend)},
                  {label:'Total Spent',value:fmt(currentPeriod.total)},
                  {label:'Remaining',value:fmt(currentPeriod.saved),highlight:true},
                ].map(c=>(
                  <div key={c.label} style={{background:'rgba(255,255,255,0.12)',borderRadius:10,padding:'12px 14px'}}>
                    <div style={{fontSize:11,opacity:0.75,marginBottom:4}}>{c.label}</div>
                    <div style={{fontSize:18,fontWeight:700,color:c.highlight&&currentPeriod.saved<0?'#fca5a5':'#fff'}}>{c.value}</div>
                  </div>
                ))}
              </div>
              <div style={{height:8,background:'rgba(255,255,255,0.2)',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:4,
                  width:`${Math.min(currentPeriod.budget_amount>0?(currentPeriod.total/currentPeriod.budget_amount)*100:0,100)}%`,
                  background:currentPeriod.total>currentPeriod.budget_amount?'#fca5a5':'rgba(255,255,255,0.85)',
                  transition:'width 0.5s'}}/>
              </div>
              <div style={{fontSize:11,opacity:0.7,marginTop:4}}>
                {currentPeriod.budget_amount>0?`${((currentPeriod.total/currentPeriod.budget_amount)*100).toFixed(0)}% of budget used`:'No budget set for this period'}
                {currentPeriod.saved>0&&currentPeriod.daysPassed>0&&(
                  <span style={{marginLeft:12}}>Safe daily spend: {fmt(currentPeriod.saved/(currentPeriod.days-currentPeriod.daysPassed||1))}/day</span>
                )}
              </div>
            </div>
          ):(
            <div style={{...S.card,marginBottom:16,textAlign:'center',padding:32,color:'#94a3b8'}}>
              No active pay period. Add one below.
            </div>
          )}

          {/* This period vs Last period */}
          {currentPeriod&&lastPeriod&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
              {[{p:currentPeriod,label:'This Period'},{p:lastPeriod,label:'Last Period'}].map(({p,label})=>(
                <div key={label} style={S.card}>
                  <div style={{fontSize:11,color:'#94a3b8',marginBottom:4,fontWeight:500,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
                  <div style={{fontSize:14,fontWeight:600,color:'#334155',marginBottom:12}}>{p.label||`${p.start_date} → ${p.end_date}`}</div>
                  {[
                    {l:'Budget',v:fmt(p.budget_amount)},
                    {l:'BofA spend',v:fmt(p.bofaSpend),c:'#C2410C'},
                    {l:'AMEX spend',v:fmt(p.amexSpend),c:'#1D4ED8'},
                    {l:'Total spent',v:fmt(p.total),c:'#dc2626'},
                    {l:p.saved>=0?'Saved':'Overspent',v:fmt(Math.abs(p.saved)),c:p.saved>=0?'#16a34a':'#dc2626'},
                  ].map(r=><DetailRow key={r.l} label={r.l} value={r.v} color={r.c}/>)}
                  <div style={{marginTop:8,display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:12,fontWeight:600,
                      background:p.rate>=0?'#D1FAE5':'#FEE2E2',
                      color:p.rate>=0?'#065F46':'#991B1B',
                      padding:'2px 10px',borderRadius:20}}>
                      {p.rate>=0?'+':''}{p.rate.toFixed(0)}% {p.rate>=0?'saved':'over'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Charts row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16,marginBottom:16}}>
            <DonutChart data={catData} title="Spend by category"
              subtitle="Click a segment to filter transactions below"
              onSegmentClick={handleDrill} activeCat={drillCat} colorMap={CAT_COLORS}/>
            <div style={S.card}>
              <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:12}}>BofA vs AMEX spend</div>
              <div style={{height:180}}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bofaVsAmex} margin={{top:4,right:8,left:0,bottom:4}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                    <XAxis dataKey="name" tick={{fontSize:13,fill:'#64748b'}}/>
                    <YAxis tick={{fontSize:11,fill:'#64748b'}} tickFormatter={v=>v>=1000?'$'+(v/1000).toFixed(0)+'k':'$'+v}/>
                    <Tooltip formatter={v=>[fmt(v)]}/>
                    <Bar dataKey="value" radius={[6,6,0,0]}>
                      <Cell fill="#C2410C"/><Cell fill="#1D4ED8"/>
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Drill banner */}
          {drillCat&&(
            <div style={{background:'#eff6ff',borderRadius:10,padding:'10px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',border:'0.5px solid #bfdbfe'}}>
              <span style={{fontSize:13,color:'#1e40af',fontWeight:500}}>Drill-down: {drillCat} · {fmt(filtered.reduce((s,t)=>s+Math.abs(t.amount),0))} · {filtered.length} transactions</span>
              <button onClick={()=>{setDrillCat(null);setPage(1);}} style={{fontSize:13,color:'#dc2626',background:'none',border:'none',cursor:'pointer',fontWeight:500}}>✕ Clear</button>
            </div>
          )}

          {/* Period history */}
          <div style={{...S.card,marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:13,fontWeight:500,color:'#334155'}}>Pay period history</div>
              <button onClick={()=>{setShowPeriodForm(true);setEditingPeriodId(null);setPeriodForm({label:'',start_date:'',end_date:'',budget_amount:''}); }}
                style={{fontSize:13,background:'#185FA5',color:'#fff',border:'none',borderRadius:8,padding:'7px 16px',cursor:'pointer',fontWeight:500}}>
                + New period
              </button>
            </div>

            {showPeriodForm&&(
              <div style={{background:'#f8fafc',borderRadius:10,padding:'16px',marginBottom:16,border:'0.5px solid #e2e8f0'}}>
                <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:12}}>{editingPeriodId?'Edit period':'Add new period'}</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:12}}>
                  <div><div style={{fontSize:11,color:'#64748b',marginBottom:4}}>Label (optional)</div>
                    <input value={periodForm.label} onChange={e=>setPeriodForm(p=>({...p,label:e.target.value}))} placeholder="e.g. Apr 1–14" style={{...S.inp,width:'100%'}}/></div>
                  <div><div style={{fontSize:11,color:'#64748b',marginBottom:4}}>Start date</div>
                    <input type="date" value={periodForm.start_date} onChange={e=>setPeriodForm(p=>({...p,start_date:e.target.value}))} style={{...S.inp,width:'100%'}}/></div>
                  <div><div style={{fontSize:11,color:'#64748b',marginBottom:4}}>End date</div>
                    <input type="date" value={periodForm.end_date} onChange={e=>setPeriodForm(p=>({...p,end_date:e.target.value}))} style={{...S.inp,width:'100%'}}/></div>
                  <div><div style={{fontSize:11,color:'#64748b',marginBottom:4}}>Budget ($)</div>
                    <input type="number" value={periodForm.budget_amount} onChange={e=>setPeriodForm(p=>({...p,budget_amount:e.target.value}))} placeholder="e.g. 3200" style={{...S.inp,width:'100%'}}/></div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={savePeriod} style={{fontSize:13,background:'#185FA5',color:'#fff',border:'none',borderRadius:8,padding:'7px 20px',cursor:'pointer',fontWeight:500}}>Save period</button>
                  <button onClick={()=>{setShowPeriodForm(false);setEditingPeriodId(null);}} style={{fontSize:13,background:'#f1f5f9',color:'#334155',border:'none',borderRadius:8,padding:'7px 16px',cursor:'pointer'}}>Cancel</button>
                </div>
              </div>
            )}

            {enrichedPeriods.length===0?(
              <div style={{textAlign:'center',padding:'24px 0',color:'#94a3b8',fontSize:13}}>No pay periods yet. Add your first one above.</div>
            ):(
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:680}}>
                  <thead>
                    <tr>
                      {['Period','Budget','BofA','AMEX','Total','Saved / Over','Rate',''].map(h=>(
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedPeriods.map((p,i)=>(
                      <tr key={p.id} style={{background:p.isCurrent?'#eff6ff':i%2===1?'#f8fafc':'#fff'}}>
                        <td style={S.td}>
                          <div style={{fontWeight:500,color:'#334155'}}>{p.label||`${p.start_date}`}</div>
                          <div style={{fontSize:11,color:'#94a3b8'}}>{p.start_date} → {p.end_date}</div>
                          {p.isCurrent&&<span style={{fontSize:10,background:'#185FA5',color:'#fff',padding:'1px 6px',borderRadius:8,fontWeight:600}}>CURRENT</span>}
                        </td>
                        <td style={S.td}>{fmt(p.budget_amount)}</td>
                        <td style={{...S.td,color:'#C2410C',fontWeight:500}}>{fmt(p.bofaSpend)}</td>
                        <td style={{...S.td,color:'#1D4ED8',fontWeight:500}}>{fmt(p.amexSpend)}</td>
                        <td style={{...S.td,fontWeight:600}}>{fmt(p.total)}</td>
                        <td style={{...S.td,color:p.saved>=0?'#16a34a':'#dc2626',fontWeight:600}}>
                          {p.saved>=0?'+':'-'}{fmt(Math.abs(p.saved))}
                        </td>
                        <td style={S.td}>
                          <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,fontWeight:600,
                            background:p.rate>=0?'#D1FAE5':'#FEE2E2',
                            color:p.rate>=0?'#065F46':'#991B1B'}}>
                            {p.rate>=0?'+':''}{p.rate.toFixed(0)}%
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{display:'flex',gap:4}}>
                            <button onClick={()=>{setPeriodForm({label:p.label||'',start_date:p.start_date,end_date:p.end_date,budget_amount:String(p.budget_amount)});setEditingPeriodId(p.id);setShowPeriodForm(true);}}
                              style={{fontSize:11,color:'#378ADD',background:'none',border:'0.5px solid #bfdbfe',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Edit</button>
                            <button onClick={()=>removePeriod(p.id)}
                              style={{fontSize:11,color:'#dc2626',background:'none',border:'0.5px solid #fecaca',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Del</button>
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
          {enrichedPeriods.length>0&&(
            <div style={{...S.card,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:14}}>Savings trend across periods</div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {enrichedPeriods.slice(0,8).map(p=>{
                  const pct=p.budget_amount>0?Math.min(Math.max((p.total/p.budget_amount)*100,0),100):0;
                  return (
                    <div key={p.id}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,fontSize:12}}>
                        <span style={{color:'#334155',fontWeight:500}}>{p.label||`${p.start_date} → ${p.end_date}`}</span>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <span style={{color:p.saved>=0?'#16a34a':'#dc2626',fontWeight:600}}>{p.saved>=0?'+':''}{fmt(p.saved)}</span>
                          <span style={{fontSize:11,padding:'1px 8px',borderRadius:20,fontWeight:600,
                            background:p.rate>=0?'#D1FAE5':'#FEE2E2',color:p.rate>=0?'#065F46':'#991B1B'}}>
                            {p.rate>=0?'+':''}{p.rate.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div style={{height:8,background:'#f1f5f9',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',borderRadius:4,width:`${pct}%`,
                          background:pct>=100?'#dc2626':pct>=80?'#f59e0b':'#1D9E75',transition:'width 0.4s'}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top 3 */}
          {top3.length>0&&(
            <div style={{...S.card,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:12}}>Top 3 categories eating your budget</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
                {top3.map((c,i)=>(
                  <div key={c.name} onClick={()=>handleDrill(c.name)}
                    style={{background:'#f8fafc',borderRadius:8,padding:'12px 14px',borderLeft:`3px solid ${CAT_COLORS[c.name]||'#888'}`,cursor:'pointer'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:15,fontWeight:700,color:'#94a3b8'}}>#{i+1}</span>
                      <span style={{fontSize:13,fontWeight:500,color:'#0f172a'}}>{c.name}</span>
                    </div>
                    <div style={{fontSize:20,fontWeight:600,color:CAT_COLORS[c.name]||'#334155'}}>{fmt(c.value)}</div>
                    <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{((c.value/totalSpend)*100).toFixed(1)}% of total</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recurring */}
          {recurringTxns.length>0&&(
            <div style={{...S.card,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:3}}>Recurring charges & subscriptions</div>
              <div style={{fontSize:11,color:'#94a3b8',marginBottom:12}}>Total: {fmt(recurringTotal)} · {recurringTxns.length} detected</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {recurringTxns.map((t,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,background:'#f0f4ff',borderRadius:8,padding:'7px 12px',border:'0.5px solid #c7d7f9'}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:'#7F77DD',flexShrink:0}}/>
                    <div>
                      <div style={{fontSize:12,fontWeight:500,color:'#334155'}}>{t.merchant}</div>
                      <div style={{fontSize:11,color:'#7F77DD',fontWeight:600}}>{fmt(t.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transaction filters */}
          <div style={{...S.card,marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:500,color:'#64748b',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.05em'}}>Transaction filters</div>
            <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
              <input placeholder="Search merchant, category or note..." value={search}
                onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{...S.inp,flex:1,minWidth:200}}/>
              <select value={filterCat} onChange={e=>{setFilterCat(e.target.value);setDrillCat(null);setPage(1);}} style={S.inp}>
                <option value="All">All categories</option>
                {CATS.map(c=><option key={c}>{c}</option>)}
              </select>
              <select value={filterMethod} onChange={e=>{setFilterMethod(e.target.value);setPage(1);}} style={S.inp}>
                {METHODS.map(m=><option key={m}>{m}</option>)}
              </select>
              {hasFilter&&<button onClick={clearFilters} style={{...S.inp,color:'#dc2626',borderColor:'#fecaca',cursor:'pointer'}}>Clear</button>}
              <div style={{fontSize:12,color:'#94a3b8',marginLeft:'auto'}}>{filtered.length} transactions · {fmt(totalSpend)}</div>
            </div>
          </div>

          {/* Transactions table */}
          <div style={{...S.card,padding:0,overflow:'hidden',marginBottom:20}}>
            <div style={{padding:'14px 20px',borderBottom:'0.5px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:13,fontWeight:500,color:'#334155'}}>
                {drillCat?`Transactions — ${drillCat}`:'All transactions'}
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <span style={{fontSize:11,background:'#FEE2E2',color:'#991B1B',padding:'2px 8px',borderRadius:6}}>Red = $80+</span>
                <span style={{fontSize:11,background:'#FEF9C3',color:'#854D0E',padding:'2px 8px',borderRadius:6}}>Yellow = $40–$79</span>
                <span style={{fontSize:11,background:'#f0f4ff',color:'#3730A3',padding:'2px 8px',borderRadius:6}}>• = recurring</span>
              </div>
            </div>
            <TransactionTable
              rows={paged} notes={notes}
              editingNote={editingNote} noteInput={noteInput}
              setNoteInput={setNoteInput}
              onNoteEdit={(id,existing)=>{setEditingNote(id);setNoteInput(existing);}}
              onNoteSave={saveNote}
              onNoteCancel={()=>{setEditingNote(null);setNoteInput('');}}
              sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
            />
            {totalPages>1&&(
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'12px 16px',borderTop:'0.5px solid #f1f5f9'}}>
                <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                  style={{...S.inp,opacity:page===1?0.4:1,cursor:'pointer'}}>← Prev</button>
                <span style={{fontSize:13,color:'#64748b'}}>Page {page} of {totalPages}</span>
                <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                  style={{...S.inp,opacity:page===totalPages?0.4:1,cursor:'pointer'}}>Next →</button>
              </div>
            )}
          </div>

          <div style={{textAlign:'center',fontSize:11,color:'#cbd5e1',paddingBottom:24}}>
            Live data from Google Sheets · Saved to Supabase · Rish Finance Dashboard
          </div>
        </div>
      )}
    </div>
  );
}
