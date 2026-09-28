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
let stockProducts = [];
let currencyCode = "ETB";
let categoriesByType = {
  INCOME: ["Salary", "Business", "Investment", "Gift", "Other"],
  EXPENSE: ["Food", "Transport", "Bills", "Housing", "Shopping", "Health", "Entertainment", "Other"],
};
let currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: currencyCode,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const els = {
  appTitle: document.getElementById("appTitle"),
  tabButtons: document.querySelectorAll("[data-tab]"),
  tabPanels: document.querySelectorAll("[data-tab-panel]"),
  stockTabButtons: document.querySelectorAll("[data-stock-tab]"),
  stockPanels: document.querySelectorAll("[data-stock-panel]"),
  typeButtons: document.querySelectorAll(".type-btn"),
  periodButtons: document.querySelectorAll(".period-filter [data-period]"),
  filterTypeButtons: document.querySelectorAll("[data-filter-type]"),
  reasonChips: document.querySelectorAll(".reason-chip"),
  form: document.getElementById("txForm"),
  amount: document.getElementById("amount"),
  reason: document.getElementById("reason"),
  category: document.getElementById("category"),
  categoryPeriod: document.getElementById("categoryPeriod"),
  categorySummary: document.getElementById("categorySummary"),
  budgetForm: document.getElementById("budgetForm"),
  budgetCategory: document.getElementById("budgetCategory"),
  budgetLimit: document.getElementById("budgetLimit"),
  budgetSubmit: document.getElementById("budgetSubmit"),
  budgetError: document.getElementById("budgetError"),
  budgetList: document.getElementById("budgetList"),
  submitBtn: document.getElementById("submitBtn"),
  formError: document.getElementById("formError"),
  txList: document.getElementById("txList"),
  todayLabel: document.getElementById("todayLabel"),
  currencyBadge: document.getElementById("currencyBadge"),
  amountLabel: document.querySelector('label[for="amount"]'),
  txCount: document.getElementById("txCount"),
  periodLabel: document.getElementById("periodLabel"),
  resultCount: document.getElementById("resultCount"),
  resultNet: document.getElementById("resultNet"),
  exportForm: document.getElementById("exportForm"),
  exportFrom: document.getElementById("exportFrom"),
  exportTo: document.getElementById("exportTo"),
  exportButton: document.getElementById("exportButton"),
  exportStatus: document.getElementById("exportStatus"),
  stockForm: document.getElementById("stockForm"),
  stockName: document.getElementById("stockName"),
  stockQuantity: document.getElementById("stockQuantity"),
  stockCost: document.getElementById("stockCost"),
  stockPrice: document.getElementById("stockPrice"),
  stockSubmit: document.getElementById("stockSubmit"),
  stockError: document.getElementById("stockError"),
  sellForm: document.getElementById("sellForm"),
  sellProduct: document.getElementById("sellProduct"),
  sellQuantity: document.getElementById("sellQuantity"),
  sellPrice: document.getElementById("sellPrice"),
  sellSubmit: document.getElementById("sellSubmit"),
  stockList: document.getElementById("stockList"),
  salesList: document.getElementById("salesList"),
  salesError: document.getElementById("salesError"),
  stockExportButton: document.getElementById("stockExportButton"),
  salesExportForm: document.getElementById("salesExportForm"),
  salesExportFrom: document.getElementById("salesExportFrom"),
  salesExportTo: document.getElementById("salesExportTo"),
  salesExportButton: document.getElementById("salesExportButton"),
  salesExportStatus: document.getElementById("salesExportStatus"),
};

function selectTab(tab, moveFocus = false) {
  els.tabButtons.forEach((button) => {
    const selected = button === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  els.tabPanels.forEach((panel) => {
    panel.hidden = panel.id !== tab.dataset.tab;
  });
  els.appTitle.textContent = tab.dataset.tab === "financeView" ? "My Finance" : "My Stock";
  if (moveFocus) tab.focus();
}

els.tabButtons.forEach((button, index) => {
  button.addEventListener("click", () => selectTab(button));
  button.addEventListener("keydown", (event) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % els.tabButtons.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + els.tabButtons.length - 1) % els.tabButtons.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = els.tabButtons.length - 1;
    else return;
    event.preventDefault();
    selectTab(els.tabButtons[nextIndex], true);
  });
});

function selectStockTab(tab, moveFocus = false) {
  els.stockTabButtons.forEach((button) => {
    const selected = button === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  els.stockPanels.forEach((panel) => {
    panel.hidden = panel.id !== tab.dataset.stockTab;
  });
  if (moveFocus) tab.focus();
}

els.stockTabButtons.forEach((button, index) => {
  button.addEventListener("click", () => selectStockTab(button));
  button.addEventListener("keydown", (event) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % els.stockTabButtons.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + els.stockTabButtons.length - 1) % els.stockTabButtons.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = els.stockTabButtons.length - 1;
    else return;
    event.preventDefault();
    selectStockTab(els.stockTabButtons[nextIndex], true);
  });
});

function fmt(n) {
  return currencyFormatter.format(Number(n));
}

function fmtPlain(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setCurrency(code) {
  if (code === currencyCode) return;
  currencyCode = code;
  currencyFormatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  els.currencyBadge.textContent = currencyCode;
  els.amount.placeholder = `Amount (${currencyCode})`;
  els.amountLabel.textContent = `Amount in ${currencyCode}`;
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
  const categories = categoriesByType[type] || ["Other"];
  const selectedCategory = els.category.value;
  els.category.replaceChildren(...categories.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    return option;
  }));
  els.category.value = categories.includes(selectedCategory) ? selectedCategory : "Other";
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

els.categoryPeriod.addEventListener("change", () => refreshCategorySummary());

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
  setCurrency(data.week.currencyCode);
  for (const period of ["week", "month", "year"]) {
    const s = data[period];
    const net = document.getElementById(`${period}-net`);
    net.textContent = fmtPlain(s.net);
    net.classList.toggle("positive", Number(s.net) >= 0);
    net.classList.toggle("negative", Number(s.net) < 0);
    document.getElementById(`${period}-income`).textContent = fmtPlain(s.income);
    document.getElementById(`${period}-expense`).textContent = fmtPlain(s.expense);
  }
}

async function loadCategorySummary() {
  const rows = await api(`/api/summary/categories?period=${els.categoryPeriod.value}`);
  els.categorySummary.replaceChildren();

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "report-empty";
    empty.textContent = "No categorized entries for this period yet.";
    els.categorySummary.appendChild(empty);
    return;
  }

  const maximum = Math.max(...rows.map((row) => Number(row.amount)), 0);
  const list = document.createElement("div");
  list.className = "category-rows";

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "category-row";
    const heading = document.createElement("div");
    heading.className = "category-row-heading";
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = row.category;
    const type = document.createElement("span");
    type.className = `category-kind ${row.type === "INCOME" ? "income" : "expense"}`;
    type.textContent = row.type === "INCOME" ? "Income" : "Expense";
    const amount = document.createElement("strong");
    amount.className = `category-amount ${row.type === "INCOME" ? "income" : "expense"}`;
    amount.textContent = fmt(row.amount);
    heading.append(name, type, amount);

    const track = document.createElement("div");
    track.className = "category-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = `category-fill ${row.type === "INCOME" ? "income" : "expense"}`;
    fill.style.width = `${maximum ? Math.max(3, Number(row.amount) / maximum * 100) : 0}%`;
    track.appendChild(fill);
    item.append(heading, track);
    list.appendChild(item);
  }

  els.categorySummary.appendChild(list);
}

async function loadAppConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const config = await res.json();
    if (config.currencyCode) setCurrency(config.currencyCode);
    if (config.categories) categoriesByType = config.categories;
  } catch {
    // Keep the fallback category until configuration is reachable.
  }
  setType(currentType);
  const categories = categoriesByType.EXPENSE || ["Other"];
  const selectedCategory = els.budgetCategory.value;
  els.budgetCategory.replaceChildren(...categories.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    return option;
  }));
  els.budgetCategory.value = categories.includes(selectedCategory) ? selectedCategory : categories[0];
}

async function loadBudgets() {
  const budgets = await api("/api/budgets");
  els.budgetList.replaceChildren();

  if (budgets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "report-empty";
    empty.textContent = "No budgets yet. Set a monthly cap for an expense category.";
    els.budgetList.appendChild(empty);
    return;
  }

  for (const budget of budgets) {
    const row = document.createElement("div");
    row.className = "budget-row";
    const heading = document.createElement("div");
    heading.className = "budget-row-heading";
    const category = document.createElement("strong");
    category.className = "budget-name";
    category.textContent = budget.category;
    const percent = Number(budget.percent);
    const status = document.createElement("span");
    status.className = `budget-percent ${percent >= 100 ? "over" : percent >= 80 ? "warning" : ""}`;
    status.textContent = `${Math.round(percent)}%`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "budget-remove";
    remove.dataset.category = budget.category;
    remove.setAttribute("aria-label", `Remove ${budget.category} budget`);
    remove.title = "Remove budget";
    remove.textContent = "×";
    heading.append(category, status, remove);

    const values = document.createElement("div");
    values.className = "budget-values";
    const spent = document.createElement("span");
    spent.textContent = `${fmt(budget.spent)} spent of ${fmt(budget.monthlyLimit)}`;
    const remaining = document.createElement("span");
    const remainingAmount = Number(budget.remaining);
    remaining.textContent = remainingAmount >= 0
      ? `${fmt(remainingAmount)} left`
      : `${fmt(Math.abs(remainingAmount))} over`;
    remaining.className = remainingAmount < 0 ? "over" : "";
    values.append(spent, remaining);

    const track = document.createElement("div");
    track.className = "budget-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${budget.category} monthly budget used`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.min(100, Math.max(0, percent))));
    const fill = document.createElement("span");
    fill.className = `budget-fill ${percent >= 100 ? "over" : percent >= 80 ? "warning" : ""}`;
    fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    track.appendChild(fill);
    row.append(heading, values, track);
    els.budgetList.appendChild(row);
  }

  els.budgetList.querySelectorAll(".budget-remove").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/budgets/${encodeURIComponent(button.dataset.category)}`, { method: "DELETE" });
        await loadBudgets();
      } catch (err) {
        els.budgetError.textContent = err.message;
        button.disabled = false;
      }
    });
  });
}

async function loadStock() {
  try {
    const [products, sales, summaries] = await Promise.all([
      api("/api/products"),
      api("/api/sales"),
      api("/api/sales/summary"),
    ]);
    stockProducts = products;
    const selectedProduct = els.sellProduct.value;
    els.sellProduct.replaceChildren();
    if (products.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Add a product first";
      els.sellProduct.appendChild(option);
    } else {
      for (const product of products) {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = `${product.name} (${product.quantity} in stock${product.unitCost === null ? ", set cost first" : ""})`;
        option.disabled = product.quantity < 1 || product.unitCost === null;
        els.sellProduct.appendChild(option);
      }
      if (products.some((product) => String(product.id) === selectedProduct && product.quantity > 0 && product.unitCost !== null)) {
        els.sellProduct.value = selectedProduct;
      }
    }
    els.sellSubmit.disabled = !products.some((product) => product.quantity > 0 && product.unitCost !== null);
    updateSalePrice();

    for (const period of ["today", "week", "month", "year"]) {
      const summary = summaries[period];
      document.getElementById(`sales-${period}-total`).textContent = fmt(summary.totalSales);
      document.getElementById(`sales-${period}-profit`).textContent = fmt(summary.profit);
    }

    els.stockList.replaceChildren();
    if (products.length === 0) {
      const empty = document.createElement("p");
      empty.className = "report-empty";
      empty.textContent = "No products yet. Add your first item above.";
      els.stockList.appendChild(empty);
    }
    for (const product of products) {
      const row = document.createElement("div");
      row.className = "stock-row";
      const details = document.createElement("div");
      details.className = "stock-details";
      const name = document.createElement("strong");
      name.className = "stock-name";
      name.textContent = product.name;
      const meta = document.createElement("span");
      meta.className = `stock-meta${product.quantity === 0 ? " out-of-stock" : ""}`;
      meta.textContent = `${product.quantity} in stock · Cost ${product.unitCost === null ? "not set" : fmt(product.unitCost)} · Sell ${fmt(product.unitPrice)}`;
      details.append(name, meta);

      const controls = document.createElement("div");
      controls.className = "stock-controls";
      const pricing = document.createElement("form");
      pricing.className = "stock-pricing-form";
      pricing.dataset.productId = product.id;
      const costInput = document.createElement("input");
      costInput.type = "number";
      costInput.name = "unitCost";
      costInput.min = "0.01";
      costInput.max = "999999999999.99";
      costInput.step = "0.01";
      costInput.placeholder = "Cost / item";
      costInput.setAttribute("aria-label", `Cost per item for ${product.name}`);
      costInput.value = product.unitCost === null ? "" : Number(product.unitCost).toFixed(2);
      costInput.required = true;
      const priceInput = document.createElement("input");
      priceInput.type = "number";
      priceInput.name = "unitPrice";
      priceInput.min = "0.01";
      priceInput.max = "999999999999.99";
      priceInput.step = "0.01";
      priceInput.placeholder = "Sell / item";
      priceInput.setAttribute("aria-label", `Selling price per item for ${product.name}`);
      priceInput.value = Number(product.unitPrice).toFixed(2);
      priceInput.required = true;
      const savePrices = document.createElement("button");
      savePrices.type = "submit";
      savePrices.textContent = "Save prices";
      pricing.append(costInput, priceInput, savePrices);

      const restock = document.createElement("form");
      restock.className = "stock-restock-form";
      restock.dataset.productId = product.id;
      const input = document.createElement("input");
      input.type = "number";
      input.name = "quantity";
      input.min = "1";
      input.max = "1000000000";
      input.step = "1";
      input.placeholder = "+ Qty";
      input.setAttribute("aria-label", `Quantity to add to ${product.name}`);
      input.required = true;
      const restockCost = document.createElement("input");
      restockCost.type = "number";
      restockCost.name = "unitCost";
      restockCost.min = "0.01";
      restockCost.max = "999999999999.99";
      restockCost.step = "0.01";
      restockCost.placeholder = "Cost / item";
      restockCost.setAttribute("aria-label", `Purchase cost per restocked ${product.name}`);
      restockCost.required = true;
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Restock";
      restock.append(input, restockCost, button);
      controls.append(pricing, restock);
      row.append(details, controls);
      els.stockList.appendChild(row);
    }

    els.salesList.replaceChildren();
    if (sales.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "Sales will appear here.";
      els.salesList.appendChild(empty);
    }
    for (const sale of sales) {
      const item = document.createElement("li");
      item.className = "stock-sale-row";
      const details = document.createElement("div");
      details.className = "sale-details";
      const name = document.createElement("strong");
      name.textContent = sale.product.name;
      const meta = document.createElement("span");
      meta.textContent = `${sale.quantity} sold at ${fmt(sale.unitPrice)} · ${new Date(sale.createdAt).toLocaleDateString()}`;
      details.append(name, meta);
      const amounts = document.createElement("div");
      amounts.className = "sale-amounts";
      const total = document.createElement("strong");
      total.textContent = fmt(sale.total);
      const profit = document.createElement("span");
      profit.className = Number(sale.profit) >= 0 ? "positive" : "negative";
      profit.textContent = `Profit ${fmt(sale.profit)}`;
      amounts.append(total, profit);
      item.append(details, amounts);
      els.salesList.appendChild(item);
    }

    els.stockList.querySelectorAll(".stock-restock-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        button.disabled = true;
        try {
          await api(`/api/products/${form.dataset.productId}/restock`, {
            method: "POST",
            body: JSON.stringify({
              quantity: form.elements.quantity.value,
              unitCost: form.elements.unitCost.value,
            }),
          });
          els.stockError.textContent = "";
          await loadStock();
        } catch (err) {
          els.stockError.textContent = err.message;
          button.disabled = false;
        }
      });
    });

    els.stockList.querySelectorAll(".stock-pricing-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        button.disabled = true;
        try {
          await api(`/api/products/${form.dataset.productId}/pricing`, {
            method: "PATCH",
            body: JSON.stringify({
              unitCost: form.elements.unitCost.value,
              unitPrice: form.elements.unitPrice.value,
            }),
          });
          els.stockError.textContent = "";
          await loadStock();
        } catch (err) {
          els.stockError.textContent = err.message;
          button.disabled = false;
        }
      });
    });
  } catch (err) {
    els.stockError.textContent = err.message;
    els.salesError.textContent = err.message;
  }
}

function updateSalePrice() {
  const product = stockProducts.find((item) => String(item.id) === els.sellProduct.value);
  if (product) els.sellPrice.value = Number(product.unitPrice).toFixed(2);
}

els.sellProduct.addEventListener("change", updateSalePrice);

async function loadTransactions() {
  const params = new URLSearchParams({ period: activePeriod, limit: "200" });
  if (activeFilterType !== "all") params.set("type", activeFilterType);
  const rows = await api(`/api/transactions?${params}`);
  els.txList.innerHTML = "";
  const netMinor = rows.reduce(
    (total, tx) => total + Math.round(Number(tx.amount) * 100) * (tx.type === "INCOME" ? 1 : -1),
    0
  );
  const countText = `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`;
  els.resultCount.textContent = countText;
  els.txCount.textContent = rows.length ? `${countText} shown` : "No matching entries";
  els.resultNet.textContent = `${netMinor > 0 ? "+" : ""}${fmt((netMinor / 100).toFixed(2))}`;
  els.resultNet.classList.toggle("positive", netMinor >= 0);
  els.resultNet.classList.toggle("negative", netMinor < 0);

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

async function refreshCategorySummary() {
  try {
    await loadCategorySummary();
  } catch (err) {
    els.categorySummary.replaceChildren();
    const message = document.createElement("p");
    message.className = "report-empty";
    message.textContent = err.message;
    els.categorySummary.appendChild(message);
  }
}

async function refresh() {
  try {
    await Promise.all([loadSummary(), loadTransactions(), loadCategorySummary(), loadBudgets(), loadStock()]);
  } catch (err) {
    els.formError.textContent = err.message;
  }
}

els.todayLabel.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function toLocalDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const exportToday = new Date();
els.exportFrom.value = toLocalDateInputValue(new Date(exportToday.getFullYear(), exportToday.getMonth(), 1));
els.exportTo.value = toLocalDateInputValue(exportToday);
els.salesExportFrom.value = els.exportFrom.value;
els.salesExportTo.value = els.exportTo.value;

function dateRangeQuery(from, to) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDateExclusive = new Date(`${to}T00:00:00`);
  toDateExclusive.setDate(toDateExclusive.getDate() + 1);
  return new URLSearchParams({
    from,
    to,
    fromOffset: String(fromDate.getTimezoneOffset()),
    toOffset: String(toDateExclusive.getTimezoneOffset()),
  });
}

async function downloadCsv(url, filename) {
  if (!initData) throw new Error("Open this page from inside Telegram to sign in.");
  const response = await fetch(url, { headers: { "X-Telegram-Init-Data": initData } });
  if (response.status === 401) throw new Error("Session expired — close and reopen the Mini App.");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Export failed (${response.status})`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

els.stockExportButton.addEventListener("click", async () => {
  els.stockError.textContent = "";
  els.stockExportButton.disabled = true;
  try {
    await downloadCsv("/api/products/export.csv", "stock-inventory.csv");
    els.stockError.textContent = "Stock CSV downloaded.";
  } catch (err) {
    els.stockError.textContent = err.message;
  } finally {
    els.stockExportButton.disabled = false;
  }
});

els.salesExportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.salesExportStatus.textContent = "";
  const from = els.salesExportFrom.value;
  const to = els.salesExportTo.value;
  if (!from || !to || from > to) {
    els.salesExportStatus.textContent = "Choose a valid date range.";
    return;
  }

  els.salesExportButton.disabled = true;
  try {
    const params = dateRangeQuery(from, to);
    await downloadCsv(`/api/sales/export.csv?${params}`, `sales-${from}-to-${to}.csv`);
    els.salesExportStatus.textContent = "Sales CSV downloaded.";
  } catch (err) {
    els.salesExportStatus.textContent = err.message;
  } finally {
    els.salesExportButton.disabled = false;
  }
});

els.exportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.exportStatus.textContent = "";
  const from = els.exportFrom.value;
  const to = els.exportTo.value;
  if (!from || !to || from > to) {
    els.exportStatus.textContent = "Choose a valid date range.";
    return;
  }

  const fromDate = new Date(`${from}T00:00:00`);
  const toDateExclusive = new Date(`${to}T00:00:00`);
  toDateExclusive.setDate(toDateExclusive.getDate() + 1);
  const params = new URLSearchParams({
    from,
    to,
    fromOffset: String(fromDate.getTimezoneOffset()),
    toOffset: String(toDateExclusive.getTimezoneOffset()),
  });

  els.exportButton.disabled = true;
  els.exportButton.textContent = "Preparing...";
  try {
    if (!initData) throw new Error("Open this page from inside Telegram to sign in.");
    const response = await fetch(`/api/transactions/export.csv?${params}`, {
      headers: { "X-Telegram-Init-Data": initData },
    });
    if (response.status === 401) throw new Error("Session expired — close and reopen the Mini App.");
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Export failed (${response.status})`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `transactions-${from}-to-${to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    els.exportStatus.textContent = "CSV downloaded.";
  } catch (err) {
    els.exportStatus.textContent = err.message;
  } finally {
    els.exportButton.disabled = false;
    els.exportButton.textContent = "Export CSV";
  }
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
        category: els.category.value,
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

els.budgetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.budgetError.textContent = "";
  els.budgetSubmit.disabled = true;
  els.budgetSubmit.textContent = "Saving...";

  try {
    await api("/api/budgets", {
      method: "POST",
      body: JSON.stringify({
        category: els.budgetCategory.value,
        monthlyLimit: els.budgetLimit.value,
      }),
    });
    els.budgetLimit.value = "";
    await loadBudgets();
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch (err) {
    els.budgetError.textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred("error");
  } finally {
    els.budgetSubmit.disabled = false;
    els.budgetSubmit.textContent = "Save budget";
  }
});

els.stockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.stockError.textContent = "";
  els.stockSubmit.disabled = true;
  try {
    await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: els.stockName.value,
        quantity: els.stockQuantity.value,
        unitCost: els.stockCost.value,
        unitPrice: els.stockPrice.value,
      }),
    });
    els.stockForm.reset();
    await loadStock();
  } catch (err) {
    els.stockError.textContent = err.message;
  } finally {
    els.stockSubmit.disabled = false;
  }
});

els.sellForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.stockError.textContent = "";
  els.sellSubmit.disabled = true;
  try {
    await api(`/api/products/${els.sellProduct.value}/sales`, {
      method: "POST",
      body: JSON.stringify({ quantity: els.sellQuantity.value, unitPrice: els.sellPrice.value }),
    });
    els.sellQuantity.value = "";
    els.salesError.textContent = "";
    tg?.HapticFeedback?.notificationOccurred("success");
    await refresh();
  } catch (err) {
    els.salesError.textContent = err.message;
    tg?.HapticFeedback?.notificationOccurred("error");
  } finally {
    els.sellSubmit.disabled = !Array.from(els.sellProduct.options).some((option) => option.value && !option.disabled);
  }
});

setType(currentType);
loadAppConfig().then(refresh);
