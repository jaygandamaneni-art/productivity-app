// ---------- Supabase connection ----------
const SUPABASE_URL = "https://vvknwuifopgrabkpxxtm.supabase.co";
const SUPABASE_KEY = "sb_publishable_ntqSxScC5JRnKEERIjmFxQ_IcZkLghb";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function validUsername(u) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u);
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function passwordProblem(pw) {
  const ok = pw.length >= 6 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
  return ok ? "" : "Password needs 6+ characters, an uppercase letter, a number, and a special character (like ! or @).";
}

// ---------- State ----------
// tasks: { id, name, doneDate, due, subject }   log: { "YYYY-MM-DD": [{ id, name, kind }] }
// focusLog: { "YYYY-MM-DD": { m: minutes, n: sessions } }   quests: { "YYYY-MM-DD": [claimed ids] }
function emptyState() {
  return { xp: 0, habits: [], tasks: [], log: {}, trophies: [], focusLog: {}, quests: {}, questsDone: 0 };
}

let state = emptyState();
let currentUser = null;
let canSave = false;

async function loadCloud() {
  const { data, error } = await db
    .from("user_data")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    canSave = false;
    alert("Couldn't load your data. Check your connection and refresh the page.");
    state = emptyState();
    return;
  }

  const saved = data && data.data;
  if (saved && saved.habits && saved.tasks && saved.log) {
    state = Object.assign(emptyState(), saved);
  } else {
    state = emptyState();
  }
  canSave = true;
}

async function save() {
  if (!currentUser || !canSave) return;
  const { error } = await db.from("user_data").upsert({
    user_id: currentUser.id,
    data: state,
    updated_at: new Date().toISOString()
  });
  if (error) console.error("Save failed:", error);
}

// ---------- Helpers ----------
const HABIT_XP = 10;
const TASK_XP = 5;
const QUEST_XP = 15;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function today() {
  return dateKey(new Date());
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function countStreak(daySet) {
  const d = new Date();
  if (!daySet.has(dateKey(d))) d.setDate(d.getDate() - 1);
  let count = 0;
  while (daySet.has(dateKey(d))) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function overallStreak() {
  const days = new Set(Object.keys(state.log).filter(k => state.log[k].length > 0));
  return countStreak(days);
}

function levelInfo(xp) {
  let level = 1;
  let remaining = xp;
  let need = 100;
  while (remaining >= need) {
    remaining -= need;
    level++;
    need = 100 + (level - 1) * 50;
  }
  return { level, remaining, need };
}

const TITLES = [
  [1, "Rookie", "🥚"], [2, "Apprentice", "🐣"], [3, "Adventurer", "🐥"],
  [4, "Challenger", "🦊"], [5, "Hero", "🐺"], [7, "Champion", "🦁"],
  [9, "Legend", "🐉"], [12, "Mythic", "🦄"], [16, "Immortal", "👑"]
];

function titleFor(level) {
  let t = TITLES[0];
  TITLES.forEach(x => { if (level >= x[0]) t = x; });
  return t;
}

function isDue(habit, date) {
  if (dateKey(date) < habit.createdOn) return false;
  if (habit.freq === "daily") return true;
  if (habit.freq === "weekly") return habit.days.includes(date.getDay());
  if (habit.freq === "monthly") {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return habit.dates.some(d => Math.min(d, lastDay) === date.getDate());
  }
  return false;
}

function describeSchedule(h) {
  if (h.freq === "daily") return "Every day";
  if (h.freq === "weekly") {
    return [...h.days].sort((a, b) => a - b).map(d => WEEKDAYS[d]).join(", ");
  }
  return "Monthly on the " + [...h.dates].sort((a, b) => a - b).join(", ");
}

function timesDone(habitId) {
  return Object.values(state.log).reduce(
    (n, arr) => n + arr.filter(e => e.id === habitId).length, 0
  );
}

function habitStreak(h) {
  const d = new Date();
  let count = 0;
  for (let i = 0; i < 400; i++) {
    if (dateKey(d) < h.createdOn) break;
    if (isDue(h, d)) {
      const done = (state.log[dateKey(d)] || []).some(e => e.id === h.id);
      if (done) count++;
      else if (i > 0) break;
    }
    d.setDate(d.getDate() - 1);
  }
  return count;
}

// What happened on one day (used by quests and trophies)
function dayStats(key) {
  const entries = state.log[key] || [];
  const f = state.focusLog[key] || { m: 0, n: 0 };
  const due = state.habits.filter(h => isDue(h, parseKey(key)));
  const doneIds = new Set(entries.map(e => e.id));
  return {
    checkins: entries.length,
    tasksDone: entries.filter(e => e.kind === "task").length,
    habitsDone: entries.filter(e => e.kind === "habit").length,
    focusMinutes: f.m,
    focusSessions: f.n,
    allHabits: due.length > 0 && due.every(h => doneIds.has(h.id))
  };
}

// ---------- Toasts (queued so they never overlap) and confetti ----------
const toastQueue = [];
let toastBusy = false;

function showToast(text, big) {
  toastQueue.push({ text, big });
  if (!toastBusy) pumpToasts();
}

function pumpToasts() {
  const next = toastQueue.shift();
  if (!next) {
    toastBusy = false;
    return;
  }
  toastBusy = true;
  const el = document.createElement("div");
  el.className = "toast" + (next.big ? " big" : "");
  el.textContent = next.text;
  document.body.append(el);
  setTimeout(() => el.remove(), 1500);
  setTimeout(pumpToasts, 1650);
}

function confetti() {
  const colors = ["#7c8cff", "#b06cff", "#3ddc97", "#ff9f43", "#ff6b6b", "#ffd166"];
  for (let i = 0; i < 48; i++) {
    const p = document.createElement("div");
    p.className = "confetti";
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + "s";
    p.style.animationDuration = 1.6 + Math.random() * 1.2 + "s";
    document.body.append(p);
    setTimeout(() => p.remove(), 3600);
  }
}

function awardXP(amount, label) {
  const before = levelInfo(state.xp).level;
  state.xp += amount;
  const after = levelInfo(state.xp).level;
  showToast(label || "+" + amount + " XP");
  if (after > before) {
    showToast("🎉 Level " + after + " · " + titleFor(after)[1] + "!", true);
    confetti();
  }
}

function removeXP(amount) {
  state.xp = Math.max(0, state.xp - amount);
}

// ---------- Daily quests ----------
const QUESTS = [
  { id: "three", text: "Check off 3 things", goal: 3, get: s => s.checkins },
  { id: "five", text: "Check off 5 things", goal: 5, get: s => s.checkins },
  { id: "tasks2", text: "Finish 2 tasks", goal: 2, get: s => s.tasksDone },
  { id: "habits2", text: "Complete 2 habits", goal: 2, get: s => s.habitsDone },
  { id: "focus", text: "Do a focus session", goal: 1, get: s => s.focusSessions },
  { id: "focus25", text: "Focus for 25 minutes", goal: 25, get: s => s.focusMinutes },
  { id: "allhabits", text: "Finish every habit due today", goal: 1, get: s => (s.allHabits ? 1 : 0) }
];

function todaysQuests() {
  const key = today();
  return QUESTS
    .map(q => ({ q, k: hashStr(key + q.id) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map(x => x.q);
}

function questClaimed(id) {
  return (state.quests[today()] || []).includes(id);
}

function checkQuests() {
  const key = today();
  Object.keys(state.quests).forEach(k => { if (k !== key) delete state.quests[k]; });
  const claimed = state.quests[key] || [];
  const s = dayStats(key);
  todaysQuests().forEach(q => {
    if (!claimed.includes(q.id) && q.get(s) >= q.goal) {
      claimed.push(q.id);
      state.questsDone = (state.questsDone || 0) + 1;
      awardXP(QUEST_XP, "🎯 Quest done: " + q.text + " (+" + QUEST_XP + " XP)");
    }
  });
  state.quests[key] = claimed;
}

// ---------- Trophies ----------
const TROPHIES = [
  { id: "first", icon: "🌱", name: "First Step", desc: "Check off your first item", test: s => s.total >= 1 },
  { id: "ten", icon: "🔥", name: "Warming Up", desc: "10 check-ins", test: s => s.total >= 10 },
  { id: "fifty", icon: "💪", name: "Getting Serious", desc: "50 check-ins", test: s => s.total >= 50 },
  { id: "hundred", icon: "💯", name: "Centurion", desc: "100 check-ins", test: s => s.total >= 100 },
  { id: "streak3", icon: "⚡", name: "On a Roll", desc: "3-day streak", test: s => s.streak >= 3 },
  { id: "streak7", icon: "🗓️", name: "Week Warrior", desc: "7-day streak", test: s => s.streak >= 7 },
  { id: "streak14", icon: "🌙", name: "Two Weeks Strong", desc: "14-day streak", test: s => s.streak >= 14 },
  { id: "streak30", icon: "👑", name: "Unstoppable", desc: "30-day streak", test: s => s.streak >= 30 },
  { id: "level5", icon: "🚀", name: "Level 5", desc: "Reach level 5", test: s => s.level >= 5 },
  { id: "level10", icon: "🌟", name: "Level 10", desc: "Reach level 10", test: s => s.level >= 10 },
  { id: "perfect", icon: "✨", name: "Perfect Day", desc: "Finish 3+ habits due today", test: s => s.perfect },
  { id: "habits3", icon: "🎯", name: "Habit Builder", desc: "Create 3 habits", test: s => s.habitCount >= 3 },
  { id: "tasks25", icon: "📚", name: "Task Crusher", desc: "Finish 25 tasks", test: s => s.tasksDone >= 25 },
  { id: "focus1", icon: "⏱️", name: "In the Zone", desc: "Finish a focus session", test: s => s.focusSessions >= 1 },
  { id: "focus100", icon: "🧠", name: "Deep Work", desc: "100 focus minutes", test: s => s.focusMinutes >= 100 },
  { id: "quests5", icon: "🏅", name: "Quest Master", desc: "Complete 5 daily quests", test: s => s.questsDone >= 5 }
];

function trophyStats() {
  let total = 0;
  let tasksDone = 0;
  Object.values(state.log).forEach(arr => arr.forEach(e => {
    total++;
    if (e.kind === "task") tasksDone++;
  }));
  const f = Object.values(state.focusLog);
  const dueToday = state.habits.filter(h => isDue(h, new Date()));
  return {
    total,
    tasksDone,
    streak: overallStreak(),
    level: levelInfo(state.xp).level,
    perfect: dueToday.length >= 3 && dayStats(today()).allHabits,
    habitCount: state.habits.length,
    focusSessions: f.reduce((n, x) => n + x.n, 0),
    focusMinutes: f.reduce((n, x) => n + x.m, 0),
    questsDone: state.questsDone || 0
  };
}

function checkTrophies() {
  if (!state.trophies) state.trophies = [];
  const stats = trophyStats();
  TROPHIES.forEach(t => {
    if (!state.trophies.includes(t.id) && t.test(stats)) {
      state.trophies.push(t.id);
      showToast(t.icon + " " + t.name + " unlocked!", true);
      confetti();
    }
  });
}

// ---------- Actions ----------
function toggleItem(kind, id) {
  const t = today();
  if (!state.log[t]) state.log[t] = [];
  const entries = state.log[t];
  const idx = entries.findIndex(e => e.id === id);
  const xp = kind === "habit" ? HABIT_XP : TASK_XP;
  const task = kind === "task" ? state.tasks.find(x => x.id === id) : null;

  if (idx >= 0) {
    entries.splice(idx, 1);
    if (entries.length === 0) delete state.log[t];
    removeXP(xp);
    if (task) task.doneDate = null;
  } else {
    const source = kind === "habit"
      ? state.habits.find(h => h.id === id)
      : task;
    if (!source) {
      if (entries.length === 0) delete state.log[t];
      return;
    }
    entries.push({ id, name: source.name, kind });
    awardXP(xp);
    if (task) task.doneDate = t;
    checkQuests();
    checkTrophies();
  }
  save();
  render();
}

function undoTodayCheckin(id, xp) {
  const t = today();
  const entries = state.log[t];
  if (!entries) return;
  const idx = entries.findIndex(e => e.id === id);
  if (idx < 0) return;
  entries.splice(idx, 1);
  if (entries.length === 0) delete state.log[t];
  removeXP(xp);
}

function addTask(name, due, subject) {
  state.tasks.push({ id: newId(), name, doneDate: null, due: due || null, subject: subject || "" });
  save();
  render();
}

function deleteTask(id) {
  undoTodayCheckin(id, TASK_XP);
  state.tasks = state.tasks.filter(x => x.id !== id);
  save();
  render();
}

function deleteHabit(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm('Delete "' + h.name + '"? Past days stay on the calendar, but today\'s check-in (and its XP) will be undone.')) return;
  undoTodayCheckin(id, HABIT_XP);
  state.habits = state.habits.filter(x => x.id !== id);
  save();
  render();
}

// ---------- Rendering ----------
function subjectColor(name) {
  return "hsl(" + (hashStr(name.toLowerCase()) % 360) + " 70% 65%)";
}

function dueInfo(task) {
  if (!task.due) return null;
  const t = today();
  if (task.due < t) return { label: "Overdue", cls: "late" };
  if (task.due === t) return { label: "Due today", cls: "soon" };
  const d = parseKey(task.due);
  const diff = Math.round((d - parseKey(t)) / 86400000);
  if (diff === 1) return { label: "Tomorrow", cls: "soon" };
  if (diff < 7) return { label: WEEKDAYS[d.getDay()], cls: "" };
  return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), cls: "" };
}

function makeItem({ text, sub, badge, badgeClass, tag, tagColor, done, onToggle, onEdit, onDelete }) {
  const li = document.createElement("li");
  li.className = "item" + (done ? " done" : "");

  if (onToggle) {
    const check = document.createElement("button");
    check.className = "item-check";
    check.textContent = done ? "✓" : "";
    check.addEventListener("click", onToggle);
    li.append(check);
  }

  const label = document.createElement("span");
  label.className = "item-text";
  label.textContent = text;
  if (tag) {
    const tg = document.createElement("span");
    tg.className = "tag";
    tg.textContent = tag;
    if (tagColor) tg.style.color = tagColor;
    label.append(tg);
  }
  if (sub) {
    const s = document.createElement("span");
    s.className = "item-sub";
    s.textContent = sub;
    label.append(s);
  }
  li.append(label);

  if (badge) {
    const b = document.createElement("span");
    b.className = "badge" + (badgeClass ? " " + badgeClass : "");
    b.textContent = badge;
    li.append(b);
  }

  if (onEdit) {
    const edit = document.createElement("button");
    edit.className = "item-edit";
    edit.textContent = "✎";
    edit.addEventListener("click", onEdit);
    li.append(edit);
  }

  if (onDelete) {
    const del = document.createElement("button");
    del.className = "item-del";
    del.textContent = "✕";
    del.addEventListener("click", onDelete);
    li.append(del);
  }

  return li;
}

function renderEmpty(list, message) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = message;
  list.append(li);
}

function renderQuests() {
  const s = dayStats(today());
  const list = document.getElementById("quest-list");
  list.innerHTML = "";
  const quests = todaysQuests();
  let done = 0;
  quests.forEach(q => {
    const claimed = questClaimed(q.id);
    if (claimed) done++;
    list.append(makeItem({
      text: q.text,
      sub: Math.min(q.get(s), q.goal) + " / " + q.goal,
      badge: "+" + QUEST_XP + " XP",
      done: claimed
    }));
  });
  document.getElementById("quest-hint").textContent =
    done + " of " + quests.length + " done today. New quests tomorrow.";
}

function renderSubjects() {
  const dl = document.getElementById("subject-list");
  dl.innerHTML = "";
  [...new Set(state.tasks.map(t => t.subject).filter(Boolean))].forEach(n => {
    const o = document.createElement("option");
    o.value = n;
    dl.append(o);
  });
}

function renderToday() {
  const t = today();
  const doneIds = new Set((state.log[t] || []).map(e => e.id));
  const list = document.getElementById("today-list");
  list.innerHTML = "";
  let count = 0;

  state.habits.forEach(h => {
    if (!isDue(h, new Date())) return;
    count++;
    const streak = habitStreak(h);
    list.append(makeItem({
      text: h.name,
      badge: streak > 0 ? "🔥 " + streak : "Habit",
      done: doneIds.has(h.id),
      onToggle: () => toggleItem("habit", h.id)
    }));
  });

  const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999");
  const open = state.tasks.filter(x => !x.doneDate).sort(byDue);
  const doneToday = state.tasks.filter(x => x.doneDate === t);

  [...open, ...doneToday].forEach(x => {
    count++;
    const isDone = doneIds.has(x.id);
    const di = isDone ? null : dueInfo(x);
    list.append(makeItem({
      text: x.name,
      tag: x.subject || "",
      tagColor: x.subject ? subjectColor(x.subject) : "",
      badge: di ? di.label : "",
      badgeClass: di ? di.cls : "",
      done: isDone,
      onToggle: () => toggleItem("task", x.id),
      onDelete: () => deleteTask(x.id)
    }));
  });

  if (count === 0) {
    renderEmpty(list, state.habits.length === 0
      ? "Welcome! Open the Habits tab and tap a starter habit to begin."
      : "Nothing scheduled today. Add a task above.");
  }
}

const STARTERS = ["Study for 1 hour", "Review class notes", "Drink water", "Exercise", "Sleep by midnight", "Plan tomorrow"];

function renderQuickstart() {
  const box = document.getElementById("quickstart");
  const chips = document.getElementById("quickstart-chips");
  chips.innerHTML = "";
  const have = new Set(state.habits.map(h => h.name));
  const options = STARTERS.filter(n => !have.has(n));
  const show = state.habits.length < 3 && options.length > 0;
  box.classList.toggle("hidden", !show);
  if (!show) return;
  options.forEach(name => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = "+ " + name;
    chip.addEventListener("click", () => {
      state.habits.push({ id: newId(), name, freq: "daily", days: [], dates: [], createdOn: today() });
      checkTrophies();
      save();
      render();
    });
    chips.append(chip);
  });
}

function renderHabits() {
  const list = document.getElementById("habit-list");
  list.innerHTML = "";
  if (state.habits.length === 0) {
    renderEmpty(list, "No habits yet. Add the first one you want to build.");
    return;
  }
  state.habits.forEach(h => {
    const n = timesDone(h.id);
    const streak = habitStreak(h);
    list.append(makeItem({
      text: h.name,
      sub: describeSchedule(h) + " · done " + n + (n === 1 ? " time" : " times") +
        (streak > 1 ? " · 🔥 " + streak + " in a row" : ""),
      onEdit: () => openModal(h.name, h),
      onDelete: () => deleteHabit(h.id)
    }));
  });
}

function renderTrophies() {
  const unlocked = new Set(state.trophies || []);
  document.getElementById("trophy-hint").textContent =
    unlocked.size + " of " + TROPHIES.length + " unlocked";
  const list = document.getElementById("trophy-list");
  list.innerHTML = "";
  TROPHIES.forEach(t => {
    const has = unlocked.has(t.id);
    const li = makeItem({
      text: (has ? t.icon : "🔒") + " " + t.name,
      sub: t.desc,
      badge: has ? "Unlocked" : ""
    });
    if (!has) li.style.opacity = "0.5";
    list.append(li);
  });
}

function renderStats() {
  const box = document.getElementById("cal-stats");
  const days = Object.keys(state.log).filter(k => state.log[k].length > 0).sort();
  const total = days.reduce((n, k) => n + state.log[k].length, 0);

  let best = 0;
  let run = 0;
  let prev = null;
  days.forEach(k => {
    const d = parseKey(k);
    d.setHours(12);
    const t = d.getTime();
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = t;
  });

  const stats = [[best, "Best streak"], [total, "Check-ins"], [days.length, "Active days"]];
  box.innerHTML = "";
  stats.forEach(([num, label]) => {
    const cell = document.createElement("div");
    const n = document.createElement("div");
    n.className = "stat-num";
    n.textContent = num;
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = label;
    cell.append(n, l);
    box.append(cell);
  });
}

function renderInsights() {
  const chart = document.getElementById("week-chart");
  chart.innerHTML = "";
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const counts = days.map(d => (state.log[dateKey(d)] || []).length);
  const max = Math.max(1, ...counts);

  days.forEach((d, i) => {
    const col = document.createElement("div");
    col.className = "bar-col";
    const n = document.createElement("span");
    n.className = "bar-n";
    n.textContent = counts[i];
    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = Math.max(4, (counts[i] / max) * 100) + "%";
    track.append(bar);
    const l = document.createElement("span");
    l.className = "bar-l";
    l.textContent = WEEKDAYS[d.getDay()];
    col.append(n, track, l);
    chart.append(col);
  });

  const byDay = [0, 0, 0, 0, 0, 0, 0];
  Object.keys(state.log).forEach(k => { byDay[parseKey(k).getDay()] += state.log[k].length; });
  const bestVal = Math.max(...byDay);
  const f = Object.values(state.focusLog);
  const fm = f.reduce((n, x) => n + x.m, 0);
  const fn = f.reduce((n, x) => n + x.n, 0);

  const lines = [
    bestVal > 0 ? "🏅 Your best day is " + FULL_DAYS[byDay.indexOf(bestVal)] : "🏅 Check things off to find your best day",
    "⏱️ " + fm + " focus minutes across " + fn + " session" + (fn === 1 ? "" : "s"),
    "🎯 " + (state.questsDone || 0) + " daily quest" + ((state.questsDone || 0) === 1 ? "" : "s") + " completed"
  ];
  const ul = document.getElementById("insights");
  ul.innerHTML = "";
  lines.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    ul.append(li);
  });
}

function render() {
  document.getElementById("today-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("streak-count").textContent = overallStreak();

  const info = levelInfo(state.xp);
  const ti = titleFor(info.level);
  document.getElementById("avatar").textContent = ti[2];
  document.getElementById("level-label").textContent = "Level " + info.level + " · " + ti[1];
  document.getElementById("xp-text").textContent = `${info.remaining} / ${info.need} XP`;
  document.getElementById("xp-fill").style.width = (info.remaining / info.need) * 100 + "%";

  renderQuests();
  renderSubjects();
  renderToday();
  renderHabits();
  renderQuickstart();
  renderTrophies();
  renderFocus();
  renderStats();
  renderInsights();
  renderCalendar();
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    ["today", "habits", "focus", "calendar", "trophies"].forEach(name =>
      document.getElementById("tab-" + name).classList.toggle("hidden", btn.dataset.tab !== name)
    );
    window.scrollTo(0, 0);
  });
});

// ---------- Calendar ----------
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelected = today();

function renderCalendar() {
  const grid = document.getElementById("cal-grid");
  grid.innerHTML = "";
  document.getElementById("cal-title").textContent =
    calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  WEEKDAYS.forEach(w => {
    const h = document.createElement("div");
    h.className = "cal-dow";
    h.textContent = w;
    grid.append(h);
  });

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  for (let i = 0; i < calMonth.getDay(); i++) grid.append(document.createElement("div"));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(new Date(year, month, day));
    const count = (state.log[key] || []).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-day";
    if (count > 0) btn.classList.add("done", count >= 4 ? "l3" : count >= 2 ? "l2" : "l1");
    if (key === today()) btn.classList.add("today");
    if (key === calSelected) btn.classList.add("selected");
    btn.textContent = day;
    btn.addEventListener("click", () => {
      calSelected = key;
      renderCalendar();
    });
    grid.append(btn);
  }

  const entries = state.log[calSelected] || [];
  const f = state.focusLog[calSelected];
  document.getElementById("cal-detail-title").textContent =
    parseKey(calSelected).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) +
    (entries.length > 0 ? " · " + entries.length + " done" : "");

  const list = document.getElementById("cal-detail-list");
  list.innerHTML = "";
  entries.forEach(e => {
    const xp = e.kind === "habit" ? HABIT_XP : TASK_XP;
    list.append(makeItem({ text: e.name, badge: "+" + xp + " XP" }));
  });
  if (f && f.m > 0) {
    list.append(makeItem({ text: "⏱️ Focus time", badge: f.m + " min" }));
  }
  if (entries.length === 0 && !(f && f.m > 0)) renderEmpty(list, "Nothing completed this day.");
}

document.getElementById("cal-prev").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById("cal-next").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
});

// ---------- Focus timer ----------
const focusState = { minutes: 25, running: false, endAt: 0, remainingMs: 25 * 60000, timer: null };

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function renderFocus() {
  const total = focusState.minutes * 60000;
  const left = focusState.running ? Math.max(0, focusState.endAt - Date.now()) : focusState.remainingMs;
  document.getElementById("focus-time").textContent = fmtTime(left);
  document.getElementById("focus-ring").style.setProperty("--p", ((1 - left / total) * 100).toFixed(1));
  document.getElementById("focus-start").textContent =
    focusState.running ? "Pause" : focusState.remainingMs < total ? "Resume" : "Start";
  document.querySelectorAll(".focus-preset").forEach(b =>
    b.classList.toggle("on", Number(b.dataset.min) === focusState.minutes)
  );
  const f = state.focusLog[today()] || { m: 0, n: 0 };
  document.getElementById("focus-summary").textContent =
    "Today: " + f.m + " min in " + f.n + " session" + (f.n === 1 ? "" : "s") +
    " · This session earns " + focusState.minutes + " XP";
}

function focusTick() {
  if (focusState.endAt - Date.now() <= 0) finishFocus();
  else renderFocus();
}

function startPauseFocus() {
  if (focusState.running) {
    focusState.remainingMs = Math.max(0, focusState.endAt - Date.now());
    focusState.running = false;
    clearInterval(focusState.timer);
  } else {
    focusState.running = true;
    focusState.endAt = Date.now() + focusState.remainingMs;
    focusState.timer = setInterval(focusTick, 250);
  }
  renderFocus();
}

function resetFocus() {
  clearInterval(focusState.timer);
  focusState.running = false;
  focusState.remainingMs = focusState.minutes * 60000;
  renderFocus();
}

function setFocusMinutes(m) {
  if (focusState.running) {
    showToast("Pause or reset the timer first");
    return;
  }
  focusState.minutes = m;
  focusState.remainingMs = m * 60000;
  renderFocus();
}

function finishFocus() {
  clearInterval(focusState.timer);
  focusState.running = false;
  const m = focusState.minutes;
  focusState.remainingMs = m * 60000;

  const key = today();
  const f = state.focusLog[key] || { m: 0, n: 0 };
  f.m += m;
  f.n += 1;
  state.focusLog[key] = f;

  awardXP(m, "⏱️ Focus complete! +" + m + " XP");
  confetti();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  checkQuests();
  checkTrophies();
  save();
  render();
}

// ---------- Schedule popup (create + edit) ----------
const modal = document.getElementById("schedule-modal");
const weekdayChips = document.getElementById("weekday-chips");
const dateChips = document.getElementById("date-chips");
const modalName = document.getElementById("modal-name");
let pending = { editId: null, freq: "daily", days: new Set(), dates: new Set() };

function buildChips() {
  WEEKDAYS.forEach((label, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = label;
    chip.addEventListener("click", () => {
      if (pending.days.has(i)) pending.days.delete(i); else pending.days.add(i);
      chip.classList.toggle("on", pending.days.has(i));
    });
    weekdayChips.append(chip);
  });

  for (let d = 1; d <= 31; d++) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = d;
    chip.addEventListener("click", () => {
      if (pending.dates.has(d)) pending.dates.delete(d); else pending.dates.add(d);
      chip.classList.toggle("on", pending.dates.has(d));
    });
    dateChips.append(chip);
  }
}

function refreshChips() {
  weekdayChips.querySelectorAll(".chip").forEach((chip, i) =>
    chip.classList.toggle("on", pending.days.has(i))
  );
  dateChips.querySelectorAll(".chip").forEach((chip, i) =>
    chip.classList.toggle("on", pending.dates.has(i + 1))
  );
}

function setFreq(freq) {
  pending.freq = freq;
  document.querySelectorAll(".freq").forEach(b =>
    b.classList.toggle("on", b.dataset.freq === freq)
  );
  document.getElementById("weekly-pick").classList.toggle("hidden", freq !== "weekly");
  document.getElementById("monthly-pick").classList.toggle("hidden", freq !== "monthly");
  document.getElementById("modal-error").textContent = "";
}

function openModal(name, habit) {
  pending = {
    editId: habit ? habit.id : null,
    freq: habit ? habit.freq : "daily",
    days: new Set(habit ? habit.days : []),
    dates: new Set(habit ? habit.dates : [])
  };
  modalName.value = name;
  document.getElementById("modal-title").textContent = habit ? "Edit habit" : "New habit";
  refreshChips();
  setFreq(pending.freq);
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}

document.querySelectorAll(".freq").forEach(b =>
  b.addEventListener("click", () => setFreq(b.dataset.freq))
);

document.getElementById("modal-cancel").addEventListener("click", closeModal);

document.getElementById("modal-save").addEventListener("click", () => {
  const errorBox = document.getElementById("modal-error");
  const name = modalName.value.trim();
  if (!name) {
    errorBox.textContent = "Give your habit a name.";
    return;
  }
  if (pending.freq === "weekly" && pending.days.size === 0) {
    errorBox.textContent = "Pick at least one day.";
    return;
  }
  if (pending.freq === "monthly" && pending.dates.size === 0) {
    errorBox.textContent = "Pick at least one date.";
    return;
  }

  if (pending.editId) {
    const h = state.habits.find(x => x.id === pending.editId);
    if (h) {
      h.name = name;
      h.freq = pending.freq;
      h.days = [...pending.days];
      h.dates = [...pending.dates];
    }
  } else {
    state.habits.push({
      id: newId(),
      name,
      freq: pending.freq,
      days: [...pending.days],
      dates: [...pending.dates],
      createdOn: today()
    });
    document.getElementById("habit-input").value = "";
    checkTrophies();
  }

  closeModal();
  save();
  render();
});

// ---------- Screens ----------
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authHome = document.getElementById("auth-home");
const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
const forgotForm = document.getElementById("forgot-form");
const codeForm = document.getElementById("code-form");
const newpassForm = document.getElementById("newpass-form");

const authParts = {
  home: authHome,
  signup: signupForm,
  login: loginForm,
  forgot: forgotForm,
  code: codeForm,
  newpass: newpassForm
};

function showAuthPart(part, notice = "") {
  Object.entries(authParts).forEach(([name, el]) =>
    el.classList.toggle("hidden", name !== part)
  );
  document.querySelectorAll(".auth-error").forEach(el => (el.textContent = ""));
  document.getElementById("auth-notice").textContent = notice;
  window.scrollTo(0, 0);
}

function showAuth() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  showAuthPart("home");
}

async function enterApp(user) {
  currentUser = user;
  await loadCloud();
  const meta = user.user_metadata || {};
  document.getElementById("user-label").textContent =
    meta.username || user.email.split("@")[0];
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  calSelected = today();
  render();
}

document.getElementById("go-signup").addEventListener("click", () => showAuthPart("signup"));
document.getElementById("go-login").addEventListener("click", () => showAuthPart("login"));
document.getElementById("go-forgot").addEventListener("click", () => showAuthPart("forgot"));
document.querySelectorAll("[data-back]").forEach(b =>
  b.addEventListener("click", () => showAuthPart("home"))
);

// ---------- Sign up ----------
signupForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("signup-error");
  const email = document.getElementById("signup-email").value.trim().toLowerCase();
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirmPw = document.getElementById("signup-confirm").value;
  errorBox.textContent = "";

  if (!validEmail(email)) {
    errorBox.textContent = "Enter a valid email address.";
    return;
  }
  if (!validUsername(username)) {
    errorBox.textContent = "Username must be 3-20 characters: letters, numbers, or underscores.";
    return;
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) {
    errorBox.textContent = pwProblem;
    return;
  }
  if (password !== confirmPw) {
    errorBox.textContent = "Passwords don't match.";
    return;
  }

  const button = signupForm.querySelector(".btn");
  button.disabled = true;

  const { data: free, error: checkError } = await db.rpc("username_available", { u: username });
  if (checkError) {
    console.error(checkError);
    button.disabled = false;
    errorBox.textContent = "Something went wrong. Try again.";
    return;
  }
  if (!free) {
    button.disabled = false;
    errorBox.textContent = "That username is taken. Try another.";
    return;
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });

  button.disabled = false;

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      errorBox.textContent = "That email already has an account. Try logging in.";
    } else {
      errorBox.textContent = error.message;
    }
    return;
  }

  if (!data.session) {
    showAuthPart("login", "Account created! Check your email to confirm it, then log in.");
    return;
  }

  await enterApp(data.user);
});

// ---------- Log in (email) ----------
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("login-error");
  const email = document.getElementById("login-identifier").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  errorBox.textContent = "";

  const button = loginForm.querySelector(".btn");
  button.disabled = true;

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  button.disabled = false;

  if (error) {
    errorBox.textContent = "Wrong email or password.";
    return;
  }

  await enterApp(data.user);
});

// ---------- Forgot password, step 1: send the code ----------
forgotForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("forgot-error");
  const email = document.getElementById("forgot-email").value.trim().toLowerCase();
  errorBox.textContent = "";

  if (!validEmail(email)) {
    errorBox.textContent = "Enter a valid email address.";
    return;
  }

  const button = forgotForm.querySelector(".btn");
  button.disabled = true;

  const { error } = await db.auth.resetPasswordForEmail(email);

  button.disabled = false;

  if (error) {
    errorBox.textContent = error.message;
    return;
  }

  document.getElementById("code-email").value = email;
  showAuthPart("code", "If that email has an account, a code is on its way.");
});

// ---------- Forgot password, step 2: check the code ----------
codeForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("code-error");
  const email = document.getElementById("code-email").value.trim().toLowerCase();
  const token = document.getElementById("code-input").value.trim();
  errorBox.textContent = "";

  const button = codeForm.querySelector(".btn");
  button.disabled = true;

  const { error } = await db.auth.verifyOtp({ email, token, type: "recovery" });

  button.disabled = false;

  if (error) {
    errorBox.textContent = "That code is wrong or expired.";
    return;
  }

  showAuthPart("newpass");
});

// ---------- Forgot password, step 3: set the new password ----------
newpassForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("newpass-error");
  const pw = document.getElementById("newpass").value;
  const confirmPw = document.getElementById("newpass-confirm").value;
  errorBox.textContent = "";

  const pwProblem = passwordProblem(pw);
  if (pwProblem) {
    errorBox.textContent = pwProblem;
    return;
  }
  if (pw !== confirmPw) {
    errorBox.textContent = "Passwords don't match.";
    return;
  }

  const button = newpassForm.querySelector(".btn");
  button.disabled = true;

  const { error } = await db.auth.updateUser({ password: pw });

  if (error) {
    button.disabled = false;
    errorBox.textContent = error.message;
    return;
  }

  await db.auth.signOut();
  button.disabled = false;
  forgotForm.reset();
  codeForm.reset();
  newpassForm.reset();
  showAuthPart("home", "Password updated! Log in with your new password.");
});

// ---------- Log out ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
  clearInterval(focusState.timer);
  focusState.running = false;
  focusState.remainingMs = focusState.minutes * 60000;
  currentUser = null;
  canSave = false;
  state = emptyState();
  signupForm.reset();
  loginForm.reset();
  showAuth();
});

// ---------- Task and habit forms ----------
document.getElementById("task-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("task-input");
  const due = document.getElementById("task-due");
  const subject = document.getElementById("task-subject");
  const name = input.value.trim();
  if (name) addTask(name, due.value || null, subject.value.trim());
  input.value = "";
  due.value = "";
});

document.getElementById("habit-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("habit-input").value.trim();
  if (name) openModal(name);
});

// ---------- Focus timer buttons ----------
document.getElementById("focus-start").addEventListener("click", startPauseFocus);
document.getElementById("focus-reset").addEventListener("click", resetFocus);
document.querySelectorAll(".focus-preset").forEach(b =>
  b.addEventListener("click", () => setFocusMinutes(Number(b.dataset.min)))
);
document.getElementById("focus-custom").addEventListener("change", e => {
  const v = Math.round(Number(e.target.value));
  if (v >= 1 && v <= 180) setFocusMinutes(v);
  e.target.value = "";
});

// ---------- Share button ----------
const shareBtn = document.getElementById("share-btn");
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    const info = levelInfo(state.xp);
    const text = "I'm Level " + info.level + " (" + titleFor(info.level)[1] + ") on Taskova with a " +
      overallStreak() + "-day streak 🔥 Make your to-do list a game:";
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: "Taskova", text, url });
      } else {
        await navigator.clipboard.writeText(text + " " + url);
        showToast("Copied! Paste it anywhere");
      }
    } catch (err) {
      // sharing was cancelled
    }
  });
}

// ---------- Start: are they already logged in? ----------
buildChips();

(async function init() {
  const { data } = await db.auth.getSession();
  if (data.session) {
    await enterApp(data.session.user);
  } else {
    showAuth();
  }
})();

// END OF FILE
