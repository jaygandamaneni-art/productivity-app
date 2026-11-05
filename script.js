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
function emptyState() {
  return { xp: 0, habits: [], tasks: [], log: {} };
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
    state = saved;
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
    entries.splice(idx, 1);
    if (entries.length === 0) delete state.log[t];
    removeXP(xp);
    if (task) task.doneDate = null;
  } else {
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

function addTask(name) {
  state.tasks.push({ id: newId(), name, doneDate: null });
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
function makeItem({ text, sub, badge, done, onToggle, onEdit, onDelete }) {
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
    if (x.doneDate && x.doneDate !== t) return;
    count++;
    list.append(makeItem({
      text: x.name,
      done: doneIds.has(x.id),
      onToggle: () => toggleItem("task", x.id),
      onDelete: () => deleteTask(x.id)
    }));
  });

  if (count === 0) renderEmpty(list, state.habits.length === 0
    ? "Welcome! Open the Habits tab and tap a starter habit to begin."
    : "Nothing scheduled today. Add a task above.");
}

const STARTERS = ["Drink water", "Read 10 minutes", "Exercise", "Stretch", "Write in a journal", "Go to bed on time"];

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
    list.append(makeItem({
      text: h.name,
      sub: describeSchedule(h) + " · done " + n + (n === 1 ? " time" : " times"),
      onEdit: () => openModal(h.name, h),
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
  renderQuickstart();
  renderCalendar();
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    ["today", "habits", "calendar"].forEach(name =>
      document.getElementById("tab-" + name).classList.toggle("hidden", btn.dataset.tab !== name)
    );
  });
});

// ---------- Calendar ----------
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelected = today();

function renderStats() {
  const box = document.getElementById("cal-stats");
  const days = Object.keys(state.log).filter(k => state.log[k].length > 0).sort();
  const total = days.reduce((n, k) => n + state.log[k].length, 0);

  let best = 0, run = 0, prev = null;
  days.forEach(k => {
    const [y, m, d] = k.split("-").map(Number);
    const t = new Date(y, m - 1, d, 12).getTime();
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

function renderCalendar() {
  renderStats();
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-day";
    if (state.log[key] && state.log[key].length > 0) btn.classList.add("done");
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
  const total = entries.reduce((n, e) => n + (e.kind === "habit" ? HABIT_XP : TASK_XP), 0);
  const [y, m, d] = calSelected.split("-").map(Number);
  document.getElementById("cal-detail-title").textContent =
    new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) +
    (total > 0 ? " · +" + total + " XP" : "");

  const list = document.getElementById("cal-detail-list");
  list.innerHTML = "";
  if (entries.length === 0) {
    renderEmpty(list, "Nothing completed this day.");
  } else {
    entries.forEach(e => {
      const xp = e.kind === "habit" ? HABIT_XP : TASK_XP;
      list.append(makeItem({ text: e.name, badge: "+" + xp + " XP" }));
    });
  }
}

document.getElementById("cal-prev").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById("cal-next").addEventListener("click", () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
});

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

// ---------- Log in (email OR username) ----------
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorBox = document.getElementById("login-error");
  const identifier = document.getElementById("login-identifier").value.trim();
  const password = document.getElementById("login-password").value;
  errorBox.textContent = "";

  const button = loginForm.querySelector(".btn");
  button.disabled = true;

  const email = identifier.toLowerCase();

  if (!email) {
    button.disabled = false;
    errorBox.textContent = "Wrong email or password.";
    return;
  }

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
  if (name) openModal(name);
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
