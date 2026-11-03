// ---------- Storage ----------
const STORAGE_KEY = "dailyquest-v1";

let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.habits && saved.tasks) return saved;
  } catch (e) {}
  return { xp: 0, habits: [], tasks: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Helpers ----------
const HABIT_XP = 10;
const TASK_XP = 5;

// Local date as YYYY-MM-DD (avoids timezone bugs)
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function today() {
  return dateKey(new Date());
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Counts consecutive days (ending today, or yesterday if today isn't done yet)
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
  const days = new Set();
  state.habits.forEach(h => h.doneDates.forEach(x => days.add(x)));
  state.tasks.forEach(t => { if (t.done && t.doneDate) days.add(t.doneDate); });
  return countStreak(days);
}

// Level gets harder each time: 100 XP, then 150, then 200...
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

// ---------- Actions ----------
function addHabit(name) {
  state.habits.push({ id: newId(), name, doneDates: [] });
  save(); render();
}

function toggleHabit(id) {
  const habit = state.habits.find(h => h.id === id);
  const t = today();
  if (habit.doneDates.includes(t)) {
    habit.doneDates = habit.doneDates.filter(x => x !== t);
    state.xp = Math.max(0, state.xp - HABIT_XP);
  } else {
    habit.doneDates.push(t);
    state.xp += HABIT_XP;
  }
  save(); render();
}

function deleteHabit(id) {
  state.habits = state.habits.filter(h => h.id !== id);
  save(); render();
}

function addTask(name) {
  state.tasks.push({ id: newId(), name, done: false, doneDate: null });
  save(); render();
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (task.done) {
    task.done = false;
    task.doneDate = null;
    state.xp = Math.max(0, state.xp - TASK_XP);
  } else {
    task.done = true;
    task.doneDate = today();
    state.xp += TASK_XP;
  }
  save(); render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  save(); render();
}

// ---------- Rendering ----------
function makeItem({ text, done, meta, onToggle, onDelete }) {
  const li = document.createElement("li");
  li.className = "item" + (done ? " done" : "");

  const check = document.createElement("button");
  check.className = "item-check";
  check.textContent = done ? "✓" : "";
  check.addEventListener("click", onToggle);

  const label = document.createElement("span");
  label.className = "item-text";
  label.textContent = text;

  li.append(check, label);

  if (meta) {
    const m = document.createElement("span");
    m.className = "item-meta";
    m.textContent = meta;
    li.append(m);
  }

  const del = document.createElement("button");
  del.className = "item-del";
  del.textContent = "✕";
  del.addEventListener("click", onDelete);
  li.append(del);

  return li;
}

function renderEmpty(list, message) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = message;
  list.append(li);
}

function render() {
  const t = today();

  // Date + streak
  document.getElementById("today-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("streak-count").textContent = overallStreak();

  // Level + XP bar
  const info = levelInfo(state.xp);
  document.getElementById("level-label").textContent = "Level " + info.level;
  document.getElementById("xp-text").textContent = `${info.remaining} / ${info.need} XP`;
  document.getElementById("xp-fill").style.width = (info.remaining / info.need) * 100 + "%";

  // Habits
  const habitList = document.getElementById("habit-list");
  habitList.innerHTML = "";
  if (state.habits.length === 0) renderEmpty(habitList, "No habits yet. Add your first one above.");
  state.habits.forEach(h => {
    const streak = countStreak(new Set(h.doneDates));
    habitList.append(makeItem({
      text: h.name,
      done: h.doneDates.includes(t),
      meta: streak > 0 ? "🔥 " + streak : "",
      onToggle: () => toggleHabit(h.id),
      onDelete: () => deleteHabit(h.id)
    }));
  });

  // Tasks: show unfinished tasks, plus ones finished today
  const taskList = document.getElementById("task-list");
  taskList.innerHTML = "";
  const visible = state.tasks.filter(x => !x.done || x.doneDate === t);
  if (visible.length === 0) renderEmpty(taskList, "Nothing on the list. Add a task above.");
  visible.forEach(x => {
    taskList.append(makeItem({
      text: x.name,
      done: x.done,
      meta: "",
      onToggle: () => toggleTask(x.id),
      onDelete: () => deleteTask(x.id)
    }));
  });
}

// ---------- Forms ----------
document.getElementById("habit-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("habit-input");
  const name = input.value.trim();
  if (name) addHabit(name);
  input.value = "";
});

document.getElementById("task-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("task-input");
  const name = input.value.trim();
  if (name) addTask(name);
  input.value = "";
});

render();
