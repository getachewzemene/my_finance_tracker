// Minimal vanilla-JS mini app: add income/expense with a reason,
// see weekly/monthly/yearly totals, see and delete recent entries.
//
// Auth: every API call sends the raw Telegram WebApp initData string in the
// X-Telegram-Init-Data header. The server verifies its signature and derives
// the user id from it — this page never tells the server "who I am" itself,
// so it can't be used to read or modify someone else's data.

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const initData = tg?.initData || "";

let currentType = "INCOME";
let activePeriod = "all";
let activeFilterType = "all";

const els = {
  typeButtons: document.querySelectorAll(".type-btn"),
  periodButtons: document.querySelectorAll(".period-filter [data-period]"),
  filterTypeButtons: document.querySelectorAll("[data-filter-type]"),
  reasonChips: document.querySelectorAll(".reason-chip"),
  form: document.getElementById("txForm"),
  amount: document.getElementById("amount"),
  reason: document.getElementById("reason"),
  submitBtn: document.getElementById("submitBtn"),
  formError: document.getElementById("formError"),
  txList: document.getElementById("txList"),
  todayLabel: document.getElementById("todayLabel"),
  txCount: document.getElementById("txCount"),
  periodLabel: document.getElementById("periodLabel"),
  resultCount: document.getElementById("resultCount"),
  resultNet: document.getElementById("resultNet"),
};

function fmt(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function setType(type) {
  currentType = type;
  els.typeButtons.forEach((btn) => {
    const selected = btn.dataset.type === type;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  els.submitBtn.textContent = type === "INCOME" ? "Add Income" : "Add Expense";
  els.submitBtn.classList.toggle("expense-submit", type === "EXPENSE");
}

els.typeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setType(btn.dataset.type));
});

function setSelected(buttons, attribute, value) {
  buttons.forEach((button) => {
    const selected = button.getAttribute(attribute) === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

const periodNames = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

els.periodButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    activePeriod = button.dataset.period;
    els.periodLabel.textContent = periodNames[activePeriod];
    setSelected(els.periodButtons, "data-period", activePeriod);
    await refreshTransactions();
  });
});

els.filterTypeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    activeFilterType = button.dataset.filterType;
    setSelected(els.filterTypeButtons, "data-filter-type", activeFilterType);
    await refreshTransactions();
  });
});

els.reasonChips.forEach((button) => {
  button.addEventListener("click", () => {
    els.reason.value = button.dataset.reason;
    els.reason.focus();
  });
});

async function api(path, options = {}) {
  if (!initData) {
    throw new Error("Open this page from inside Telegram to sign in.");
  }

  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new Error("Session expired — close and reopen the Mini App.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function loadSummary() {
  const data = await api("/api/summary/all");
  for (const period of ["week", "month", "year"]) {
    const s = data[period];
    const net = document.getElementById(`${period}-net`);
    net.textContent = fmt(s.net);
    net.classList.toggle("positive", s.net >= 0);
    net.classList.toggle("negative", s.net < 0);
    document.getElementById(`${period}-income`).textContent = fmt(s.income);
    document.getElementById(`${period}-expense`).textContent = fmt(s.expense);
  }
}

async function loadTransactions() {
  const params = new URLSearchParams({ period: activePeriod, limit: "200" });
  if (activeFilterType !== "all") params.set("type", activeFilterType);
  const rows = await api(`/api/transactions?${params}`);
  els.txList.innerHTML = "";
  const net = rows.reduce(
    (total, tx) => total + (tx.type === "INCOME" ? tx.amount : -tx.amount),
    0
  );
  const countText = `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`;
  els.resultCount.textContent = countText;
  els.txCount.textContent = rows.length ? `${countText} shown` : "No matching entries";
  els.resultNet.textContent = `${net > 0 ? "+" : ""}${fmt(net)}`;
  els.resultNet.classList.toggle("positive", net >= 0);
  els.resultNet.classList.toggle("negative", net < 0);

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    const emptyType = activeFilterType === "INCOME"
      ? "income"
      : activeFilterType === "EXPENSE"
        ? "expenses"
        : "entries";
    empty.textContent = activePeriod === "all" && activeFilterType === "all"
      ? "No entries yet. Add your first one above."
      : `No ${emptyType} for ${periodNames[activePeriod].toLowerCase()}.`;
    els.txList.appendChild(empty);
    return;
  }

  for (const tx of rows) {
    const li = document.createElement("li");
    li.className = "tx-item";
    const sign = tx.type === "INCOME" ? "+" : "-";
    const cls = tx.type === "INCOME" ? "income" : "expense";
    const details = document.createElement("div");
    const reason = document.createElement("span");
    reason.className = "tx-reason";
    reason.textContent = tx.reason;
    const date = document.createElement("span");
    date.className = "tx-date";
    date.textContent = new Date(tx.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    details.append(reason, date);

    const actions = document.createElement("div");
    actions.className = "tx-actions";
    const amount = document.createElement("span");
    amount.className = `tx-amount ${cls}`;
    amount.textContent = `${sign}${fmt(tx.amount)}`;
    const deleteButton = document.createElement("button");
    deleteButton.className = "del-btn";
    deleteButton.dataset.id = tx.id;
    deleteButton.setAttribute("aria-label", `Delete ${tx.reason}`);
    deleteButton.title = "Delete entry";
    deleteButton.textContent = "×";
    actions.append(amount, deleteButton);
    li.append(details, actions);
    els.txList.appendChild(li);
  }

  els.txList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api(`/api/transactions/${btn.dataset.id}`, { method: "DELETE" });
        await refresh();
      } catch (err) {
        els.formError.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

async function refreshTransactions() {
  els.formError.textContent = "";
  try {
    await loadTransactions();
  } catch (err) {
    els.formError.textContent = err.message;
  }
}

async function refresh() {
  try {
    await Promise.all([loadSummary(), loadTransactions()]);
  } catch (err) {
    els.formError.textContent = err.message;
  }
}

els.todayLabel.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.formError.textContent = "";
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = "Saving…";

  try {
    await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        type: currentType,
        amount: els.amount.value,
        reason: els.reason.value,
      }),
    });
    els.amount.value = "";
    els.reason.value = "";
    tg?.HapticFeedback?.notificationOccurred("success");
    await refresh();
  } catch (err) {
    els.formError.textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred("error");
  } finally {
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = currentType === "INCOME" ? "Add Income" : "Add Expense";
  }
});

refresh();
