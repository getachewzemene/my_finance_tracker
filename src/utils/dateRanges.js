// Small helper: turns "week" | "month" | "year" into a start/end Date range.
// Week = current calendar week starting Monday. Month/year = calendar month/year.

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getRange(period, ref = new Date()) {
  const now = startOfDay(ref);

  if (period === "today") {
    const end = new Date(now);
    end.setDate(now.getDate() + 1);
    return { start: now, end };
  }

  if (period === "week") {
    const day = now.getDay(); // 0 = Sun ... 6 = Sat
    const diffToMonday = (day + 6) % 7; // days since most recent Monday
    const start = new Date(now);
    start.setDate(now.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }

  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear() + 1, 0, 1);
    return { start, end };
  }

  throw new Error(`Unknown period: ${period}`);
}

module.exports = { getRange };
