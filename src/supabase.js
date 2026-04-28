import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ynwkzmqsqicdagensftx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlud2t6bXFzcWljZGFnZW5zZnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNDE4NTksImV4cCI6MjA5MjkxNzg1OX0.bL-xDxQcPfJt22NIBQ7foy8uVg03uIMGx6Y7JOINGOk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Generic helpers ───────────────────────────────────────────────────────────

export async function getPref(key, fallback = '') {
  const { data } = await supabase.from('ui_preferences').select('value').eq('key', key).single();
  return data ? data.value : fallback;
}

export async function setPref(key, value) {
  await supabase.from('ui_preferences').upsert({ key, value: String(value) }, { onConflict: 'key' });
}

export async function getBofaSettings() {
  const { data } = await supabase.from('bofa_settings').select('*').limit(1).single();
  return data || { minimum_balance: 0 };
}

export async function setBofaMinBalance(amount) {
  const { data } = await supabase.from('bofa_settings').select('id').limit(1).single();
  if (data) {
    await supabase.from('bofa_settings').update({ minimum_balance: amount, updated_at: new Date() }).eq('id', data.id);
  } else {
    await supabase.from('bofa_settings').insert({ minimum_balance: amount });
  }
}

export async function getOverallBudget() {
  const { data } = await supabase.from('overall_budget').select('*').limit(1).single();
  return data ? data.amount : 0;
}

export async function setOverallBudget(amount) {
  const { data } = await supabase.from('overall_budget').select('id').limit(1).single();
  if (data) {
    await supabase.from('overall_budget').update({ amount, updated_at: new Date() }).eq('id', data.id);
  } else {
    await supabase.from('overall_budget').insert({ amount });
  }
}

export async function getCategoryBudgets() {
  const { data } = await supabase.from('category_budgets').select('*');
  return data || [];
}

export async function upsertCategoryBudget(category, amount) {
  await supabase.from('category_budgets').upsert({ category, amount }, { onConflict: 'category' });
}

export async function deleteCategoryBudget(category) {
  await supabase.from('category_budgets').delete().eq('category', category);
}

export async function getPayPeriods() {
  const { data } = await supabase.from('pay_periods').select('*').order('start_date', { ascending: false });
  return data || [];
}

export async function upsertPayPeriod(period) {
  if (period.id) {
    await supabase.from('pay_periods').update(period).eq('id', period.id);
  } else {
    await supabase.from('pay_periods').insert(period);
  }
}

export async function deletePayPeriod(id) {
  await supabase.from('pay_periods').delete().eq('id', id);
}

export async function getTransactionNotes() {
  const { data } = await supabase.from('transaction_notes').select('*');
  const map = {};
  (data || []).forEach(r => { map[r.transaction_id] = r.note; });
  return map;
}

export async function setTransactionNote(transactionId, note) {
  await supabase.from('transaction_notes').upsert(
    { transaction_id: transactionId, note, updated_at: new Date() },
    { onConflict: 'transaction_id' }
  );
}
