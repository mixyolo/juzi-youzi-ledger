const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 });
const STORAGE_KEY = 'juzi-youzi-ledger-v1';

const initialState = {
  version: 2,
  activeUser: null,
  budget: 0,
  expenses: [],
  incomes: [],
  savings: [],
  goals: []
};

const expenseCategories = [['☕', '咖啡'], ['🍱', '工作餐'], ['🍲', '双人晚餐'], ['🛒', '买菜'], ['🐱', '橘子柚子'], ['🚇', '公共交通'], ['🚕', '打车'], ['🎬', '电影演出'], ['🏠', '居家日用'], ['＋', '自定义']];
const incomeCategories = [['💼', '工资'], ['🎁', '奖金'], ['💰', '理财收益'], ['✨', '其他收入']];
const savingCategories = [['🚗', '买车计划'], ['🐾', '宠物计划'], ['❄️', '旅行计划'], ['🏠', '大件计划'], ['✨', '其他计划']];

let state = loadState();
let entryType = 'expense';
let selectedCategory = expenseCategories[0];
let lastEntry = null;
let undoTimer = null;
let ledgerFilter = 'all';
let identityPickerCloseable = false;
let pendingDeleteId = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || saved.version !== initialState.version) return clone(initialState);
    const next = { ...clone(initialState), ...saved };
    next.expenses = (saved.expenses || []).map(item => ({ ...item, payer: item.payer === 'vault' ? 'shared' : item.payer }));
    next.incomes = saved.incomes || clone(initialState.incomes);
    next.savings = saved.savings || clone(initialState.savings);
    next.goals = (saved.goals || clone(initialState.goals)).map(goal => ({ id: goal.id, name: goal.name, icon: goal.icon || '✨', target: goal.target, deadline: goal.deadline || '慢慢实现' }));
    return next;
  } catch { return clone(initialState); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function partyMeta(party) { return party === 'dai' ? { name: 'xiaodai', color: 'var(--blue)', soft: 'var(--blue-soft)' } : party === 'yang' ? { name: 'xiaoyang', color: 'var(--pink)', soft: 'var(--pink-soft)' } : { name: '共同账户', color: 'var(--orange)', soft: 'var(--orange-soft)' }; }
function goalSaved(goalId) { return state.savings.filter(item => Number(item.goalId) === Number(goalId)).reduce((sum, item) => sum + item.amount, 0); }
function ownerSaved(owner) { return state.savings.filter(item => item.owner === owner).reduce((sum, item) => sum + item.amount, 0); }

function renderLedger() {
  const list = document.querySelector('#ledger-list'); let day = '';
  const visible = ledgerFilter === 'all' ? state.expenses : state.expenses.filter(item => item.payer === ledgerFilter);
  list.innerHTML = visible.map(item => {
    const meta = partyMeta(item.payer); const heading = item.date !== day ? `<div class="ledger-day"><span>${item.date}</span><span>${item.date === '今天' ? '刚刚发生' : '生活存档'}</span></div>` : '';
    day = item.date;
    return `${heading}<article class="ledger-item" style="--owner-color:${meta.color};--owner-soft:${meta.soft}"><div class="ledger-icon">${item.icon}</div><div class="ledger-copy"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.category)} · ${meta.name}</p></div><div class="ledger-amount">${money.format(item.amount)}<small>${item.time}</small></div><button class="ledger-delete" type="button" data-delete-expense="${item.id}" aria-label="删除 ${escapeHtml(item.title)}" title="删除"><i data-lucide="trash-2"></i></button></article>`;
  }).join('') || '<p class="soft-note">这个筛选条件下还没有账目。</p>';
  if (window.lucide) window.lucide.createIcons();
}

function renderGoals() {
  const cards = state.goals.map(goal => {
    const dai = state.savings.filter(item => Number(item.goalId) === Number(goal.id) && item.owner === 'dai').reduce((sum, item) => sum + item.amount, 0);
    const yang = state.savings.filter(item => Number(item.goalId) === Number(goal.id) && item.owner === 'yang').reduce((sum, item) => sum + item.amount, 0);
    const current = dai + yang; const percent = Math.min(100, Math.round(current / goal.target * 100));
    return `<article class="goal-card"><div class="goal-card-head"><div><span class="goal-card-icon">${goal.icon}</span><h3>${escapeHtml(goal.name)}</h3><small>目标期限 ${goal.deadline}</small></div><b>${percent}%</b></div><div class="team-progress"><span class="dai-part" style="width:${Math.min(100, dai / goal.target * 100)}%"></span><span class="yang-part" style="width:${Math.min(100, yang / goal.target * 100)}%"></span></div><footer><span>${money.format(current)} / ${money.format(goal.target)}</span><button class="fund-goal" type="button" data-goal-id="${goal.id}">+ 记存钱</button></footer></article>`;
  }).join('');
  document.querySelector('#goal-cards').innerHTML = cards || '<div class="empty-goals"><span>✨</span><strong>还没有愿望目标</strong><p>先写下一个想一起实现的小愿望。</p><button class="outline-button" type="button" data-action="new-goal"><i data-lucide="plus"></i> 创建第一个目标</button></div>';
  const featured = state.goals[0];
  if (!featured) {
    document.querySelector('#featured-name').textContent = '还没有置顶目标';
    document.querySelector('#featured-current').textContent = money.format(0);
    document.querySelector('#featured-target').textContent = '未设置';
    document.querySelector('#featured-percent').textContent = '0%';
    document.querySelector('#featured-dai').textContent = money.format(0);
    document.querySelector('#featured-yang').textContent = money.format(0);
    document.querySelector('#featured-remaining').textContent = '先创建一个目标';
    document.querySelector('.goal-feature .dai-part').style.width = '0%';
    document.querySelector('.goal-feature .yang-part').style.width = '0%';
    return;
  }
  const featuredCurrent = goalSaved(featured.id);
  const featuredDai = state.savings.filter(item => Number(item.goalId) === Number(featured.id) && item.owner === 'dai').reduce((sum, item) => sum + item.amount, 0);
  const featuredYang = state.savings.filter(item => Number(item.goalId) === Number(featured.id) && item.owner === 'yang').reduce((sum, item) => sum + item.amount, 0);
  document.querySelector('#featured-name').textContent = `${featured.icon} ${featured.name}`;
  document.querySelector('#featured-current').textContent = money.format(featuredCurrent);
  document.querySelector('#featured-target').textContent = money.format(featured.target);
  document.querySelector('#featured-percent').textContent = `${Math.min(100, Math.round(featuredCurrent / featured.target * 100))}%`;
  document.querySelector('#featured-dai').textContent = money.format(featuredDai);
  document.querySelector('#featured-yang').textContent = money.format(featuredYang);
  document.querySelector('#featured-remaining').textContent = featuredCurrent >= featured.target ? '目标已达成' : `还差 ${money.format(featured.target - featuredCurrent)}`;
  document.querySelector('.goal-feature .dai-part').style.width = `${Math.min(100, featuredDai / featured.target * 100)}%`;
  document.querySelector('.goal-feature .yang-part').style.width = `${Math.min(100, featuredYang / featured.target * 100)}%`;
}

function renderReview() {
  const now = new Date();
  const monthExpenses = state.expenses.filter(item => { if (!item.createdAt) return true; const date = new Date(item.createdAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
  const daysRemaining = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const totals = monthExpenses.reduce((acc, item) => { acc.total += item.amount; if (item.payer === 'dai') acc.dai += item.amount; if (item.payer === 'yang') acc.yang += item.amount; return acc; }, { total: 0, dai: 0, yang: 0 });
  const total = totals.total; const monthPercent = state.budget > 0 ? Math.min(100, Math.round(total / state.budget * 100)) : 0; const daiShare = total ? Math.round(totals.dai / total * 100) : 0; const yangShare = total ? Math.round(totals.yang / total * 100) : 0;
  document.querySelector('#month-spent').textContent = money.format(total); document.querySelector('#budget-total').textContent = state.budget > 0 ? money.format(state.budget) : '未设置'; document.querySelector('#month-left').textContent = state.budget > 0 ? money.format(Math.max(0, state.budget - total)) : '先设预算'; document.querySelector('#daily-left').textContent = state.budget > 0 ? money.format(Math.max(0, (state.budget - total) / daysRemaining)) : '—'; document.querySelector('#budget-percent').textContent = monthPercent + '%'; document.querySelector('#budget-ring').style.setProperty('--progress', monthPercent + '%'); document.querySelector('#budget-title').textContent = state.budget > 0 ? '本月生活预算' : '先设一个月度预算'; document.querySelector('#budget-primary-label').textContent = state.budget > 0 ? '修改月度预算' : '设置月度预算';
  document.querySelector('#review-total').textContent = money.format(total); document.querySelector('#dai-spent').textContent = money.format(totals.dai); document.querySelector('#yang-spent').textContent = money.format(totals.yang); document.querySelector('#dai-share').textContent = daiShare + '%'; document.querySelector('#yang-share').textContent = yangShare + '%'; document.querySelector('#contribution-percent').textContent = (total ? 100 : 0) + '%'; document.querySelector('#contribution-ring').style.background = total ? 'conic-gradient(var(--blue) 0 ' + daiShare + '%, var(--pink) ' + daiShare + '% 100%)' : '#edf0ef';
  document.querySelector('#review-trend').innerHTML = total ? '<i data-lucide="heart-handshake"></i> 已有记录' : '<i data-lucide="sparkles"></i> 等待记录';
  const categoryTotals = {}; monthExpenses.forEach(item => { categoryTotals[item.category] = (categoryTotals[item.category] || 0) + item.amount; }); const rows = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).slice(0, 5); const max = rows[0] ? rows[0][1] : 1;
  document.querySelector('#category-bars').innerHTML = rows.length ? rows.map(([name, value], index) => '<div class="category-row"><span>' + escapeHtml(name) + '</span><div class="bar-track"><i style="width:' + (value / max * 100) + '%;--bar-color:' + ['#f5a623', '#65a98b', '#8794a1', '#fa6588', '#2a82e4'][index] + '"></i></div><b>' + money.format(value) + '</b></div>').join('') : '<p class="soft-note">记下几笔支出后，这里会出现真实分类排行。</p>';
  const today = state.expenses.filter(item => item.date === '今天'); document.querySelector('#today-count').textContent = today.length + ' 笔'; document.querySelector('#today-total').textContent = money.format(today.reduce((sum, item) => sum + item.amount, 0));
  const petTotal = monthExpenses.filter(item => item.category === '橘子柚子').reduce((sum, item) => sum + item.amount, 0); document.querySelector('#pet-total').textContent = money.format(petTotal); document.querySelector('#pet-share').textContent = total ? '占总支出 ' + Math.round(petTotal / total * 100) + '%' : '等待记录';
  const weekday = monthExpenses.filter(item => item.weekday === '工作日').reduce((sum, item) => sum + item.amount, 0); const weekend = monthExpenses.filter(item => item.weekday === '周末').reduce((sum, item) => sum + item.amount, 0); const rhythmMax = Math.max(weekday, weekend, 1); document.querySelector('#weekday-total').textContent = money.format(weekday); document.querySelector('#weekend-total').textContent = money.format(weekend); document.querySelector('#weekday-bar').style.height = (weekday / rhythmMax * 100) + '%'; document.querySelector('#weekend-bar').style.height = (weekend / rhythmMax * 100) + '%'; document.querySelector('#rhythm-note').textContent = total ? '随着记录变多，这里会帮你看见工作日和周末的生活节奏。' : '有了几笔记录后，这里会帮你看见生活节奏。';
}

function renderPlans() {
  document.querySelector('#dai-balance').textContent = money.format(ownerSaved('dai')); document.querySelector('#yang-balance').textContent = money.format(ownerSaved('yang')); document.querySelector('#vault-total').textContent = money.format(state.savings.reduce((sum, item) => sum + item.amount, 0));
  document.querySelector('#dai-plan-count').textContent = `${new Set(state.savings.filter(item => item.owner === 'dai' && item.goalId).map(item => item.goalId)).size} 个`;
  document.querySelector('#yang-plan-count').textContent = `${new Set(state.savings.filter(item => item.owner === 'yang' && item.goalId).map(item => item.goalId)).size} 个`;
}
function renderAll() { renderLedger(); renderGoals(); renderReview(); renderPlans(); }

function renderIdentity() {
  const active = state.activeUser;
  const meta = active === 'yang' ? { name: '我是小杨', sub: 'xiaoyang · 小杨粉', initial: '杨', other: '戴', otherClass: 'daidai', activeClass: 'yangyang' } : { name: '我是小戴', sub: 'xiaodai · 小戴蓝', initial: '戴', other: '杨', otherClass: 'yangyang', activeClass: 'daidai' };
  document.querySelector('#active-avatar').textContent = active ? meta.initial : '?'; document.querySelector('#active-avatar').className = 'avatar ' + (active ? meta.activeClass : '');
  document.querySelector('#other-avatar').textContent = active ? meta.other : '?'; document.querySelector('#other-avatar').className = 'avatar ' + (active ? meta.otherClass : '');
  document.querySelector('#active-identity-label').textContent = active ? meta.name : '先选择身份'; document.querySelector('#identity-status').textContent = active ? meta.sub + ' · 点击切换' : '点击选择身份';
  document.querySelector('#top-active-avatar').textContent = active ? meta.initial : '?'; document.querySelector('#top-active-avatar').className = 'avatar ' + (active ? meta.activeClass : ''); document.querySelector('#top-identity-label').textContent = active ? meta.initial + ' · ' + (active === 'dai' ? '小戴' : '小杨') : '选择身份';
  document.querySelector('#identity-onboarding').classList.toggle('is-hidden', Boolean(active));
  document.body.dataset.activeUser = active || '';
}
function chooseIdentity(identity) { state.activeUser = identity; saveState(); identityPickerCloseable = false; renderIdentity(); updateEntryUI(); }
function setupIdentity() {
  document.querySelectorAll('[data-identity]').forEach(button => button.addEventListener('click', () => chooseIdentity(button.dataset.identity)));
  document.querySelector('#identity-switch').addEventListener('click', () => { identityPickerCloseable = true; document.querySelector('#identity-onboarding').classList.remove('is-hidden'); });
  document.querySelector('#top-identity-switch').addEventListener('click', () => { identityPickerCloseable = true; document.querySelector('#identity-onboarding').classList.remove('is-hidden'); });
}

function categoriesFor(type) { return type === 'income' ? incomeCategories : type === 'saving' ? savingCategories : expenseCategories; }
function setupCategories() { document.querySelector('#category-picker').addEventListener('click', event => { const button = event.target.closest('.category-option'); if (!button) return; let category = categoriesFor(entryType)[Number(button.dataset.index)]; if (category[1] === '自定义') { const name = window.prompt('给这个分类起个名字'); if (!name?.trim()) return; category = ['✨', name.trim().slice(0, 12)]; } selectedCategory = category; document.querySelectorAll('.category-option').forEach(item => item.classList.toggle('active', item === button)); }); }

function updateEntryUI() {
  const labels = { expense: ['记下一笔支出', '谁付款', '花在什么地方', '只记录已经发生的消费，不计算谁欠谁。', '记下这一笔'], income: ['记下一笔收入', '收入归属', '收入来自哪里', '收入单独记录，不会冲减消费统计。', '记下这笔收入'], saving: ['记录一笔存钱', '谁来存', '这笔存钱属于哪类计划', '只做生活规划，不发生真实转账。', '记下这笔存钱'] }[entryType];
  document.querySelector('#entry-title').textContent = labels[0]; document.querySelector('#party-label').textContent = labels[1]; document.querySelector('#category-label').textContent = labels[2]; document.querySelector('#entry-helper').textContent = labels[3]; document.querySelector('#entry-submit').firstChild.textContent = ` ${labels[4]} `;
  const sharedOption = entryType === 'saving' ? '' : '<label><input type="radio" name="party" value="shared" /><span><i class="orange-dot"></i> 共同账户</span></label>';
  document.querySelector('#party-picker').innerHTML = `<label><input type="radio" name="party" value="dai" checked /><span><i class="blue-dot"></i> xiaodai</span></label><label><input type="radio" name="party" value="yang" /><span><i class="pink-dot"></i> xiaoyang</span></label>${sharedOption}`;
  const defaultParty = state.activeUser || 'dai'; const defaultRadio = document.querySelector('#party-picker input[value="' + defaultParty + '"]'); if (defaultRadio) defaultRadio.checked = true;
  const cats = categoriesFor(entryType); selectedCategory = cats[0]; document.querySelector('#category-picker').innerHTML = cats.map(([icon, name], index) => `<button class="category-option ${index === 0 ? 'active' : ''}" type="button" data-index="${index}"><b>${icon}</b><span>${name}</span></button>`).join('');
  document.querySelector('.saving-target-wrap').hidden = entryType !== 'saving'; document.querySelector('#saving-target').innerHTML = `<option value="">暂不关联具体目标</option>${state.goals.map(goal => `<option value="${goal.id}">${goal.icon} ${escapeHtml(goal.name)}</option>`).join('')}`;
}
function setEntryType(type) { entryType = type; document.querySelectorAll('[data-entry-type]').forEach(button => button.classList.toggle('active', button.dataset.entryType === type)); updateEntryUI(); }
function switchView(view) { document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `${view}-view`)); document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view)); document.querySelector('#page-title').textContent = { home: '今天也一起，好好生活', vault: '把小愿望，慢慢存成真的', review: '这就是我们的九月' }[view]; window.scrollTo({ top: 0, behavior: 'smooth' }); }
function setupNavigation() { document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view))); document.querySelectorAll('[data-go-to]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.goTo))); }
function openEntry(type = 'expense', owner = null, goalId = '') { document.querySelector('#expense-form').reset(); setEntryType(type); if (owner) document.querySelector(`input[name="party"][value="${owner}"]`).checked = true; if (goalId) document.querySelector('#saving-target').value = goalId; document.querySelector('#expense-dialog').showModal(); setTimeout(() => document.querySelector('#amount').focus(), 50); }

function addEntry(event) {
  event.preventDefault(); const amount = Number(document.querySelector('#amount').value); if (!amount) return;
  const party = new FormData(event.currentTarget).get('party'); const note = document.querySelector('#expense-note').value.trim(); const now = new Date(); const base = { id: Date.now(), amount, createdAt: now.toISOString(), date: '今天', time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), weekday: now.getDay() === 0 || now.getDay() === 6 ? '周末' : '工作日', note };
  if (entryType === 'expense') { state.expenses.unshift({ ...base, title: note || selectedCategory[1], payer: party, icon: selectedCategory[0], category: selectedCategory[1] }); lastEntry = { type: 'expense', id: base.id }; }
  if (entryType === 'income') { state.incomes.unshift({ ...base, title: note || selectedCategory[1], owner: party, icon: selectedCategory[0], category: selectedCategory[1] }); lastEntry = { type: 'income', id: base.id }; }
  if (entryType === 'saving') { const goalId = Number(document.querySelector('#saving-target').value) || null; state.savings.unshift({ ...base, owner: party, goalId, note: note || selectedCategory[1] }); lastEntry = { type: 'saving', id: base.id }; }
  saveState(); renderAll(); document.querySelector('#expense-dialog').close(); event.currentTarget.reset(); showToast(entryType === 'expense' ? '支出已记下' : entryType === 'income' ? '收入已记下，不影响消费统计' : '存钱计划已记下', true);
}
function undoEntry() { if (!lastEntry) return; const collection = lastEntry.type === 'expense' ? 'expenses' : lastEntry.type === 'income' ? 'incomes' : 'savings'; state[collection] = state[collection].filter(item => item.id !== lastEntry.id); saveState(); renderAll(); lastEntry = null; clearInterval(undoTimer); document.querySelector('#toast').classList.remove('show'); }
function showToast(message, canUndo = false) { clearInterval(undoTimer); const toast = document.querySelector('#toast'); document.querySelector('#toast-message').textContent = message; document.querySelector('#undo-button').hidden = !canUndo; toast.classList.add('show'); let count = 4; document.querySelector('#undo-count').textContent = count; undoTimer = setInterval(() => { count -= 1; document.querySelector('#undo-count').textContent = count; if (count <= 0) { clearInterval(undoTimer); toast.classList.remove('show'); lastEntry = null; } }, 1000); }

function openBudgetDialog() {
  const input = document.querySelector('#budget-amount');
  document.querySelector('#budget-dialog-title').textContent = state.budget > 0 ? '修改月度预算' : '设置月度预算';
  input.value = state.budget > 0 ? state.budget : '';
  document.querySelector('#budget-dialog').showModal();
  setTimeout(() => { input.focus(); if (input.value) input.select(); }, 50);
}

function requestExpenseDelete(id) {
  const expense = state.expenses.find(item => item.id === id);
  if (!expense) return;
  pendingDeleteId = id;
  document.querySelector('#delete-summary').textContent = `「${expense.title}」${money.format(expense.amount)}，删除后预算和复盘会立即更新。`;
  document.querySelector('#delete-dialog').showModal();
}

function confirmExpenseDelete() {
  const expense = state.expenses.find(item => item.id === pendingDeleteId);
  if (!expense) return document.querySelector('#delete-dialog').close();
  state.expenses = state.expenses.filter(item => item.id !== pendingDeleteId);
  pendingDeleteId = null;
  saveState(); renderAll();
  document.querySelector('#delete-dialog').close();
  showToast('这笔记录已删除');
}

function setupDialogs() {
  document.querySelector('#add-expense').addEventListener('click', () => openEntry()); document.querySelector('#mobile-add').addEventListener('click', () => openEntry()); document.querySelector('.close-dialog').addEventListener('click', () => document.querySelector('#expense-dialog').close()); document.querySelector('#expense-form').addEventListener('submit', addEntry); document.querySelector('#undo-button').addEventListener('click', undoEntry); document.querySelectorAll('[data-entry-type]').forEach(button => button.addEventListener('click', () => setEntryType(button.dataset.entryType)));
  document.querySelector('[data-action="edit-budget"]').addEventListener('click', openBudgetDialog); document.querySelector('#budget-primary').addEventListener('click', openBudgetDialog); document.querySelector('.close-budget').addEventListener('click', () => document.querySelector('#budget-dialog').close()); document.querySelector('#budget-form').addEventListener('submit', event => { event.preventDefault(); const value = Number(document.querySelector('#budget-amount').value); if (!Number.isFinite(value) || value <= 0) return; state.budget = value; saveState(); renderReview(); document.querySelector('#budget-dialog').close(); showToast(`月度预算已设置为 ${money.format(state.budget)}`); });
  document.querySelector('#ledger-list').addEventListener('click', event => { const button = event.target.closest('[data-delete-expense]'); if (button) requestExpenseDelete(Number(button.dataset.deleteExpense)); }); document.querySelector('#delete-cancel').addEventListener('click', () => { pendingDeleteId = null; document.querySelector('#delete-dialog').close(); }); document.querySelector('#delete-confirm').addEventListener('click', confirmExpenseDelete);
  document.querySelector('.filter-button').addEventListener('click', event => { const filters = ['all', 'dai', 'yang', 'shared']; ledgerFilter = filters[(filters.indexOf(ledgerFilter) + 1) % filters.length]; const labels = { all: '全部', dai: '小戴', yang: '小杨', shared: '共同' }; event.currentTarget.lastChild.textContent = ` ${labels[ledgerFilter]}`; renderLedger(); });
  document.querySelectorAll('[data-deposit]').forEach(button => button.addEventListener('click', () => openEntry('saving', button.dataset.deposit)));
  document.querySelector('.goals-section').addEventListener('click', event => { const newGoal = event.target.closest('[data-action="new-goal"]'); if (newGoal) document.querySelector('#goal-dialog').showModal(); const button = event.target.closest('[data-goal-id]'); if (button) openEntry('saving', null, Number(button.dataset.goalId)); });
  document.querySelector('.close-goal').addEventListener('click', () => document.querySelector('#goal-dialog').close()); document.querySelector('#goal-form').addEventListener('submit', event => { event.preventDefault(); const name = document.querySelector('#goal-name').value.trim(); const target = Number(document.querySelector('#goal-target').value); state.goals.push({ id: Date.now(), name, target, icon: '✨', deadline: '慢慢实现' }); saveState(); renderAll(); document.querySelector('#goal-dialog').close(); event.currentTarget.reset(); showToast('新愿望已经收进愿望池'); });
}

function setupDateAndMode() { const now = new Date(); const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']; const startDate = new Date('2019-09-21T00:00:00+08:00'); const togetherDays = Math.max(1, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - startDate) / 86400000) + 1); document.querySelector('#together-days').textContent = togetherDays.toLocaleString('zh-CN'); document.querySelector('#date-label').textContent = `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`; const isWeekend = now.getDay() === 0 || now.getDay() === 6 || (now.getDay() === 5 && now.getHours() >= 18); if (isWeekend) { document.querySelector('#mode-pill').innerHTML = '<i data-lucide="party-popper"></i> 周末快乐模式'; document.querySelector('#budget-note').textContent = '周末模式会在你记下几笔后，显示真实的周末预算。'; } }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

setupCategories(); setupNavigation(); setupDialogs(); setupIdentity(); setupDateAndMode(); updateEntryUI(); renderIdentity(); renderAll(); if (window.lucide) window.lucide.createIcons();
