import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ynwkzmqsqicdagensftx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlud2t6bXFzcWljZGFnZW5zZnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNDE4NTksImV4cCI6MjA5MjkxNzg1OX0.bL-xDxQcPfJt22NIBQ7foy8uVg03uIMGx6Y7JOINGOk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Supabase helpers ───────────────────────────────────────────────────────
export async function loadPayPeriods() {
  const { data } = await supabase.from('pay_periods').select('*').order('start_date', { ascending: false });
  return data || [];
}
export async function savePayPeriod(period) {
  const { data, error } = await supabase.from('pay_periods').upsert(period, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
}
export async function deletePayPeriod(id) {
  await supabase.from('pay_periods').delete().eq('id', id);
}
export async function loadBofaSettings() {
  const { data } = await supabase.from('bofa_settings').select('*').single();
  return data;
}
export async function saveBofaSettings(settings) {
  await supabase.from('bofa_settings').upsert({ id: 1, ...settings });
}
export async function loadOverallBudget() {
  const { data } = await supabase.from('overall_budget').select('*').single();
  return data?.amount || null;
}
export async function saveOverallBudget(amount) {
  await supabase.from('overall_budget').upsert({ id: 1, amount });
}
export async function loadCategoryBudgets() {
  const { data } = await supabase.from('category_budgets').select('*');
  return data || [];
}
export async function saveCategoryBudget(category, amount) {
  await supabase.from('category_budgets').upsert({ category, amount }, { onConflict: 'category' });
}
export async function deleteCategoryBudget(category) {
  await supabase.from('category_budgets').delete().eq('category', category);
}
export async function loadTransactionNotes() {
  const { data } = await supabase.from('transaction_notes').select('*');
  const map = {};
  (data || []).forEach(r => { map[r.transaction_id] = r.note; });
  return map;
}
export async function saveTransactionNote(transactionId, note) {
  await supabase.from('transaction_notes').upsert({ transaction_id: transactionId, note }, { onConflict: 'transaction_id' });
}
