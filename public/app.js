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

const els = {
  typeButtons: document.querySelectorAll(".type-btn"),
  form: document.getElementById("txForm"),
  amount: document.getElementById("amount"),
  reason: document.getElementById("reason"),
  submitBtn: document.getElementById("submitBtn"),
  formError: document.getElementById("formError"),
  txList: document.getElementById("txList"),
};

function fmt(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function setType(type) {
  currentType = type;
  els.typeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  els.submitBtn.textContent = type === "INCOME" ? "Add Income" : "Add Expense";
}

els.typeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setType(btn.dataset.type));
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
    document.getElementById(`${period}-net`).textContent = fmt(s.net);
    document.getElementById(`${period}-income`).textContent = fmt(s.income);
    document.getElementById(`${period}-expense`).textContent = fmt(s.expense);
  }
}

async function loadTransactions() {
  const rows = await api("/api/transactions?limit=30");
  els.txList.innerHTML = "";

  if (rows.length === 0) {
    els.txList.innerHTML = '<li class="tx-reason" style="color:var(--hint)">No entries yet.</li>';
    return;
  }

  for (const tx of rows) {
    const li = document.createElement("li");
    li.className = "tx-item";
    const date = new Date(tx.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const sign = tx.type === "INCOME" ? "+" : "-";
    const cls = tx.type === "INCOME" ? "income" : "expense";
    li.innerHTML = `
      <div>
        <span class="tx-reason">${escapeHtml(tx.reason)}</span>
        <span class="tx-date">${date}</span>
      </div>
      <div style="display:flex;align-items:center;">
        <span class="tx-amount ${cls}">${sign}${fmt(tx.amount)}</span>
        <button class="del-btn" data-id="${tx.id}" aria-label="Delete">✕</button>
      </div>
    `;
    els.txList.appendChild(li);
  }

  els.txList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/transactions/${btn.dataset.id}`, { method: "DELETE" });
      await refresh();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function refresh() {
  try {
    await Promise.all([loadSummary(), loadTransactions()]);
  } catch (err) {
    els.formError.textContent = err.message;
  }
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.formError.textContent = "";

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
  }
});

refresh();
