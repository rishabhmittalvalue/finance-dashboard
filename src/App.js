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

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1iZ_ZWBWtBT2lSr8tmvKZi9k1l0Vr-xPc2nr6pWNXtjQ/gviz/tq?tqx=out:json&sheet=Sheet1';

const CATEGORIES = ['Groceries','Dining','Transport','Subscriptions','Shopping','Housing','Health','Utilities','Travel','Education','Entertainment','Gift','Other'];

const CAT_COLOR = {
  Groceries:'#34D399',Dining:'#A78BFA',Transport:'#60A5FA',Subscriptions:'#FBBF24',
  Shopping:'#F472B6',Housing:'#38BDF8',Health:'#2DD4BF',Utilities:'#818CF8',
  Travel:'#FB923C',Education:'#C084FC',Entertainment:'#22D3EE',Gift:'#F9A8D4',Other:'#94A3B8',
};

const RECURRING_KW = ['netflix','spotify','hulu','apple','google one','microsoft','adobe','visible','walmart+','shortmax','netshort','amazon prime'];

const fmt = (n) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(Math.abs(n??0));

function toLocalDate(str) {
  if (!str) return null;
  const [y,m,d] = String(str).split('-').map(Number);
  if (!y||!m||!d) return null;
  return new Date(y,m-1,d);
}

function parseGvizDate(v) {
  if (v==null) return null;
  const s = String(v).trim();
  const g = s.match(/^Date\((\d+),(\d+),(\d+)\)$/);
  if (g) return new Date(+g[1],+g[2],+g[3]);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) { const yr=+mdy[3]<100?2000+ +mdy[3]: +mdy[3]; return new Date(yr,+mdy[1]-1,+mdy[2]); }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1],+ymd[2]-1,+ymd[3]);
  return null;
}

function parseSheet(raw) {
  let json;
  try { json = JSON.parse(raw.replace(/^[^(]+\(/,'').replace(/\);?\s*$/,'')); } catch { return []; }
  return (json.table?.rows||[]).map((row,idx) => {
    const c = row.c||[];
    if (!c[0]||!c[1]||!c[2]) return null;
    const merchant = String(c[1]?.v||'').trim();
    if (!merchant) return null;
    const amount = Math.abs(parseFloat(c[2]?.v??0));
    if (isNaN(amount)||amount===0) return null;
    const method   = String(c[3]?.v||'').trim();
    const category = String(c[4]?.v||'Other').trim();
    const subCat   = String(c[5]?.v||'').trim();
    const dateObj  = parseGvizDate(c[0]?.v);
    const dateStr  = dateObj ? dateObj.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}) : String(c[0]?.v||'');
    const isIncome   = method==='Income';
    const isTransfer = method==='BofA'&&(merchant.toLowerCase()==='amex'||merchant.toLowerCase().includes('american express'));
    return {id:idx,date:dateStr,dateObj,merchant,amount,method,category,subCat,isIncome,isTransfer};
  }).filter(Boolean);
}

const isAmex  = t => t.method==='Amex';
const isBofa  = t => t.method==='BofA'&&!t.isTransfer;
const isRecur = t => RECURRING_KW.some(k=>t.merchant.toLowerCase().includes(k))||t.category==='Subscriptions';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#F0F4FA;font-family:'DM Sans',sans-serif;color:#1E293B;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:99px}
.card{background:#FFFFFF;border:1px solid #E8EDF5;border-radius:18px;transition:border-color 0.2s,box-shadow 0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
.card:hover{border-color:#D1DCF0;box-shadow:0 4px 16px rgba(0,0,0,0.07)}
.tab-btn{padding:15px 8px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;color:#64748B;transition:all 0.2s;white-space:nowrap}
.tab-btn.active{color:#3B82F6;border-bottom-color:#3B82F6;font-weight:700}
.tab-btn:hover:not(.active){color:#475569}
.inp{padding:9px 13px;border-radius:10px;border:1px solid #E2E8F0;background:#F8FAFC;font-family:'DM Sans',sans-serif;font-size:13px;color:#1E293B;outline:none;transition:border-color 0.2s,background 0.2s}
.inp:focus{border-color:#93C5FD;background:#fff}
.inp::placeholder{color:#94A3B8}
.inp option{background:#fff;color:#1E293B}
.btn-p{padding:9px 18px;border-radius:10px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;background:linear-gradient(135deg,#3B82F6,#6366F1);color:#fff;box-shadow:0 4px 14px rgba(59,130,246,0.22);transition:opacity 0.2s,transform 0.1s}
.btn-p:hover{opacity:0.88;transform:translateY(-1px)}
.btn-g{padding:8px 14px;border-radius:10px;border:1px solid #E2E8F0;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;background:#F8FAFC;color:#64748B;transition:all 0.2s}
.btn-g:hover{border-color:#CBD5E1;color:#475569;background:#F1F5F9}
.btn-d{padding:5px 10px;border-radius:7px;border:none;cursor:pointer;font-size:11px;font-weight:600;background:#FEF2F2;color:#EF4444;transition:all 0.2s}
.btn-d:hover{background:#FEE2E2}
.mono{font-family:'DM Mono',monospace}
.sec-title{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;margin-bottom:16px}
.pbar{height:5px;border-radius:99px;background:#EFF6FF;overflow:hidden}
.pbar-fill{height:100%;border-radius:99px;transition:width 0.6s cubic-bezier(0.4,0,0.2,1)}
.tx-grid{display:grid;grid-template-columns:95px 1fr 90px 75px 130px 95px 1fr;align-items:center}
.tx-row{border-bottom:1px solid #F1F5F9;transition:background 0.12s}
.tx-row:hover{background:#F8FAFF}
.tx-row > div{padding:11px 14px;font-size:13px}
.tx-head > div{padding:9px 14px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94A3B8;cursor:pointer}
.modal-bg{position:fixed;inset:0;background:rgba(15,23,42,0.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:200}
.modal{background:#fff;border:1px solid #E2E8F0;border-radius:20px;padding:30px;width:460px;box-shadow:0 24px 60px rgba(0,0,0,0.12)}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.anim{animation:fadeUp 0.28s ease forwards}
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:9px 13px;border-radius:10px;background:#F8FAFC;border:1px solid #EEF2FF;margin-bottom:7px}
`;

function MB({method}) {
  const c={Amex:{bg:'#EEF2FF',color:'#4F46E5',b:'#C7D2FE'},BofA:{bg:'#FEF3C7',color:'#B45309',b:'#FDE68A'},Income:{bg:'#ECFDF5',color:'#065F46',b:'#A7F3D0'}}[method]||{bg:'#F1F5F9',color:'#64748B',b:'#E2E8F0'};
  return <span style={{display:'inline-block',padding:'3px 9px',borderRadius:99,fontSize:11,fontWeight:700,fontFamily:"'DM Mono',monospace",background:c.bg,color:c.color,border:`1px solid ${c.b}`}}>{method}</span>;
}

function CB({cat}) {
  const color = CAT_COLOR[cat]||'#94A3B8';
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:99,fontSize:11,fontWeight:600,background:color+'15',color,border:`1px solid ${color}25`}}><span style={{width:5,height:5,borderRadius:'50%',background:color}}/>{cat}</span>;
}

function NoteCell({txId,note,onSave}) {
  const [e,setE]=useState(false);const [v,setV]=useState(note);
  useEffect(()=>setV(note),[note]);
  if(e) return <div style={{display:'flex',gap:5}}><input className="inp" value={v} onChange={x=>setV(x.target.value)} onKeyDown={x=>{if(x.key==='Enter'){onSave(txId,v);setE(false);}if(x.key==='Escape')setE(false);}} style={{fontSize:12,padding:'4px 8px',width:140}} autoFocus/><button onClick={()=>{onSave(txId,v);setE(false);}} style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:6,color:'#2563EB',padding:'3px 8px',cursor:'pointer',fontSize:11}}>✓</button></div>;
  return <span onClick={()=>setE(true)} style={{fontSize:12,color:note?'#64748B':'#CBD5E1',cursor:'pointer',borderBottom:'1px dashed #E2E8F0',paddingBottom:1}}>{note||'+ note'}</span>;
}

function PBar({value,max,color='#60A5FA'}) {
  const p=max>0?Math.min(100,value/max*100):0;
  const c=p>=100?'#F87171':p>=80?'#FBBF24':color;
  return <div className="pbar"><div className="pbar-fill" style={{width:`${p}%`,background:c}}/></div>;
}

export default function App() {
  useEffect(()=>{const s=document.createElement('style');s.textContent=CSS;document.head.appendChild(s);return()=>document.head.removeChild(s);},[]);

  const [tab,setTab]=useState('overview');
  const [txns,setTxns]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refreshed,setRefreshed]=useState(null);
  const [periods,setPeriods]=useState([]);
  const [minBal,setMinBal]=useState(0);
  const [ovBudget,setOvBudget]=useState(null);
  const [catBudgets,setCatBudgets]=useState([]);
  const [notes,setNotes]=useState({});
  const [overviewNote,setOverviewNote]=useState('');
  const [savingNote,setSavingNote]=useState(false);
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [fCat,setFCat]=useState('All');
  const [fMethod,setFMethod]=useState('All');
  const [search,setSearch]=useState('');
  const [drillCat,setDrillCat]=useState(null);
  const [sortCol,setSortCol]=useState('date');
  const [sortDir,setSortDir]=useState('desc');
  const [page,setPage]=useState(1);
  const [showModal,setShowModal]=useState(false);
  const [editPeriod,setEditPeriod]=useState(null);
  const [pForm,setPForm]=useState({label:'',start_date:'',end_date:'',budget_amount:''});
  const [newBCat,setNewBCat]=useState('');
  const [newBAmt,setNewBAmt]=useState('');
  const [editOvB,setEditOvB]=useState(false);
  const [ovBInput,setOvBInput]=useState('');
  const [editMinB,setEditMinB]=useState(false);
  const [minBInput,setMinBInput]=useState('');

  const refresh = useCallback(async()=>{
    setLoading(true);setError('');
    try{const r=await fetch(SHEET_URL);const t=await r.text();setTxns(parseSheet(t));setRefreshed(new Date());}
    catch{setError('Cannot load sheet. Ensure it is set to "Anyone with link can view".');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{
    refresh();
    (async()=>{
      const [p,s,ob,cb,n,on]=await Promise.all([loadPayPeriods(),loadBofaSettings(),loadOverallBudget(),loadCategoryBudgets(),loadTransactionNotes(),loadOverviewNote()]);
      setPeriods(p);if(s?.minimum_balance!=null)setMinBal(s.minimum_balance);setOvBudget(ob);setCatBudgets(cb);setNotes(n);setOverviewNote(on||'');
    })();
  },[]);

  const incomes   = useMemo(()=>txns.filter(t=>t.isIncome),[txns]);
  const transfers = useMemo(()=>txns.filter(t=>t.isTransfer),[txns]);
  const expenses  = useMemo(()=>txns.filter(t=>!t.isIncome&&!t.isTransfer),[txns]);
  const totalIncome     = useMemo(()=>incomes.reduce((s,t)=>s+t.amount,0),[incomes]);
  const totalBofaDirect = useMemo(()=>expenses.filter(isBofa).reduce((s,t)=>s+t.amount,0),[expenses]);
  const totalPaidAmex   = useMemo(()=>transfers.reduce((s,t)=>s+t.amount,0),[transfers]);
  const totalAmexCharged= useMemo(()=>expenses.filter(isAmex).reduce((s,t)=>s+t.amount,0),[expenses]);
  const outstandingAmex = useMemo(()=>Math.max(0,totalAmexCharged-totalPaidAmex),[totalAmexCharged,totalPaidAmex]);
  const bofaBalance     = useMemo(()=>minBal+totalIncome-totalBofaDirect-totalPaidAmex,[minBal,totalIncome,totalBofaDirect,totalPaidAmex]);

  const dateFilt = useMemo(()=>{
    let t=expenses;
    if(dateFrom){const d=toLocalDate(dateFrom);if(d)t=t.filter(x=>x.dateObj&&x.dateObj>=d);}
    if(dateTo){const d=toLocalDate(dateTo);if(d){const e=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59);t=t.filter(x=>x.dateObj&&x.dateObj<=e);}}
    return t;
  },[expenses,dateFrom,dateTo]);

  const filtered = useMemo(()=>{
    let t=drillCat?dateFilt.filter(x=>x.category===drillCat):dateFilt;
    if(fCat!=='All')t=t.filter(x=>x.category===fCat);
    if(fMethod!=='All')t=t.filter(x=>x.method===fMethod);
    if(search)t=t.filter(x=>x.merchant.toLowerCase().includes(search.toLowerCase())||(notes[x.id]||'').toLowerCase().includes(search.toLowerCase()));
    return t;
  },[dateFilt,drillCat,fCat,fMethod,search,notes]);

  const sorted = useMemo(()=>[...filtered].sort((a,b)=>{
    if(sortCol==='date'){const da=a.dateObj||new Date(0),db=b.dateObj||new Date(0);return sortDir==='asc'?da-db:db-da;}
    if(sortCol==='amount')return sortDir==='asc'?a.amount-b.amount:b.amount-a.amount;
    return sortDir==='asc'?(a[sortCol]||'').localeCompare(b[sortCol]||''):(b[sortCol]||'').localeCompare(a[sortCol]||'');
  }),[filtered,sortCol,sortDir]);

  const PAGE=25;
  const paged      = useMemo(()=>sorted.slice(PAGE*(page-1),PAGE*page),[sorted,page]);
  const totalPages = Math.ceil(sorted.length/PAGE);
  const totalSpend = useMemo(()=>sorted.reduce((s,t)=>s+t.amount,0),[sorted]);
  const totalFilt  = useMemo(()=>dateFilt.reduce((s,t)=>s+t.amount,0),[dateFilt]);

  const enriched = useMemo(()=>periods.map(p=>{
    const start=toLocalDate(p.start_date);
    const endRaw=toLocalDate(p.end_date);
    if(!start||!endRaw)return{...p,bofaSpend:0,amexSpend:0,total:0,saved:0,days:0,daysPassed:0,isCurrent:false};
    const end=new Date(endRaw.getFullYear(),endRaw.getMonth(),endRaw.getDate(),23,59,59);
    const pT=expenses.filter(t=>t.dateObj&&t.dateObj>=start&&t.dateObj<=end);
    const bofaSpend=pT.filter(isBofa).reduce((s,t)=>s+t.amount,0);
    const amexSpend=pT.filter(isAmex).reduce((s,t)=>s+t.amount,0);
    const total=bofaSpend+amexSpend,budget=p.budget_amount||0,saved=budget-total;
    const days=Math.max(1,Math.ceil((end-start)/86400000));
    const now=new Date(),daysPassed=Math.min(Math.max(0,Math.ceil((now-start)/86400000)),days);
    const isCurrent=now>=start&&now<=end;
    return{...p,start,end,bofaSpend,amexSpend,total,budget,saved,days,daysPassed,isCurrent};
  }),[periods,expenses]);

  const currentP = useMemo(()=>enriched.find(p=>p.isCurrent)||enriched[0]||null,[enriched]);

  const catData   = useMemo(()=>{const m={};dateFilt.forEach(t=>{m[t.category]=(m[t.category]||0)+t.amount;});return Object.entries(m).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);},[dateFilt]);
  const recurring = useMemo(()=>dateFilt.filter(isRecur),[dateFilt]);

  const savePer    = async()=>{if(!pForm.start_date||!pForm.end_date||!pForm.budget_amount)return;const sv=await savePayPeriod({...editPeriod,...pForm,budget_amount:parseFloat(pForm.budget_amount)});setPeriods(prev=>{const ex=prev.find(p=>p.id===sv.id);return ex?prev.map(p=>p.id===sv.id?sv:p):[sv,...prev];});setShowModal(false);setEditPeriod(null);setPForm({label:'',start_date:'',end_date:'',budget_amount:''});};
  const delPer     = async id=>{await deletePayPeriod(id);setPeriods(prev=>prev.filter(p=>p.id!==id));};
  const saveMinBal = async()=>{const v=parseFloat(minBInput)||0;setMinBal(v);await saveBofaSettings(v);setEditMinB(false);};
  const saveOvB    = async()=>{const v=parseFloat(ovBInput)||null;setOvBudget(v);if(v)await saveOverallBudget(v);setEditOvB(false);};
  const addCatB    = async()=>{if(!newBCat||!newBAmt)return;const a=parseFloat(newBAmt);await saveCategoryBudget(newBCat,a);setCatBudgets(prev=>{const ex=prev.find(b=>b.category===newBCat);return ex?prev.map(b=>b.category===newBCat?{...b,amount:a}:b):[...prev,{category:newBCat,amount:a}];});setNewBCat('');setNewBAmt('');};
  const delCatB    = async cat=>{await deleteCategoryBudget(cat);setCatBudgets(prev=>prev.filter(b=>b.category!==cat));};
  const saveNote   = async(id,note)=>{setNotes(prev=>({...prev,[id]:note}));await saveTransactionNote(id,note);};
  const handleOverviewNote = async(val)=>{setOverviewNote(val);setSavingNote(true);clearTimeout(window._noteTimer);window._noteTimer=setTimeout(async()=>{await saveOverviewNote(val);setSavingNote(false);},800);};
  const handleSort = col=>{if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('desc');}setPage(1);};

  return (
    <div style={{minHeight:'100vh',background:'#F0F4FA'}}>
      {/* Topbar */}
      <div style={{background:'rgba(255,255,255,0.92)',borderBottom:'1px solid #E8EDF5',padding:'0 32px',display:'flex',alignItems:'center',gap:4,position:'sticky',top:0,zIndex:100,backdropFilter:'blur(20px)',boxShadow:'0 1px 8px rgba(0,0,0,0.06)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginRight:24,padding:'14px 0'}}>
          <div style={{width:30,height:30,borderRadius:9,background:'linear-gradient(135deg,#3B82F6,#6366F1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,boxShadow:'0 4px 12px rgba(99,102,241,0.35)'}}>💰</div>
          <span style={{fontSize:14,fontWeight:700,color:'#1E293B',letterSpacing:'-0.02em'}}>MyFinance</span>
        </div>
        {[['overview','Overview'],['tracker','Pay Periods']].map(([t,l])=>(
          <button key={t} className={`tab-btn${tab===t?' active':''}`} onClick={()=>setTab(t)}>{l}</button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
          {refreshed&&<span style={{fontSize:11,color:'#94A3B8',fontFamily:"'DM Mono',monospace"}}>{refreshed.toLocaleTimeString()}</span>}
          <button className="btn-g" onClick={refresh} disabled={loading} style={{fontSize:12,background:'#F1F5F9',color:'#64748B',border:'1px solid #F1F5F9'}}>{loading?'⟳ Loading':'↻ Refresh'}</button>
        </div>
      </div>

      {error&&<div style={{background:'rgba(239,68,68,0.08)',borderBottom:'1px solid rgba(239,68,68,0.15)',color:'#F87171',padding:'10px 32px',fontSize:13}}>{error}</div>}

      <div style={{padding:'28px 32px',maxWidth:1400,margin:'0 auto'}}>

        {/* ══ OVERVIEW ══ */}
        {tab==='overview'&&(
          <div className="anim" style={{display:'flex',flexDirection:'column',gap:20}}>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              {/* BofA card */}
              <div className="card" style={{padding:'28px 30px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:22}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:'#D97706',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:10}}>Bank of America</div>
                    <div className="mono" style={{fontSize:44,fontWeight:500,color:bofaBalance>=0?'#1E293B':'#DC2626',letterSpacing:'-0.03em',lineHeight:1}}>{fmt(bofaBalance)}</div>
                    <div style={{fontSize:12,color:'#94A3B8',marginTop:8}}>Calculated account balance</div>
                  </div>
                  <div style={{width:46,height:46,borderRadius:13,background:'#FEF3C7',border:'1px solid #FDE68A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>🏦</div>
                </div>
                <div>
                  {[['+','Total Income',totalIncome,'#34D399'],['−','Direct BofA Spend',totalBofaDirect,'#F87171'],['−','Paid to AMEX',totalPaidAmex,'#FBBF24'],['−','Min Balance Reserve',minBal,'#818CF8']].map(([sign,label,value,color])=>(
                    <div key={label} className="stat-row">
                      <span style={{fontSize:13,color:'#475569',display:'flex',alignItems:'center',gap:7}}><span style={{fontWeight:700,fontSize:14,color}}>{sign}</span>{label}</span>
                      <span className="mono" style={{fontSize:13,fontWeight:500,color}}>{fmt(value)}</span>
                    </div>
                  ))}
                </div>
                <div style={{paddingTop:14,borderTop:'1px solid #F1F5F9',marginTop:6}}>
                  {editMinB?(
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <span style={{fontSize:12,color:'#475569'}}>Min reserve:</span>
                      <input className="inp" value={minBInput} onChange={e=>setMinBInput(e.target.value)} type="number" style={{width:110}}/>
                      <button className="btn-p" onClick={saveMinBal} style={{padding:'7px 14px',fontSize:12}}>Save</button>
                      <button className="btn-g" onClick={()=>setEditMinB(false)}>Cancel</button>
                    </div>
                  ):(
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:12,color:'#64748B'}}>Min reserve: <span className="mono" style={{color:'#6366F1'}}>{fmt(minBal)}</span></span>
                      <button className="btn-g" onClick={()=>{setMinBInput(String(minBal));setEditMinB(true);}} style={{fontSize:11,padding:'5px 10px'}}>Edit</button>
                    </div>
                  )}
                </div>
              </div>

              {/* AMEX card */}
              <div className="card" style={{padding:'28px 30px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:22}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:'#6366F1',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:10}}>American Express</div>
                    <div className="mono" style={{fontSize:44,fontWeight:500,color:outstandingAmex>0?'#DC2626':'#059669',letterSpacing:'-0.03em',lineHeight:1}}>{fmt(outstandingAmex)}</div>
                    <div style={{fontSize:12,color:'#94A3B8',marginTop:8}}>Outstanding card balance</div>
                  </div>
                  <div style={{width:46,height:46,borderRadius:13,background:'#EEF2FF',border:'1px solid #C7D2FE',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>💳</div>
                </div>
                <div>
                  {[['−','Total AMEX Charged',totalAmexCharged,'#F87171'],['+','Paid from BofA',totalPaidAmex,'#34D399']].map(([sign,label,value,color])=>(
                    <div key={label} className="stat-row">
                      <span style={{fontSize:13,color:'#475569',display:'flex',alignItems:'center',gap:7}}><span style={{fontWeight:700,fontSize:14,color}}>{sign}</span>{label}</span>
                      <span className="mono" style={{fontSize:13,fontWeight:500,color}}>{fmt(value)}</span>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:14,padding:'12px 16px',borderRadius:12,background:outstandingAmex>0?'#FEF2F2':'#F0FDF4',border:`1px solid ${outstandingAmex>0?'#FECACA':'#BBF7D0'}`}}>
                  <span style={{fontSize:13,fontWeight:600,color:outstandingAmex>0?'#DC2626':'#059669'}}>{outstandingAmex>0?`⚠️  ${fmt(outstandingAmex)} still owed on AMEX`:'✅  AMEX fully paid off'}</span>
                </div>
              </div>
            </div>

            {/* Income list */}
            <div className="card" style={{padding:'24px 28px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div className="sec-title" style={{margin:0}}>Income Sources</div>
                <span className="mono" style={{fontSize:13,color:'#059669'}}>{fmt(totalIncome)} · {incomes.length} entries</span>
              </div>
              {incomes.length===0?(
                <div style={{color:'#94A3B8',fontSize:13,textAlign:'center',padding:'24px 0'}}>No income found. Add rows with Method = "Income" in your sheet.</div>
              ):(
                <>
                  {incomes.map(t=>(
                    <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',borderRadius:10,marginBottom:5,background:'#F8FAFC',border:'1px solid #EEF2FF'}}>
                      <div style={{display:'flex',alignItems:'center',gap:14}}>
                        <span className="mono" style={{fontSize:11,color:'#94A3B8',width:88}}>{t.date}</span>
                        <span style={{fontSize:13,fontWeight:500,color:'#1E293B'}}>{t.merchant}</span>
                      </div>
                      <span className="mono" style={{fontSize:14,fontWeight:500,color:'#059669'}}>{fmt(t.amount)}</span>
                    </div>
                  ))}
                  <div style={{display:'flex',justifyContent:'flex-end',padding:'10px 14px',borderTop:'1px solid #F1F5F9',marginTop:4}}>
                    <span className="mono" style={{fontSize:15,fontWeight:600,color:'#059669'}}>{fmt(totalIncome)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Overview Note */}
            <div className="card" style={{padding:'24px 28px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div className="sec-title" style={{margin:0}}>Notes</div>
                <span style={{fontSize:11,color:savingNote?'#D97706':'#94A3B8',transition:'color 0.3s'}}>{savingNote?'Saving…':'Auto-saved'}</span>
              </div>
              <textarea
                value={overviewNote}
                onChange={e=>handleOverviewNote(e.target.value)}
                placeholder="Add notes about your finances, goals, reminders…"
                style={{width:'100%',minHeight:120,background:'#F8FAFC',border:'1px solid #E2E8F0',borderRadius:12,padding:'14px 16px',fontSize:13,color:'#1E293B',fontFamily:"'DM Sans',sans-serif",resize:'vertical',outline:'none',lineHeight:1.6,transition:'border-color 0.2s'}}
                onFocus={e=>e.target.style.borderColor='#93C5FD'}
                onBlur={e=>e.target.style.borderColor='#E2E8F0'}
              />
            </div>
          </div>
        )}

        {/* ══ TRACKER ══ */}
        {tab==='tracker'&&(
          <div className="anim" style={{display:'flex',flexDirection:'column',gap:20}}>

            {/* Filter bar */}
            <div className="card" style={{padding:'13px 20px',position:'sticky',top:53,zIndex:90,display:'flex',flexWrap:'wrap',alignItems:'center',gap:10,boxShadow:'0 2px 8px rgba(0,0,0,0.05)'}}>
              <span style={{fontSize:10,fontWeight:700,color:'#94A3B8',letterSpacing:'0.09em',textTransform:'uppercase'}}>Range</span>
              <input type="date" className="inp" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}}/>
              <span style={{color:'#64748B',fontSize:13}}>→</span>
              <input type="date" className="inp" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}}/>
              {(dateFrom||dateTo)&&<button className="btn-g" onClick={()=>{setDateFrom('');setDateTo('');setPage(1);}}>✕</button>}
              {(dateFrom||dateTo)&&<span className="mono" style={{fontSize:12,color:'#3B82F6'}}>{sorted.length} txns · {fmt(totalSpend)}</span>}
              <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
                {ovBudget?(
                  <div style={{display:'flex',alignItems:'center',gap:9}}>
                    <span style={{fontSize:12,color:'#64748B'}}>Budget <span className="mono" style={{color:'#1E293B'}}>{fmt(ovBudget)}</span></span>
                    <div style={{width:80,height:4,borderRadius:99,background:'rgba(255,255,255,0.07)',overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${Math.min(100,totalFilt/ovBudget*100)}%`,background:totalFilt>ovBudget?'#F87171':totalFilt/ovBudget>0.8?'#FBBF24':'#34D399',borderRadius:99,transition:'width 0.5s'}}/>
                    </div>
                    <span className="mono" style={{fontSize:11,color:totalFilt>ovBudget?'#DC2626':'#059669'}}>{fmt(Math.abs(ovBudget-totalFilt))} {totalFilt>ovBudget?'over':'left'}</span>
                    <button className="btn-g" onClick={()=>{setOvBInput(String(ovBudget));setEditOvB(true);}} style={{fontSize:11,padding:'5px 9px'}}>Edit</button>
                  </div>
                ):editOvB?(
                  <div style={{display:'flex',gap:6}}>
                    <input className="inp" value={ovBInput} onChange={e=>setOvBInput(e.target.value)} type="number" placeholder="Overall budget $" style={{width:150}}/>
                    <button className="btn-p" onClick={saveOvB} style={{padding:'7px 14px',fontSize:12}}>Save</button>
                    <button className="btn-g" onClick={()=>setEditOvB(false)}>✕</button>
                  </div>
                ):(
                  <button className="btn-g" onClick={()=>setEditOvB(true)} style={{fontSize:12}}>+ Set Budget</button>
                )}
              </div>
            </div>

            {/* Current period */}
            <div style={{background:'linear-gradient(135deg,#EFF6FF 0%,#F0F7FF 60%,#EBF4FF 100%)',border:'1px solid #BFDBFE',borderRadius:20,padding:'28px 32px',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:-80,right:-80,width:240,height:240,borderRadius:'50%',background:'radial-gradient(circle,rgba(59,130,246,0.08) 0%,transparent 70%)',pointerEvents:'none'}}/>
              <div style={{position:'absolute',bottom:-40,left:-40,width:160,height:160,borderRadius:'50%',background:'radial-gradient(circle,rgba(99,102,241,0.05) 0%,transparent 70%)',pointerEvents:'none'}}/>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:currentP?26:0,position:'relative'}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:'#2563EB',marginBottom:8}}>Current Pay Period</div>
                  <div style={{fontSize:26,fontWeight:700,color:'#1E3A8A',letterSpacing:'-0.02em'}}>{currentP?(currentP.label||`${currentP.start_date} → ${currentP.end_date}`):'No active period'}</div>
                  {currentP&&<div style={{fontSize:12,color:'#60A5FA',marginTop:4}}>Day {currentP.daysPassed} of {currentP.days}</div>}
                </div>
                <div style={{display:'flex',gap:8}}>
                  {currentP&&<button className="btn-g" style={{borderColor:'#BFDBFE',color:'#3B82F6',background:'rgba(255,255,255,0.7)'}} onClick={()=>{setEditPeriod(currentP);setPForm({label:currentP.label||'',start_date:currentP.start_date,end_date:currentP.end_date,budget_amount:String(currentP.budget_amount)});setShowModal(true);}}>Edit</button>}
                  <button className="btn-p" onClick={()=>{setEditPeriod(null);setPForm({label:'',start_date:'',end_date:'',budget_amount:''});setShowModal(true);}}>+ New Period</button>
                </div>
              </div>
              {currentP&&(
                <>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:24,marginBottom:22,position:'relative'}}>
                    {[['Budget',currentP.budget,'#2563EB'],['BofA',currentP.bofaSpend,'#D97706'],['AMEX',currentP.amexSpend,'#7C3AED'],['Total Spent',currentP.total,'#DC2626'],[currentP.saved>=0?'Saved':'Over',Math.abs(currentP.saved),currentP.saved>=0?'#059669':'#DC2626']].map(([l,v,c])=>(
                      <div key={l}>
                        <div style={{fontSize:10,color:'#6B93C9',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:7}}>{l}</div>
                        <div className="mono" style={{fontSize:22,fontWeight:500,color:c}}>{fmt(v)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{position:'relative'}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6B93C9',marginBottom:6}}>
                      <span>{currentP.budget>0?Math.round(currentP.total/currentP.budget*100):0}% used</span>
                      <span>{currentP.days-currentP.daysPassed} days remaining</span>
                    </div>
                    <PBar value={currentP.total} max={currentP.budget} color="#60A5FA"/>
                  </div>
                </>
              )}
            </div>

            {/* Charts */}
            <div style={{display:'grid',gridTemplateColumns:'1.6fr 1fr',gap:20}}>
              <div className="card" style={{padding:'24px 28px'}}>
                <div className="sec-title">Spend by Category</div>
                {catData.length>0?(
                  <div style={{display:'flex',gap:20,alignItems:'flex-start'}}>
                    <div style={{flexShrink:0}}>
                      <ResponsiveContainer width={155} height={155}>
                        <PieChart>
                          <Pie data={catData} cx="50%" cy="50%" outerRadius={72} innerRadius={42} dataKey="value" strokeWidth={0} onClick={d=>setDrillCat(prev=>prev===d.name?null:d.name)}>
                            {catData.map(d=><Cell key={d.name} fill={CAT_COLOR[d.name]||'#94A3B8'} opacity={drillCat&&drillCat!==d.name?0.18:1}/>)}
                          </Pie>
                          <Tooltip formatter={v=>[fmt(v),'Spend']} contentStyle={{background:'#fff',border:'1px solid #E2E8F0',borderRadius:8,fontSize:12,color:'#1E293B',boxShadow:'0 4px 12px rgba(0,0,0,0.08)'}}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{flex:1,display:'flex',flexDirection:'column',gap:4,maxHeight:175,overflowY:'auto'}}>
                      {catData.map(d=>(
                        <div key={d.name} onClick={()=>setDrillCat(prev=>prev===d.name?null:d.name)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 9px',borderRadius:8,cursor:'pointer',background:drillCat===d.name?'#EFF6FF':'transparent',opacity:drillCat&&drillCat!==d.name?0.25:1,transition:'all 0.15s'}}>
                          <span style={{display:'flex',alignItems:'center',gap:7,fontSize:13,color:'#475569'}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:CAT_COLOR[d.name]||'#94A3B8',flexShrink:0}}/>{d.name}
                          </span>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <span className="mono" style={{fontSize:12,color:'#1E293B'}}>{fmt(d.value)}</span>
                            <span className="mono" style={{fontSize:10,color:'#94A3B8',width:28,textAlign:'right'}}>{totalFilt>0?Math.round(d.value/totalFilt*100):0}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ):<div style={{color:'#94A3B8',fontSize:13,textAlign:'center',padding:'20px 0'}}>No data for selected range</div>}
                {drillCat&&<button className="btn-g" onClick={()=>setDrillCat(null)} style={{width:'100%',marginTop:10,fontSize:12}}>✕ Clear: {drillCat}</button>}
              </div>

              <div className="card" style={{padding:'24px 28px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div className="sec-title" style={{margin:0}}>Recurring</div>
                  <span className="mono" style={{fontSize:12,color:'#7C3AED'}}>{fmt(recurring.reduce((s,t)=>s+t.amount,0))}</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:210,overflowY:'auto'}}>
                  {recurring.length===0?<div style={{color:'#94A3B8',fontSize:13,textAlign:'center',padding:'20px 0'}}>None detected</div>:recurring.map(t=>(
                    <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:10,background:'#F5F3FF',border:'1px solid #DDD6FE'}}>
                      <div>
                        <div style={{fontSize:13,color:'#6D28D9',fontWeight:500}}>{t.merchant}</div>
                        <div className="mono" style={{fontSize:10,color:'#A78BFA'}}>{t.date}</div>
                      </div>
                      <span className="mono" style={{fontSize:13,color:'#6D28D9'}}>{fmt(t.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Period history */}
            <div className="card" style={{padding:'24px 28px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
                <div className="sec-title" style={{margin:0}}>Period History</div>
                <button className="btn-p" onClick={()=>{setEditPeriod(null);setPForm({label:'',start_date:'',end_date:'',budget_amount:''});setShowModal(true);}}>+ New Period</button>
              </div>
              {enriched.length===0?<div style={{color:'#94A3B8',fontSize:13,textAlign:'center',padding:'32px 0'}}>No periods yet. Create your first.</div>:(
                <div style={{overflowX:'auto'}}>
                  <div style={{minWidth:820}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 100px 110px 110px 110px 120px 80px 120px',padding:'0 14px',marginBottom:6}}>
                      {['Period','Budget','BofA','AMEX','Total','Saved/Over','Rate',''].map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:'#94A3B8',letterSpacing:'0.08em',textTransform:'uppercase',padding:'5px 8px'}}>{h}</div>)}
                    </div>
                    {enriched.map(p=>(
                      <div key={p.id} style={{display:'grid',gridTemplateColumns:'1fr 100px 110px 110px 110px 120px 80px 120px',padding:'3px 0',borderRadius:12,background:p.isCurrent?'#EFF6FF':'transparent',border:p.isCurrent?'1px solid #BFDBFE':'1px solid transparent',marginBottom:4}}>
                        <div style={{padding:'10px 22px',display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:13,fontWeight:p.isCurrent?700:400,color:p.isCurrent?'#1D4ED8':'#475569'}}>{p.label||`${p.start_date} → ${p.end_date}`}</span>
                          {p.isCurrent&&<span style={{display:'inline-block',padding:'1px 7px',borderRadius:99,fontSize:9,fontWeight:800,letterSpacing:'0.08em',textTransform:'uppercase',background:'#DBEAFE',color:'#2563EB'}}>NOW</span>}
                        </div>
                        {[[p.budget,'#64748B'],[p.bofaSpend,'#D97706'],[p.amexSpend,'#7C3AED'],[p.total,'#1E293B']].map(([v,c],i)=>(
                          <div key={i} style={{padding:'10px 8px',display:'flex',alignItems:'center'}}><span className="mono" style={{fontSize:13,color:c}}>{fmt(v)}</span></div>
                        ))}
                        <div style={{padding:'10px 8px',display:'flex',alignItems:'center'}}><span className="mono" style={{fontSize:13,fontWeight:600,color:p.saved>=0?'#059669':'#DC2626'}}>{p.saved>=0?'+':''}{fmt(p.saved)}</span></div>
                        <div style={{padding:'10px 8px',display:'flex',alignItems:'center',gap:5}}>
                          <span className="mono" style={{color:p.saved>=0?'#059669':'#DC2626',fontSize:13}}>{p.budget>0?`${Math.abs(Math.round((1-p.total/p.budget)*100))}%`:'—'}</span>
                          <span>{p.saved>=0?'✅':'❌'}</span>
                        </div>
                        <div style={{padding:'10px 8px',display:'flex',alignItems:'center',gap:6}}>
                          <button className="btn-g" style={{fontSize:11,padding:'4px 10px'}} onClick={()=>{setEditPeriod(p);setPForm({label:p.label||'',start_date:p.start_date,end_date:p.end_date,budget_amount:String(p.budget_amount)});setShowModal(true);}}>Edit</button>
                          <button className="btn-d" onClick={()=>delPer(p.id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Savings trend */}
            {enriched.length>0&&(
              <div className="card" style={{padding:'24px 28px'}}>
                <div className="sec-title">Savings Trend</div>
                {enriched.map(p=>(
                  <div key={p.id} style={{marginBottom:14}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                      <span style={{color:'#475569'}}>{p.label||`${p.start_date} → ${p.end_date}`}</span>
                      <span className="mono" style={{fontSize:12,color:p.saved>=0?'#059669':'#DC2626'}}>{p.saved>=0?'↑ ':' ↓ '}{fmt(Math.abs(p.saved))}</span>
                    </div>
                    <PBar value={p.total} max={p.budget} color="#60A5FA"/>
                  </div>
                ))}
              </div>
            )}

            {/* Category budgets */}
            <div className="card" style={{padding:'24px 28px'}}>
              <div className="sec-title">Category Budgets</div>
              <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
                <select className="inp" value={newBCat} onChange={e=>setNewBCat(e.target.value)}>
                  <option value="">Select category…</option>
                  {CATEGORIES.filter(c=>!catBudgets.find(b=>b.category===c)).map(c=><option key={c}>{c}</option>)}
                </select>
                <input className="inp" type="number" placeholder="$ amount" value={newBAmt} onChange={e=>setNewBAmt(e.target.value)} style={{width:120}}/>
                <button className="btn-p" onClick={addCatB}>+ Add</button>
              </div>
              {catBudgets.length>0&&(
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  {catBudgets.map(b=>{
                    const spent=dateFilt.filter(t=>t.category===b.category).reduce((s,t)=>s+t.amount,0);
                    const pct=b.amount>0?Math.min(100,spent/b.amount*100):0;
                    const col=pct>=100?'#F87171':pct>=80?'#FBBF24':'#60A5FA';
                    return(
                      <div key={b.category}>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:CAT_COLOR[b.category]||'#94A3B8'}}/>
                            <span style={{color:'#1E293B',fontWeight:500}}>{b.category}</span>
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <span className="mono" style={{fontSize:12,color:col}}>{fmt(spent)}</span>
                            <span className="mono" style={{color:'#94A3B8',fontSize:12}}>/ {fmt(b.amount)}</span>
                            <button className="btn-d" style={{padding:'2px 8px',fontSize:11}} onClick={()=>delCatB(b.category)}>✕</button>
                          </div>
                        </div>
                        <PBar value={spent} max={b.amount} color="#60A5FA"/>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tx filters */}
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              <div style={{position:'relative',flex:1,minWidth:220}}>
                <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#94A3B8',fontSize:13,pointerEvents:'none'}}>🔍</span>
                <input className="inp" placeholder="Search merchant or note…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{width:'100%',paddingLeft:34}}/>
              </div>
              <select className="inp" value={fCat} onChange={e=>{setFCat(e.target.value);setPage(1);}}>
                <option value="All">All Categories</option>
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
              <select className="inp" value={fMethod} onChange={e=>{setFMethod(e.target.value);setPage(1);}}>
                <option value="All">All Methods</option>
                <option>Amex</option><option>BofA</option>
              </select>
              {(search||fCat!=='All'||fMethod!=='All'||drillCat)&&<button className="btn-g" onClick={()=>{setSearch('');setFCat('All');setFMethod('All');setDrillCat(null);setPage(1);}}>✕ Clear all</button>}
              <span className="mono" style={{fontSize:11,color:'#94A3B8',marginLeft:'auto'}}>{sorted.length} txns · {fmt(totalSpend)}</span>
            </div>

            {drillCat&&(
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:10}}>
                <span style={{fontSize:13,color:'#2563EB'}}>Category: <strong>{drillCat}</strong></span>
                <button className="btn-g" onClick={()=>setDrillCat(null)} style={{padding:'3px 9px',fontSize:11}}>✕</button>
              </div>
            )}

            {/* Transactions */}
            <div className="card" style={{overflow:'hidden',padding:0}}>
              <div style={{overflowX:'auto'}}>
                <div className="tx-grid tx-head" style={{background:'rgba(255,255,255,0.02)',borderRadius:'18px 18px 0 0'}}>
                  {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCat','Sub Cat'],['note','Note']].map(([col,label])=>(
                    <div key={col} onClick={()=>col!=='note'&&handleSort(col)} style={{cursor:col!=='note'?'pointer':'default'}}>
                      {label}{sortCol===col?(sortDir==='asc'?' ↑':' ↓'):''}
                    </div>
                  ))}
                </div>
                {paged.length===0?(
                  <div style={{padding:'40px 20px',textAlign:'center',color:'#64748B',fontSize:13}}>No transactions match your filters</div>
                ):paged.map(t=>{
                  const amt=t.amount;
                  const bg=isRecur(t)?'rgba(167,139,250,0.035)':amt>=80?'rgba(239,68,68,0.035)':amt>=40?'rgba(251,191,36,0.025)':'transparent';
                  const ac=amt>=80?'#DC2626':amt>=40?'#D97706':'#1E293B';
                  return(
                    <div key={t.id} className="tx-grid tx-row" style={{background:bg}}>
                      <div style={{color:'#94A3B8',fontSize:11,fontFamily:"'DM Mono',monospace"}}>{t.date}</div>
                      <div style={{color:'#1E293B',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {t.merchant}{isRecur(t)&&<span style={{marginLeft:6,fontSize:10,color:'#7C3AED'}}>↻</span>}
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:ac}}>{fmt(amt)}</div>
                      <div><MB method={t.method}/></div>
                      <div><CB cat={t.category}/></div>
                      <div style={{fontSize:11,color:'#94A3B8'}}>{t.subCat}</div>
                      <div><NoteCell txId={t.id} note={notes[t.id]||''} onSave={saveNote}/></div>
                    </div>
                  );
                })}
              </div>
              {totalPages>1&&(
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:12,padding:'14px 20px',borderTop:'1px solid #F1F5F9'}}>
                  <button className="btn-g" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>← Prev</button>
                  <span className="mono" style={{fontSize:12,color:'#94A3B8'}}>Page {page} / {totalPages}</span>
                  <button className="btn-g" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next →</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal&&(
        <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget){setShowModal(false);setEditPeriod(null);}}}>
          <div className="modal anim">
            <div style={{fontSize:17,fontWeight:700,color:'#1E293B',marginBottom:22,letterSpacing:'-0.01em'}}>{editPeriod?'Edit Pay Period':'New Pay Period'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:10,color:'#94A3B8',display:'block',marginBottom:6,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em'}}>Label (optional)</label>
                <input className="inp" value={pForm.label} onChange={e=>setPForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Apr 15 – Apr 30" style={{width:'100%'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[['Start Date','start_date'],['End Date','end_date']].map(([l,k])=>(
                  <div key={k}>
                    <label style={{fontSize:10,color:'#94A3B8',display:'block',marginBottom:6,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em'}}>{l}</label>
                    <input type="date" className="inp" value={pForm[k]} onChange={e=>setPForm(f=>({...f,[k]:e.target.value}))} style={{width:'100%'}}/>
                  </div>
                ))}
              </div>
              <div>
                <label style={{fontSize:10,color:'#94A3B8',display:'block',marginBottom:6,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em'}}>Budget Amount</label>
                <input type="number" className="inp" value={pForm.budget_amount} onChange={e=>setPForm(f=>({...f,budget_amount:e.target.value}))} placeholder="e.g. 3200" style={{width:'100%'}}/>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:24}}>
              <button className="btn-g" onClick={()=>{setShowModal(false);setEditPeriod(null);}}>Cancel</button>
              <button className="btn-p" onClick={savePer}>Save Period</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
