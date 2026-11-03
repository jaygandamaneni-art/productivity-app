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
let state = { xp: 0, habits: [], tasks: [] };
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
    state = { xp: 0, habits: [], tasks: [] };
    return;
  }

  if (data && data.data && data.data.habits && data.data.tasks) {
    state = data.data;
  } else {
    state = { xp: 0, habits: [], tasks: [] };
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
  const days = new Set();
  state.habits.forEach(h => h.doneDates.forEach(x => days.add(x)));
  state.tasks.forEach(t => { if (t.done && t.doneDate) days.add(t.doneDate); });
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

  document.getElementById("today-date").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("streak-count").textContent = overallStreak();

  const info = levelInfo(state.xp);
  document.getElementById("level-label").textContent = "Level " + info.level;
  document.getElementById("xp-text").textContent = `${info.remaining} / ${info.need} XP`;
  document.getElementById("xp-fill").style.width = (info.remaining / info.need) * 100 + "%";

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
  const confirm = document.getElementById("signup-confirm").value;
  errorBox.textContent = "";

  if (!validUsername(username)) {
    errorBox.textContent = "Username must be 3-20 characters: letters, numbers, or underscores.";
    return;
  }
  if (password.length < 6) {
    errorBox.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (password !== confirm) {
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
  state = { xp: 0, habits: [], tasks: [] };
  signupForm.reset();
  loginForm.reset();
  showAuth();
});

// ---------- Habit and task forms ----------
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

// ---------- Start: are they already logged in? ----------
(async function init() {
  const { data } = await db.auth.getSession();
  if (data.session) {
    await enterApp(data.session.user);
  } else {
    showAuth();
  }
})();

// END OF FILE
