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
const DEFAULT_BUDGETS = {Groceries:400,Dining:300,Transport:150,Subscriptions:100,Shopping:200,Housing:2000,Health:100,Utilities:150,Travel:500,Education:500,Other:100};

const fmt = n => '$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const isRecurring = (merchant,cat) => cat==='Subscriptions'||RECURRING_KW.some(k=>merchant.toLowerCase().includes(k));

function parseDate(v) {
  if (!v) return null;
  if (typeof v === 'string') { const d=new Date(v); return isNaN(d)?null:d; }
  const m = String(v).match(/Date\((\d+),(\d+),(\d+)\)/);
  if (m) return new Date(+m[1],+m[2],+m[3]);
  const d=new Date(v); return isNaN(d)?null:d;
}

function parseSheetData(raw) {
  const json = JSON.parse(raw.replace(/^[^(]+\(/,'').replace(/\);?\s*$/,''));
  return (json.table.rows||[]).map((r,idx)=>{
    const c=r.c; if(!c||!c[0]||!c[2]) return null;
    const merchant=(c[1]?.v||'').trim();
    const rawAmt=parseFloat(c[2]?.v);
    if(isNaN(rawAmt)||!merchant) return null;
    const method=(c[3]?.v||'').trim();
    const category=(c[4]?.v||'Other').trim();
    const subCategory=(c[5]?.v||'').trim();
    const isIncome=method.toLowerCase().includes('income');
    const amount=isIncome?Math.abs(rawAmt):-Math.abs(rawAmt);
    const dateObj=parseDate(c[0]?.v);
    const date=dateObj?dateObj.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}):(c[0]?.v||'');
    return {id:idx,date,dateObj,merchant,amount,method,category,subCategory,isIncome};
  }).filter(Boolean);
}

const sow = d=>{const r=new Date(d);r.setDate(r.getDate()-r.getDay());r.setHours(0,0,0,0);return r;};
const eow = d=>{const r=new Date(d);r.setDate(r.getDate()+(6-r.getDay()));r.setHours(23,59,59,999);return r;};

function StatCard({label,value,sub,color}){
  return(
    <div style={{background:'#fff',borderRadius:12,padding:'14px 18px',border:'0.5px solid #e2e8f0'}}>
      <div style={{fontSize:12,color:'#64748b',marginBottom:5}}>{label}</div>
      <div style={{fontSize:20,fontWeight:600,color:color||'#0f172a'}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

function DonutChart({data,title,subtitle,onSegmentClick,activeCat,colorMap}){
  const total=data.reduce((s,d)=>s+d.value,0);
  return(
    <div style={{background:'#fff',borderRadius:12,border:'0.5px solid #e2e8f0',padding:'16px 20px'}}>
      <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:2}}>{title}</div>
      {subtitle&&<div style={{fontSize:11,color:'#94a3b8',marginBottom:10}}>{subtitle}</div>}
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:160,height:160,flexShrink:0}}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={70}
                dataKey="value" paddingAngle={2}
                onClick={onSegmentClick?(_,i)=>onSegmentClick(data[i].name):undefined}>
                {data.map(d=>(
                  <Cell key={d.name} fill={colorMap[d.name]||'#888'}
                    opacity={activeCat&&activeCat!==d.name?0.25:1}
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
            <div key={d.name} onClick={onSegmentClick?()=>onSegmentClick(d.name):undefined}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:12,
                cursor:onSegmentClick?'pointer':'default',
                opacity:activeCat&&activeCat!==d.name?0.35:1}}>
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

export default function App(){
  const [allTxns,setAllTxns]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [lastRefresh,setLastRefresh]=useState(null);
  const [filterCat,setFilterCat]=useState('All');
  const [filterMethod,setFilterMethod]=useState('All');
  const [search,setSearch]=useState('');
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [sortCol,setSortCol]=useState('date');
  const [sortDir,setSortDir]=useState('desc');
  const [page,setPage]=useState(1);
  const [drillCat,setDrillCat]=useState(null);
  const [budgets,setBudgets]=useState(DEFAULT_BUDGETS);
  const [editingBudget,setEditingBudget]=useState(null);
  const [budgetInput,setBudgetInput]=useState('');
  const PER_PAGE=20;

  const fetchData=async()=>{
    setLoading(true);setError('');
    try{
      const res=await fetch(API_URL);
      const text=await res.text();
      setAllTxns(parseSheetData(text));
      setLastRefresh(new Date());
    }catch{
      setError('Could not load data. Make sure your Google Sheet is set to "Anyone with the link can view".');
    }finally{setLoading(false);}
  };
  useEffect(()=>{fetchData();},[]);

  const expenses=useMemo(()=>allTxns.filter(t=>!t.isIncome),[allTxns]);
  const income=useMemo(()=>allTxns.filter(t=>t.isIncome),[allTxns]);

  const filtered=useMemo(()=>{
    let list=drillCat?expenses.filter(t=>t.category===drillCat):expenses;
    if(filterCat!=='All') list=list.filter(t=>t.category===filterCat);
    if(filterMethod!=='All') list=list.filter(t=>t.method===filterMethod);
    if(search) list=list.filter(t=>t.merchant.toLowerCase().includes(search.toLowerCase())||t.category.toLowerCase().includes(search.toLowerCase()));
    if(dateFrom) list=list.filter(t=>t.dateObj&&t.dateObj>=new Date(dateFrom));
    if(dateTo) list=list.filter(t=>t.dateObj&&t.dateObj<=new Date(dateTo+'T23:59:59'));
    return list;
  },[expenses,drillCat,filterCat,filterMethod,search,dateFrom,dateTo]);

  const sorted=useMemo(()=>[...filtered].sort((a,b)=>{
    if(sortCol==='date'){const va=a.dateObj||new Date(0),vb=b.dateObj||new Date(0);return sortDir==='asc'?va-vb:vb-va;}
    if(sortCol==='amount'){const va=Math.abs(a.amount),vb=Math.abs(b.amount);return sortDir==='asc'?va-vb:vb-va;}
    const va=a[sortCol]||'',vb=b[sortCol]||'';
    return sortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va);
  }),[filtered,sortCol,sortDir]);

  const paged=sorted.slice((page-1)*PER_PAGE,page*PER_PAGE);
  const totalPages=Math.ceil(sorted.length/PER_PAGE);
  const totalSpend=expenses.reduce((s,t)=>s+Math.abs(t.amount),0);
  const totalIncome=income.reduce((s,t)=>s+t.amount,0);
  const filteredSpend=filtered.reduce((s,t)=>s+Math.abs(t.amount),0);

  const catData=useMemo(()=>{
    const m={};expenses.forEach(t=>{m[t.category]=(m[t.category]||0)+Math.abs(t.amount);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));
  },[expenses]);

  const methodData=useMemo(()=>{
    const m={};expenses.forEach(t=>{m[t.method]=(m[t.method]||0)+Math.abs(t.amount);});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));
  },[expenses]);

  const top3=catData.slice(0,3);
  const recurringTxns=useMemo(()=>expenses.filter(t=>isRecurring(t.merchant,t.category)),[expenses]);
  const recurringTotal=recurringTxns.reduce((s,t)=>s+Math.abs(t.amount),0);

  const now=new Date();
  const twS=sow(now),twE=eow(now);
  const lwS=new Date(twS);lwS.setDate(lwS.getDate()-7);
  const lwE=new Date(twE);lwE.setDate(lwE.getDate()-7);

  const weeklyComp=useMemo(()=>CATS.map(cat=>{
    const tw=expenses.filter(t=>t.category===cat&&t.dateObj>=twS&&t.dateObj<=twE).reduce((s,t)=>s+Math.abs(t.amount),0);
    const lw=expenses.filter(t=>t.category===cat&&t.dateObj>=lwS&&t.dateObj<=lwE).reduce((s,t)=>s+Math.abs(t.amount),0);
    const diff=tw-lw;
    const pct=lw>0?((diff/lw)*100):tw>0?100:0;
    return {cat,tw,lw,diff,pct};
  }).filter(x=>x.tw>0||x.lw>0),[expenses]);

  const budgetData=useMemo(()=>CATS.map(cat=>{
    const spent=expenses.filter(t=>t.category===cat).reduce((s,t)=>s+Math.abs(t.amount),0);
    const budget=budgets[cat]||0;
    const pct=budget>0?Math.min((spent/budget)*100,150):0;
    return {cat,spent,budget,pct,over:spent>budget&&budget>0};
  }),[expenses,budgets]);

  const flagBg=amt=>{const a=Math.abs(amt);if(a>=80)return'#FEE2E2';if(a>=40)return'#FEF9C3';return null;};
  const handleSort=col=>{if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('desc');}setPage(1);};
  const sortArrow=col=>sortCol===col?(sortDir==='asc'?'↑':'↓'):'';
  const clearAll=()=>{setFilterCat('All');setFilterMethod('All');setSearch('');setDateFrom('');setDateTo('');setDrillCat(null);setPage(1);};
  const handlePieDrill=name=>{setDrillCat(drillCat===name?null:name);setFilterCat('All');setPage(1);};

  const inp={padding:'7px 10px',borderRadius:8,border:'0.5px solid #e2e8f0',fontSize:13,background:'#fff',color:'#334155'};
  const card={background:'#fff',borderRadius:12,border:'0.5px solid #e2e8f0',padding:'16px 20px'};
  const th={padding:'10px 12px',borderBottom:'1px solid #e2e8f0',fontSize:11,fontWeight:600,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.05em',textAlign:'left',background:'#f8fafc',cursor:'pointer',whiteSpace:'nowrap'};
  const td={padding:'10px 12px',borderBottom:'0.5px solid #f1f5f9',fontSize:13,color:'#334155'};

  if(loading) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:16}}>
      <div style={{width:36,height:36,border:'3px solid #e2e8f0',borderTop:'3px solid #378ADD',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <div style={{color:'#64748b',fontSize:14}}>Loading your transactions...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if(error) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:12,padding:24}}>
      <div style={{fontSize:32}}>⚠</div>
      <div style={{color:'#dc2626',fontWeight:500,textAlign:'center',maxWidth:400}}>{error}</div>
      <button onClick={fetchData} style={{...inp,cursor:'pointer'}}>Try again</button>
    </div>
  );

  return(
    <div style={{minHeight:'100vh',background:'#f4f6fb',padding:'20px 16px',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'}}>
      <div style={{maxWidth:1140,margin:'0 auto'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:600,color:'#0f172a',margin:0}}>My Finance Dashboard</h1>
            <div style={{fontSize:12,color:'#94a3b8',marginTop:3}}>{allTxns.length} transactions · synced {lastRefresh?.toLocaleTimeString()}</div>
          </div>
          <button onClick={fetchData} style={{...inp,cursor:'pointer',fontWeight:500}}>↻ Refresh from Sheet</button>
        </div>

        {/* Stat Cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20}}>
          <StatCard label="Total spend" value={fmt(totalSpend)} sub={`${expenses.length} transactions`} color="#dc2626"/>
          <StatCard label="Total income" value={fmt(totalIncome)} sub={`${income.length} credits`} color="#16a34a"/>
          <StatCard label="Net balance" value={(totalIncome-totalSpend>=0?'+':'')+fmt(totalIncome-totalSpend)} sub="income minus spend" color={totalIncome-totalSpend>=0?'#16a34a':'#dc2626'}/>
          <StatCard label="Recurring spend" value={fmt(recurringTotal)} sub={`${recurringTxns.length} subscriptions`} color="#7F77DD"/>
          <StatCard label="Largest expense" value={fmt(expenses.length?Math.max(...expenses.map(t=>Math.abs(t.amount))):0)} sub="single transaction"/>
        </div>

        {/* Top 3 */}
        {top3.length>0&&(
          <div style={{...card,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:12}}>Top 3 categories eating your budget</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
              {top3.map((c,i)=>(
                <div key={c.name} onClick={()=>handlePieDrill(c.name)}
                  style={{background:'#f8fafc',borderRadius:8,padding:'12px 14px',borderLeft:`3px solid ${CAT_COLORS[c.name]||'#888'}`,cursor:'pointer'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                    <span style={{fontSize:15,fontWeight:700,color:'#94a3b8'}}>#{i+1}</span>
                    <span style={{fontSize:13,fontWeight:500,color:'#0f172a'}}>{c.name}</span>
                  </div>
                  <div style={{fontSize:20,fontWeight:600,color:CAT_COLORS[c.name]||'#334155'}}>{fmt(c.value)}</div>
                  <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{((c.value/totalSpend)*100).toFixed(1)}% of total spend · click to drill down</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Charts */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16,marginBottom:16}}>
          <DonutChart data={catData} title="Spend by category"
            subtitle="Click any segment to drill into those transactions"
            onSegmentClick={handlePieDrill} activeCat={drillCat} colorMap={CAT_COLORS}/>
          <DonutChart data={methodData} title="Spend by payment method"
            subtitle="Breakdown of how you're paying" colorMap={METHOD_COLORS}/>
        </div>

        {/* Drill-down active banner */}
        {drillCat&&(
          <div style={{background:'#eff6ff',borderRadius:10,padding:'10px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',border:'0.5px solid #bfdbfe'}}>
            <div>
              <span style={{fontSize:13,color:'#1e40af',fontWeight:500}}>Drill-down active: </span>
              <span style={{fontSize:13,color:'#1e40af'}}>{drillCat}</span>
              <span style={{fontSize:13,color:'#60a5fa',marginLeft:8}}>{fmt(filteredSpend)} · {filtered.length} transactions</span>
            </div>
            <button onClick={()=>{setDrillCat(null);setPage(1);}}
              style={{fontSize:13,color:'#dc2626',background:'none',border:'none',cursor:'pointer',fontWeight:500}}>
              ✕ Remove drill-down
            </button>
          </div>
        )}

        {/* Weekly Comparison */}
        {weeklyComp.length>0&&(
          <div style={{...card,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:12}}>This week vs last week</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(175px,1fr))',gap:10}}>
              {weeklyComp.map(w=>(
                <div key={w.cat} style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:12,color:'#64748b',marginBottom:4}}>{w.cat}</div>
                  <div style={{fontSize:16,fontWeight:600,color:'#0f172a'}}>{fmt(w.tw)}</div>
                  <div style={{display:'flex',alignItems:'center',gap:4,marginTop:3,flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:w.diff>0?'#dc2626':w.diff<0?'#16a34a':'#64748b',fontWeight:500}}>
                      {w.diff>0?'▲':w.diff<0?'▼':'–'} {fmt(Math.abs(w.diff))}
                    </span>
                    <span style={{fontSize:11,color:'#94a3b8'}}>({w.pct>0?'+':''}{w.pct.toFixed(0)}%)</span>
                  </div>
                  {w.lw>0&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Last week: {fmt(w.lw)}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Budget vs Actual */}
        <div style={{...card,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:3}}>Budget vs actual</div>
          <div style={{fontSize:11,color:'#94a3b8',marginBottom:14}}>Click any underlined budget number to edit it</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {budgetData.map(b=>(
              <div key={b.cat}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                  <div style={{display:'flex',alignItems:'center',gap:7}}>
                    <div style={{width:10,height:10,borderRadius:2,background:CAT_COLORS[b.cat]||'#888'}}/>
                    <span style={{fontSize:13,color:'#334155'}}>{b.cat}</span>
                    {b.over&&<span style={{fontSize:10,background:'#FEE2E2',color:'#991B1B',padding:'1px 7px',borderRadius:10,fontWeight:600}}>OVER</span>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
                    <span style={{color:b.over?'#dc2626':'#334155',fontWeight:500}}>{fmt(b.spent)}</span>
                    <span style={{color:'#94a3b8'}}>of</span>
                    {editingBudget===b.cat?(
                      <form onSubmit={e=>{e.preventDefault();setBudgets(p=>({...p,[b.cat]:parseFloat(budgetInput)||0}));setEditingBudget(null);}} style={{display:'flex',gap:4}}>
                        <input autoFocus value={budgetInput} onChange={e=>setBudgetInput(e.target.value)}
                          style={{width:72,padding:'2px 6px',borderRadius:6,border:'1px solid #378ADD',fontSize:12}}/>
                        <button type="submit" style={{fontSize:11,background:'#378ADD',color:'#fff',border:'none',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Save</button>
                        <button type="button" onClick={()=>setEditingBudget(null)} style={{fontSize:11,background:'#f1f5f9',border:'none',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>✕</button>
                      </form>
                    ):(
                      <span onClick={()=>{setEditingBudget(b.cat);setBudgetInput(String(b.budget));}}
                        style={{color:'#378ADD',cursor:'pointer',fontWeight:500,textDecoration:'underline dotted'}}>
                        {fmt(b.budget)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{height:8,background:'#f1f5f9',borderRadius:4,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:4,width:`${Math.min(b.pct,100)}%`,
                    background:b.pct>=100?'#dc2626':b.pct>=80?'#f59e0b':CAT_COLORS[b.cat]||'#888',
                    transition:'width 0.4s ease'}}/>
                </div>
                <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{b.pct.toFixed(0)}% of budget used{b.budget===0?' · no budget set':''}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recurring */}
        {recurringTxns.length>0&&(
          <div style={{...card,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:500,color:'#334155',marginBottom:3}}>Recurring charges & subscriptions</div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:12}}>Total: {fmt(recurringTotal)} · {recurringTxns.length} charges detected</div>
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

        {/* Filters */}
        <div style={{...card,marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:500,color:'#64748b',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.05em'}}>Filters</div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
            <input placeholder="Search merchant or category..." value={search}
              onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{...inp,flex:1,minWidth:180}}/>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:12,color:'#94a3b8'}}>From</span>
              <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}} style={inp}/>
              <span style={{fontSize:12,color:'#94a3b8'}}>To</span>
              <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}} style={inp}/>
            </div>
            <select value={filterCat} onChange={e=>{setFilterCat(e.target.value);setDrillCat(null);setPage(1);}} style={inp}>
              <option value="All">All categories</option>
              {CATS.map(c=><option key={c}>{c}</option>)}
            </select>
            <select value={filterMethod} onChange={e=>{setFilterMethod(e.target.value);setPage(1);}} style={inp}>
              {METHODS.map(m=><option key={m}>{m}</option>)}
            </select>
            {(filterCat!=='All'||filterMethod!=='All'||search||dateFrom||dateTo||drillCat)&&(
              <button onClick={clearAll} style={{...inp,color:'#dc2626',borderColor:'#fecaca',cursor:'pointer'}}>Clear all</button>
            )}
            <div style={{fontSize:12,color:'#94a3b8',marginLeft:'auto'}}>{filtered.length} transactions · {fmt(filteredSpend)}</div>
          </div>
        </div>

        {/* Table */}
        <div style={{...card,padding:0,overflow:'hidden',marginBottom:16}}>
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
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:640}}>
              <thead>
                <tr>
                  {[['date','Date'],['merchant','Merchant'],['amount','Amount'],['method','Method'],['category','Category'],['subCategory','Sub Category']].map(([col,label])=>(
                    <th key={col} style={th} onClick={()=>handleSort(col)}>{label} {sortArrow(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length===0
                  ?<tr><td colSpan={6} style={{...td,textAlign:'center',color:'#94a3b8',padding:32}}>No transactions found</td></tr>
                  :paged.map((t,i)=>{
                    const flag=flagBg(t.amount);
                    const rec=isRecurring(t.merchant,t.category);
                    const rowBg=flag||(rec?'#f0f4ff':i%2===1?'#f8fafc':'#fff');
                    return(
                      <tr key={t.id} style={{background:rowBg}}>
                        <td style={td}>{t.date}</td>
                        <td style={{...td,fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {rec&&<span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#7F77DD',marginRight:6,verticalAlign:'middle'}}/>}
                          {t.merchant}
                        </td>
                        <td style={{...td,textAlign:'right',fontWeight:600,color:flag==='#FEE2E2'?'#991B1B':flag==='#FEF9C3'?'#854D0E':'#dc2626'}}>
                          -{fmt(t.amount)}
                        </td>
                        <td style={td}>
                          <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,background:(METHOD_COLORS[t.method]||'#888')+'18',color:METHOD_COLORS[t.method]||'#475569',fontWeight:500}}>
                            {t.method||'—'}
                          </span>
                        </td>
                        <td style={td}>
                          <span style={{fontSize:11,padding:'2px 8px',borderRadius:20,background:(CAT_COLORS[t.category]||'#888')+'18',color:CAT_COLORS[t.category]||'#475569',fontWeight:500}}>
                            {t.category}
                          </span>
                        </td>
                        <td style={{...td,color:'#64748b',fontSize:12}}>{t.subCategory}</td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
          {totalPages>1&&(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'12px 16px',borderTop:'0.5px solid #f1f5f9'}}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{...inp,opacity:page===1?0.4:1,cursor:'pointer'}}>← Prev</button>
              <span style={{fontSize:13,color:'#64748b'}}>Page {page} of {totalPages}</span>
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                style={{...inp,opacity:page===totalPages?0.4:1,cursor:'pointer'}}>Next →</button>
            </div>
          )}
        </div>

        <div style={{textAlign:'center',fontSize:11,color:'#cbd5e1',paddingBottom:20}}>
          Live data from Google Sheets · Rish Finance Dashboard
        </div>
      </div>
    </div>
  );
}
