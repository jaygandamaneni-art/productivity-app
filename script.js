// ---------- Supabase connection ----------
const SUPABASE_URL = "https://vvknwuifopgrabkpxxtm.supabase.co";
const SUPABASE_KEY = "sb_publishable_ntqSxScC5JRnKEERIjmFxQ_IcZkLghb";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Usernames become a fake email behind the scenes (users never see it)
const AUTH_DOMAIN = "dailyquest.app";

function fakeEmail(username) {
  return username.toLowerCase() + "@" + AUTH_DOMAIN;
}

function validUsername(u) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u);
}

// ---------- State ----------
// habits: [{ id, name, freq: "daily"|"weekly"|"monthly", days: [0-6], dates: [1-31], createdOn }]
// tasks:  [{ id, name, doneDate }]
// log:    { "YYYY-MM-DD": [{ id, name, kind }] }  <- what got finished each day (calendar uses this)
function emptyState() {
  return { xp: 0, habits: [], tasks: [], log: {} };
}

let state = emptyState();
let currentUser = null;
let canSave = false; // stays false if loading failed, so we never overwrite cloud data

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
    state = saved;
  } else {
    // new account, or old data from before this update: start fresh
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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

// Is this habit scheduled on the given date?
function isDue(habit, date) {
  if (dateKey(date) < habit.createdOn) return false;
  if (habit.freq === "daily") return true;
  if (habit.freq === "weekly") return habit.days.includes(date.getDay());
  if (habit.freq === "monthly") return habit.dates.includes(date.getDate());
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

// ---------- XP popups ----------
function showToast(text, big) {
  const el = document.createElement("div");
  el.className = "toast" + (big ? " big" : "");
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 1500);
}

function awardXP(amount) {
  const before = levelInfo(state.xp).level;
  state.xp += amount;
  const after = levelInfo(state.xp).level;
  showToast("+" + amount + " XP");
  if (after > before) {
    setTimeout(() => showToast("🎉 Level " + after + "!", true), 600);
  }
}

function removeXP(amount) {
  state.xp = Math.max(0, state.xp - amount);
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
    // uncheck
    entries.splice(idx, 1);
    if (entries.length === 0) delete state.log[t];
    removeXP(xp);
    if (task) task.doneDate = null;
  } else {
    // check
    const source = kind === "habit"
      ? state.habits.find(h => h.id === id)
      : task;
    if (!source) return;
    entries.push({ id, name: source.name, kind });
    awardXP(xp);
    if (task) task.doneDate = t;
  }
  save();
  render();
}

function addTask(name) {
  state.tasks.push({ id: newId(), name, doneDate: null });
  save();
  render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(x => x.id !== id);
  save();
  render();
}

function deleteHabit(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm('Delete "' + h.name + '"? Your past check-ins stay on the calendar.')) return;
  state.habits = state.habits.filter(x => x.id !== id);
  save();
  render();
}

// ---------- Rendering ----------
function makeItem({ text, sub, badge, done, onToggle, onDelete }) {
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
  if (sub) {
    const s = document.createElement("span");
    s.className = "item-sub";
    s.textContent = sub;
    label.append(s);
  }
  li.append(label);

  if (badge) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = badge;
    li.append(b);
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

function renderToday() {
  const t = today();
  const doneIds = new Set((state.log[t] || []).map(e => e.id));
  const list = document.getElementById("today-list");
  list.innerHTML = "";
  let count = 0;

  state.habits.forEach(h => {
    if (!isDue(h, new Date())) return;
    count++;
    list.append(makeItem({
      text: h.name,
      badge: "Habit",
      done: doneIds.has(h.id),
      onToggle: () => toggleItem("habit", h.id)
    }));
  });

  state.tasks.forEach(x => {
    if (x.doneDate && x.doneDate !== t) return; // finished on an earlier day
    count++;
    list.append(makeItem({
      text: x.name,
      done: doneIds.has(x.id),
      onToggle: () => toggleItem("task", x.id),
      onDelete: () => deleteTask(x.id)
    }));
  });

  if (count === 0) renderEmpty(list, "Nothing today. Add a task above or create a habit.");
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
    list.append(makeItem({
      text: h.name,
      sub: describeSchedule(h) + " · done " + n + (n === 1 ? " time" : " times"),
      onDelete: () => deleteHabit(h.id)
    }));
  });
}

function render() {
  document.getElementById("today-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("streak-count").textContent = overallStreak();

  const info = levelInfo(state.xp);
  document.getElementById("level-label").textContent = "Level " + info.level;
  document.getElementById("xp-text").textContent = `${info.remaining} / ${info.need} XP`;
  document.getElementById("xp-fill").style.width = (info.remaining / info.need) * 100 + "%";

  renderToday();
  renderHabits();
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    document.getElementById("tab-today").classList.toggle("hidden", btn.dataset.tab !== "today");
    document.getElementById("tab-habits").classList.toggle("hidden", btn.dataset.tab !== "habits");
  });
});

// ---------- Schedule popup ----------
const modal = document.getElementById("schedule-modal");
const weekdayChips = document.getElementById("weekday-chips");
const dateChips = document.getElementById("date-chips");
let pending = { name: "", freq: "daily", days: new Set(), dates: new Set() };

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

function setFreq(freq) {
  pending.freq = freq;
  document.querySelectorAll(".freq").forEach(b =>
    b.classList.toggle("on", b.dataset.freq === freq)
  );
  document.getElementById("weekly-pick").classList.toggle("hidden", freq !== "weekly");
  document.getElementById("monthly-pick").classList.toggle("hidden", freq !== "monthly");
  document.getElementById("modal-error").textContent = "";
}

function openModal(name) {
  pending = { name, freq: "daily", days: new Set(), dates: new Set() };
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
  document.getElementById("modal-title").textContent = 'How often: "' + name + '"?';
  setFreq("daily");
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
  if (pending.freq === "weekly" && pending.days.size === 0) {
    errorBox.textContent = "Pick at least one day.";
    return;
  }
  if (pending.freq === "monthly" && pending.dates.size === 0) {
    errorBox.textContent = "Pick at least one date.";
    return;
  }

  state.habits.push({
    id: newId(),
    name: pending.name,
    freq: pending.freq,
    days: [...pending.days],
    dates: [...pending.dates],
    createdOn: today()
  });

  document.getElementById("habit-input").value = "";
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

function showAuthPart(part) {
  authHome.classList.toggle("hidden", part !== "home");
  signupForm.classList.toggle("hidden", part !== "signup");
  loginForm.classList.toggle("hidden", part !== "login");
  document.getElementById("signup-error").textContent = "";
  document.getElementById("login-error").textContent = "";
}

function showAuth() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  showAuthPart("home");
}

async function enterApp(user) {
  currentUser = user;
  await loadCloud();
  document.getElementById("user-label").textContent = user.email.split("@")[0];
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  render();
}

document.getElementById("go-signup").addEventListener("click", () => showAuthPart("signup"));
document.getElementById("go-login").addEventListener("click", () => showAuthPart("login"));
document.querySelectorAll("[data-back]").forEach(b =>
  b.addEventListener("click", () => showAuthPart("home"))
);

// ---------- Sign up ----------
signupForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("signup-error");
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirmPw = document.getElementById("signup-confirm").value;
  errorBox.textContent = "";

  if (!validUsername(username)) {
    errorBox.textContent = "Username must be 3-20 characters: letters, numbers, or underscores.";
    return;
  }
  if (password.length < 6) {
    errorBox.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (password !== confirmPw) {
    errorBox.textContent = "Passwords don't match.";
    return;
  }

  const button = signupForm.querySelector(".btn");
  button.disabled = true;

  const { data, error } = await db.auth.signUp({
    email: fakeEmail(username),
    password
  });

  button.disabled = false;

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      errorBox.textContent = "That username is taken. Try another.";
    } else {
      errorBox.textContent = error.message;
    }
    return;
  }

  if (!data.session) {
    errorBox.textContent = "Account created, but email confirmation is still turned on in Supabase. Turn it off and try again.";
    return;
  }

  await enterApp(data.user);
});

// ---------- Log in ----------
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("login-error");
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  errorBox.textContent = "";

  const button = loginForm.querySelector(".btn");
  button.disabled = true;

  const { data, error } = await db.auth.signInWithPassword({
    email: fakeEmail(username),
    password
  });

  button.disabled = false;

  if (error) {
    errorBox.textContent = "Wrong username or password.";
    return;
  }

  await enterApp(data.user);
});

// ---------- Log out ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
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
  const name = input.value.trim();
  if (name) addTask(name);
  input.value = "";
});

document.getElementById("habit-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("habit-input").value.trim();
  if (name) openModal(name); // the popup finishes adding it
});

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
