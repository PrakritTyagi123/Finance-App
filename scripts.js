/* ============================================================
   KHATA — Personal Finance App
   Vanilla JS · No dependencies · Mobile-aware
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     CONSTANTS
     ============================================================ */
  const CATEGORIES = {
    expense: [
      { name: 'Food',          icon: '🍛', color: '#B23A2E' },
      { name: 'Groceries',     icon: '🛒', color: '#7E8E3D' },
      { name: 'Transport',     icon: '🛺', color: '#D9A02B' },
      { name: 'Shopping',      icon: '🛍️', color: '#A55C9F' },
      { name: 'Entertainment', icon: '🎬', color: '#C76A8A' },
      { name: 'Bills',         icon: '🧾', color: '#3D7A8E' },
      { name: 'Health',        icon: '🏥', color: '#5C9C7A' },
      { name: 'Education',     icon: '📚', color: '#4B6FA5' },
      { name: 'Travel',        icon: '✈️', color: '#D9602B' },
      { name: 'Rent',          icon: '🏠', color: '#8B5A3C' },
      { name: 'Other',         icon: '◇',  color: '#6B6259' }
    ],
    income: [
      { name: 'Salary',     icon: '💼', color: '#2F6E3F' },
      { name: 'Freelance',  icon: '💻', color: '#3D7A8E' },
      { name: 'Investment', icon: '📈', color: '#6B4F8C' },
      { name: 'Gift',       icon: '🎁', color: '#C76A8A' },
      { name: 'Refund',     icon: '↩️', color: '#5C9C7A' },
      { name: 'Other',      icon: '◇',  color: '#6B6259' }
    ]
  };

  const ACCOUNT_ICONS = {
    bank:   '🏦',
    wallet: '💳',
    cash:   '💵'
  };

  /* ============================================================
     UTILITIES
     ============================================================ */

  // Indian number formatting: 1,23,456.78 (lakhs/crores)
  const fmtINR = (n, opts = {}) => {
    const showDecimals = opts.decimals !== false;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString('en-IN', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0
    });
    return sign + '₹' + formatted;
  };

  // Short form: ₹12.5K, ₹1.2L, ₹2.3Cr
  const fmtINRShort = (n) => {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 10_000_000) return sign + '₹' + (abs / 10_000_000).toFixed(2) + ' Cr';
    if (abs >= 100_000)    return sign + '₹' + (abs / 100_000).toFixed(2) + ' L';
    if (abs >= 1_000)      return sign + '₹' + (abs / 1_000).toFixed(1) + 'K';
    return sign + '₹' + Math.round(abs);
  };

  // Hero number — no symbol (symbol is rendered separately)
  const fmtHeroNumber = (n) => {
    return Math.round(n).toLocaleString('en-IN');
  };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const timeAgo = (ts) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 10) return 'just now';
    if (diff < 60) return diff + 's';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    const d = new Date(ts);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const startOfDay = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const startOfMonth = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const findCategory = (name, type) => {
    const list = CATEGORIES[type] || [];
    return list.find(c => c.name === name) || { name, icon: '◇', color: '#6B6259' };
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  /* ============================================================
     SQLITE DATABASE (sql.js / WebAssembly)
     ============================================================ */
  const DB_FILE_NAME = 'khata-finance.db';
  const SQL_WASM_URL = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';

  let SQL;
  let db;

  const parseJsonArray = (value) => {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  const queryRows = (sql, params = []) => {
    const stmt = db.prepare(sql);
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  };

  const queryOne = (sql, params = []) => queryRows(sql, params)[0] || null;

  const execute = (sql, params = []) => {
    const stmt = db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  };

  const mapAccountRow = (row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    balance: Number(row.balance) || 0,
    minBalance: Number(row.minBalance) || 0,
    createdAt: Number(row.createdAt) || 0
  });

  const mapTransactionRow = (row) => ({
    id: row.id,
    type: row.type,
    amount: Number(row.amount) || 0,
    category: row.category,
    accountId: row.accountId,
    tags: parseJsonArray(row.tags),
    note: row.note || '',
    timestamp: Number(row.timestamp) || 0,
    flagged: Boolean(row.flagged),
    flagReasons: parseJsonArray(row.flagReasons)
  });

  async function initDb(databaseFile) {
    if (!SQL) {
      if (typeof initSqlJs !== 'function') {
        throw new Error('sql.js failed to load. Check your network connection and reload.');
      }
      SQL = await initSqlJs({ locateFile: file => SQL_WASM_URL + file });
    }

    db = databaseFile ? new SQL.Database(databaseFile) : new SQL.Database();
    db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        minBalance REAL NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        amount REAL NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL,
        accountId TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        flagged INTEGER NOT NULL DEFAULT 0,
        flagReasons TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
      CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
      CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(accountId);

      CREATE TABLE IF NOT EXISTS budgets (
        category TEXT PRIMARY KEY,
        limitAmount REAL NOT NULL CHECK (limitAmount > 0)
      );
    `);
    return db;
  }

  const DatabaseFiles = {
    save() {
      if (!db) return;
      const bytes = db.export();
      const blob = new Blob([bytes], { type: 'application/vnd.sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = DB_FILE_NAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      Toast.show('SQLite database saved to file', 'success');
    },

    async load(file) {
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await initDb(bytes);
      State.hydrate();
      Insights.generate();
      UI.render();
      Toast.show(`Loaded ${file.name}`, 'success');
    },

    reset() {
      db.run(`
        DELETE FROM transactions;
        DELETE FROM budgets;
        DELETE FROM accounts;
      `);
      State.hydrate();
    }
  };

  /* ============================================================
     STATE
     ============================================================ */
  const State = {
    accounts: [],
    transactions: [],
    budgets: {},
    insights: [],
    filters: { type: '', category: '', account: '', search: '', tag: '' },
    activeView: 'overview',

    hydrate() {
      this.accounts = queryRows('SELECT * FROM accounts ORDER BY createdAt ASC').map(mapAccountRow);
      this.transactions = queryRows('SELECT * FROM transactions ORDER BY timestamp DESC, id DESC').map(mapTransactionRow);
      this.budgets = Object.fromEntries(
        queryRows('SELECT category, limitAmount FROM budgets ORDER BY category ASC')
          .map(row => [row.category, Number(row.limitAmount) || 0])
      );
    }
  };

  /* ============================================================
     ACCOUNTS
     ============================================================ */
  const Accounts = {
    create({ name, type, balance, minBalance }) {
      const acc = {
        id: uid(),
        name: name.trim(),
        type,
        balance: Number(balance) || 0,
        minBalance: Number(minBalance) || 0,
        createdAt: Date.now()
      };
      execute(
        `INSERT INTO accounts (id, name, type, balance, minBalance, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [acc.id, acc.name, acc.type, acc.balance, acc.minBalance, acc.createdAt]
      );
      State.hydrate();
      return acc;
    },
    update(id, patch) {
      const existing = this.getById(id);
      if (!existing) return null;
      const next = { ...existing, ...patch };
      execute(
        `UPDATE accounts
         SET name = ?, type = ?, balance = ?, minBalance = ?
         WHERE id = ?`,
        [next.name.trim(), next.type, Number(next.balance) || 0, Number(next.minBalance) || 0, id]
      );
      State.hydrate();
      return this.getById(id);
    },
    delete(id) {
      execute('DELETE FROM accounts WHERE id = ?', [id]);
      State.hydrate();
    },
    getById(id) {
      const row = queryOne('SELECT * FROM accounts WHERE id = ?', [id]);
      return row ? mapAccountRow(row) : null;
    },
    isLow(acc) { return acc.minBalance > 0 && acc.balance < acc.minBalance; },
    isNear(acc) { return acc.minBalance > 0 && !this.isLow(acc) && acc.balance < acc.minBalance * 1.25; },
    healthRatio(acc) {
      if (acc.balance <= 0) return 0;
      const target = Math.max(acc.minBalance * 4, acc.balance);
      return clamp(acc.balance / target, 0, 1);
    }
  };

  /* ============================================================
     TRANSACTIONS
     ============================================================ */
  const Transactions = {
    add({ type, amount, category, accountId, tags = [], note = '' }) {
      const account = Accounts.getById(accountId);
      if (!account) return null;
      const tx = {
        id: uid(),
        type,
        amount: Number(amount),
        category,
        accountId,
        tags: tags.filter(Boolean),
        note: note.trim(),
        timestamp: Date.now(),
        flagged: false,
        flagReasons: []
      };

      const flags = FraudDetector.check(tx);
      if (flags.length) { tx.flagged = true; tx.flagReasons = flags; }

      db.run('BEGIN TRANSACTION');
      try {
        execute(
          `INSERT INTO transactions
           (id, type, amount, category, accountId, tags, note, timestamp, flagged, flagReasons)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tx.id, tx.type, tx.amount, tx.category, tx.accountId,
            JSON.stringify(tx.tags), tx.note, tx.timestamp,
            tx.flagged ? 1 : 0, JSON.stringify(tx.flagReasons)
          ]
        );
        execute(
          `UPDATE accounts
           SET balance = balance + ?
           WHERE id = ?`,
          [tx.type === 'income' ? tx.amount : -tx.amount, tx.accountId]
        );
        db.run(`
          DELETE FROM transactions
          WHERE id NOT IN (
            SELECT id FROM transactions ORDER BY timestamp DESC, id DESC LIMIT 1000
          )
        `);
        db.run('COMMIT');
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }

      State.hydrate();
      return tx;
    },
    delete(id) {
      const tx = queryOne('SELECT * FROM transactions WHERE id = ?', [id]);
      if (!tx) return;
      const amount = Number(tx.amount) || 0;
      db.run('BEGIN TRANSACTION');
      try {
        execute(
          `UPDATE accounts
           SET balance = balance + ?
           WHERE id = ?`,
          [tx.type === 'income' ? -amount : amount, tx.accountId]
        );
        execute('DELETE FROM transactions WHERE id = ?', [id]);
        db.run('COMMIT');
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }
      State.hydrate();
    },
    filtered() {
      const f = State.filters;
      const where = [];
      const params = [];
      const search = f.search.trim().toLowerCase();

      if (f.type) { where.push('type = ?'); params.push(f.type); }
      if (f.category) { where.push('category = ?'); params.push(f.category); }
      if (f.account) { where.push('accountId = ?'); params.push(f.account); }
      if (f.tag) { where.push('LOWER(tags) LIKE ?'); params.push(`%"${f.tag.toLowerCase()}"%`); }
      if (search) {
        where.push('(LOWER(category) LIKE ? OR LOWER(note) LIKE ? OR LOWER(tags) LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const sql = `
        SELECT * FROM transactions
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY timestamp DESC, id DESC
      `;
      return queryRows(sql, params).map(mapTransactionRow);
    },
    count() {
      return Number(queryOne('SELECT COUNT(*) AS count FROM transactions')?.count) || 0;
    },
    recent(limit = 5) {
      return queryRows('SELECT * FROM transactions ORDER BY timestamp DESC, id DESC LIMIT ?', [limit]).map(mapTransactionRow);
    },
    totalsThisMonth() {
      const ms = startOfMonth();
      const row = queryOne(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE timestamp >= ?`,
        [ms]
      );
      const income = Number(row?.income) || 0;
      const expense = Number(row?.expense) || 0;
      return { income, expense, net: income - expense };
    },
    byCategoryThisMonth(type = 'expense') {
      const ms = startOfMonth();
      return Object.fromEntries(
        queryRows(
          `SELECT category, SUM(amount) AS total
           FROM transactions
           WHERE type = ? AND timestamp >= ?
           GROUP BY category
           ORDER BY total DESC`,
          [type, ms]
        ).map(row => [row.category, Number(row.total) || 0])
      );
    },
    last14Days() {
      const days = 14;
      const today = startOfDay(Date.now());
      const firstDay = today - (days - 1) * 86400000;
      const buckets = [];
      const byDay = new Map();
      for (let i = days - 1; i >= 0; i--) {
        const bucket = { day: today - i * 86400000, income: 0, expense: 0 };
        buckets.push(bucket);
        byDay.set(bucket.day, bucket);
      }

      queryRows(
        `SELECT
           ((timestamp / 86400000) * 86400000) AS day,
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE timestamp >= ?
         GROUP BY day
         ORDER BY day ASC`,
        [firstDay]
      ).forEach(row => {
        const day = Number(row.day);
        const bucket = byDay.get(day);
        if (bucket) {
          bucket.income = Number(row.income) || 0;
          bucket.expense = Number(row.expense) || 0;
        }
      });
      return buckets;
    },
    dailyAverage30Days() {
      const cutoff = Date.now() - 30 * 86400000;
      const row = queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
         WHERE type = 'expense' AND timestamp >= ?`,
        [cutoff]
      );
      return (Number(row?.total) || 0) / 30;
    },
    allTags() {
      const map = {};
      queryRows('SELECT tags FROM transactions WHERE tags <> ? ORDER BY timestamp DESC', ['[]'])
        .forEach(row => parseJsonArray(row.tags).forEach(tag => { map[tag] = (map[tag] || 0) + 1; }));
      return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 16).map(e => e[0]);
    }
  };

  /* ============================================================
     BUDGETS
     ============================================================ */
  const Budgets = {
    set(category, limit) {
      const v = Number(limit);
      if (!category || !v || v <= 0) return;
      execute(
        `INSERT INTO budgets (category, limitAmount)
         VALUES (?, ?)
         ON CONFLICT(category) DO UPDATE SET limitAmount = excluded.limitAmount`,
        [category, v]
      );
      State.hydrate();
    },
    remove(category) {
      execute('DELETE FROM budgets WHERE category = ?', [category]);
      State.hydrate();
    },
    spent(category) {
      const ms = startOfMonth();
      const row = queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
         WHERE type = 'expense' AND category = ? AND timestamp >= ?`,
        [category, ms]
      );
      return Number(row?.total) || 0;
    },
    status(category) {
      const limit = State.budgets[category] || 0;
      const used = this.spent(category);
      const pct = limit > 0 ? (used / limit) * 100 : 0;
      let level = 'safe';
      if (pct >= 100) level = 'danger';
      else if (pct >= 80) level = 'warn';
      return { limit, used, pct, level };
    }
  };

  /* ============================================================
     FRAUD / ANOMALY DETECTOR
     ============================================================ */
  const FraudDetector = {
    check(tx) {
      const reasons = [];
      if (tx.type !== 'expense') return reasons;

      const expenses = State.transactions.filter(t => t.type === 'expense');
      if (expenses.length >= 6) {
        const avg = expenses.reduce((s, t) => s + t.amount, 0) / expenses.length;
        if (tx.amount > avg * 3 && tx.amount > 1000) {
          reasons.push('3× larger than your average');
        }
      }
      // Rapid-fire transactions
      const recent = State.transactions.filter(t => Date.now() - t.timestamp < 120_000);
      if (recent.length >= 5) {
        reasons.push('Multiple transactions in 2 mins');
      }
      return reasons;
    }
  };

  /* ============================================================
     INSIGHTS
     ============================================================ */
  const Insights = {
    generate() {
      const out = [];
      const now = Date.now();

      // Need at least some data
      if (!State.accounts.length && !State.transactions.length) {
        State.insights = [];
        return;
      }

      // 1. Low / near-low balance accounts
      State.accounts.forEach(acc => {
        if (Accounts.isLow(acc)) {
          out.push({
            id: 'low-' + acc.id,
            priority: 'critical',
            text: `${acc.name} is below your minimum balance`,
            timestamp: now
          });
        } else if (Accounts.isNear(acc)) {
          out.push({
            id: 'near-' + acc.id,
            priority: 'warning',
            text: `${acc.name} is approaching minimum balance`,
            timestamp: now
          });
        }
      });

      // 2. Recently flagged
      const flagged = State.transactions.filter(t => t.flagged && now - t.timestamp < 3600_000);
      if (flagged.length) {
        out.push({
          id: 'flag',
          priority: 'warning',
          text: `${flagged.length} unusual transaction${flagged.length > 1 ? 's' : ''} flagged in the last hour`,
          timestamp: flagged[0].timestamp
        });
      }

      // 3. Week-over-week category growth
      const weekAgo = now - 7 * 86400000;
      const twoWeeksAgo = now - 14 * 86400000;
      const thisWeek = {};
      const prevWeek = {};
      State.transactions.forEach(t => {
        if (t.type !== 'expense') return;
        if (t.timestamp >= weekAgo) thisWeek[t.category] = (thisWeek[t.category] || 0) + t.amount;
        else if (t.timestamp >= twoWeeksAgo) prevWeek[t.category] = (prevWeek[t.category] || 0) + t.amount;
      });
      Object.keys(thisWeek).forEach(cat => {
        const tw = thisWeek[cat], pw = prevWeek[cat] || 0;
        if (pw > 0 && tw > pw * 1.4) {
          const pct = Math.round(((tw - pw) / pw) * 100);
          out.push({
            id: 'cat-up-' + cat,
            priority: pct > 75 ? 'warning' : 'info',
            text: `${cat} spending up ${pct}% this week (${fmtINRShort(tw)} vs ${fmtINRShort(pw)})`,
            timestamp: now
          });
        }
      });

      // 4. Budget alerts
      Object.keys(State.budgets).forEach(cat => {
        const s = Budgets.status(cat);
        if (s.level === 'danger') {
          out.push({
            id: 'budget-' + cat,
            priority: 'critical',
            text: `${cat} budget exceeded — ${fmtINRShort(s.used)} of ${fmtINRShort(s.limit)}`,
            timestamp: now
          });
        } else if (s.level === 'warn') {
          out.push({
            id: 'budget-w-' + cat,
            priority: 'warning',
            text: `${cat} budget at ${Math.round(s.pct)}% used`,
            timestamp: now
          });
        }
      });

      // 5. Savings rate (only if there's income this month)
      const totals = Transactions.totalsThisMonth();
      if (totals.income > 0) {
        const rate = ((totals.income - totals.expense) / totals.income) * 100;
        if (rate >= 30) {
          out.push({
            id: 'save-good',
            priority: 'info',
            text: `Strong month — saving ${rate.toFixed(0)}% of income so far`,
            timestamp: now
          });
        } else if (rate < 0) {
          out.push({
            id: 'save-bad',
            priority: 'critical',
            text: `Spending exceeds income by ${fmtINRShort(Math.abs(totals.net))} this month`,
            timestamp: now
          });
        }
      }

      const order = { critical: 0, warning: 1, info: 2 };
      out.sort((a, b) => (order[a.priority] - order[b.priority]) || (b.timestamp - a.timestamp));
      State.insights = out.slice(0, 8);
    }
  };

  /* ============================================================
     CHARTS — Cash flow line chart
     ============================================================ */
  const Charts = {
    drawLine() {
      const canvas = document.getElementById('lineChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (!cssW || !cssH) return;

      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const data = Transactions.last14Days();
      const incomes = data.map(d => d.income);
      const expenses = data.map(d => d.expense);
      const allMax = Math.max(...incomes, ...expenses, 100);
      // round up to nice number
      const niceMax = (() => {
        if (allMax >= 100000) return Math.ceil(allMax / 50000) * 50000;
        if (allMax >= 10000) return Math.ceil(allMax / 5000) * 5000;
        if (allMax >= 1000) return Math.ceil(allMax / 500) * 500;
        return Math.ceil(allMax / 100) * 100;
      })();

      const padL = 56, padR = 12, padT = 16, padB = 28;
      const plotW = cssW - padL - padR;
      const plotH = cssH - padT - padB;

      // Grid
      ctx.strokeStyle = '#E4DCC8';
      ctx.lineWidth = 1;
      ctx.font = '10px "Inter Tight", sans-serif';
      ctx.fillStyle = '#8A8175';
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        const val = niceMax * (1 - i / 4);
        ctx.textAlign = 'right';
        ctx.fillText(fmtINRShort(val), padL - 8, y + 3);
      }

      // X labels
      ctx.textAlign = 'center';
      data.forEach((d, i) => {
        if (i % 3 !== 0 && i !== data.length - 1) return;
        const x = padL + (plotW / Math.max(data.length - 1, 1)) * i;
        const dt = new Date(d.day);
        const lbl = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        ctx.fillStyle = '#8A8175';
        ctx.fillText(lbl, x, cssH - 8);
      });

      const drawSeries = (vals, color, fillAlpha) => {
        const xStep = plotW / Math.max(vals.length - 1, 1);
        const points = vals.map((v, i) => ({
          x: padL + i * xStep,
          y: padT + plotH - (v / niceMax) * plotH
        }));

        // Filled area
        ctx.beginPath();
        ctx.moveTo(points[0].x, padT + plotH);
        points.forEach((p, i) => {
          if (i === 0) ctx.lineTo(p.x, p.y);
          else {
            // Smooth curve
            const prev = points[i - 1];
            const cpx = (prev.x + p.x) / 2;
            ctx.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
          }
        });
        ctx.lineTo(points[points.length - 1].x, padT + plotH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, color + fillAlpha);
        grad.addColorStop(1, color + '00');
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke
        ctx.beginPath();
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else {
            const prev = points[i - 1];
            const cpx = (prev.x + p.x) / 2;
            ctx.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
          }
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Endpoints
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#F5F1E8';
        ctx.lineWidth = 2;
        ctx.stroke();
      };

      drawSeries(incomes, '#2F6E3F', '30');
      drawSeries(expenses, '#B23A2E', '30');
    }
  };

  /* ============================================================
     TOAST
     ============================================================ */
  const Toast = {
    show(message, type = 'info', duration = 3000) {
      const c = document.getElementById('toastStack');
      if (!c) return;
      const el = document.createElement('div');
      el.className = 'toast ' + type;
      el.textContent = message;
      c.appendChild(el);
      setTimeout(() => {
        el.classList.add('fadeout');
        setTimeout(() => el.remove(), 280);
      }, duration);
    }
  };

  /* ============================================================
     UI / RENDER
     ============================================================ */
  const UI = {
    render() {
      this.renderHero();
      this.renderStats();
      this.renderCategories();
      this.renderRecent();
      this.renderInsights();
      this.renderTransactions();
      this.renderAccounts();
      this.renderBudgets();
      this.renderFilters();
      this.renderTags();
      // Charts only when on overview
      if (State.activeView === 'overview') {
        requestAnimationFrame(() => Charts.drawLine());
      }
    },

    /* ----- Hero net worth ----- */
    renderHero() {
      const netWorth = State.accounts.reduce((s, a) => s + a.balance, 0);
      const valEl = document.getElementById('heroNetWorthValue');
      if (valEl) valEl.textContent = fmtHeroNumber(netWorth);

      const accCountEl = document.getElementById('heroAccounts');
      if (accCountEl) {
        const n = State.accounts.length;
        accCountEl.textContent = n + (n === 1 ? ' account' : ' accounts');
      }

      // Week change
      const weekAgo = Date.now() - 7 * 86400000;
      let net7 = 0;
      State.transactions.forEach(t => {
        if (t.timestamp < weekAgo) return;
        net7 += t.type === 'income' ? t.amount : -t.amount;
      });
      const chip = document.getElementById('heroChange');
      if (chip) {
        if (net7 === 0 && State.transactions.length === 0) {
          chip.textContent = 'no activity yet';
          chip.className = 'hero-chip';
        } else {
          const sign = net7 >= 0 ? '+' : '−';
          chip.textContent = `${sign}${fmtINRShort(Math.abs(net7))} this week`;
          chip.className = 'hero-chip ' + (net7 >= 0 ? 'up' : 'down');
        }
      }
    },

    /* ----- Stat strip ----- */
    renderStats() {
      const totals = Transactions.totalsThisMonth();
      const incEl = document.getElementById('statIncome');
      const expEl = document.getElementById('statExpense');
      const savEl = document.getElementById('statSavings');
      const dailyEl = document.getElementById('statDaily');

      if (incEl) incEl.textContent = totals.income > 0 ? fmtINRShort(totals.income) : '₹0';
      if (expEl) expEl.textContent = totals.expense > 0 ? fmtINRShort(totals.expense) : '₹0';

      const incFoot = document.getElementById('statIncomeFoot');
      const expFoot = document.getElementById('statExpenseFoot');
      if (incFoot) incFoot.textContent = totals.income > 0 ? `${fmtINR(totals.income)} earned` : 'No income yet';
      if (expFoot) expFoot.textContent = totals.expense > 0 ? `${fmtINR(totals.expense)} spent` : 'No spending yet';

      // Savings rate
      if (savEl) {
        if (totals.income > 0) {
          const rate = ((totals.income - totals.expense) / totals.income) * 100;
          savEl.textContent = rate.toFixed(0) + '%';
          savEl.className = 'stat-value ' + (rate < 0 ? 'neg' : rate >= 20 ? 'pos' : '');
          const savFoot = document.getElementById('statSavingsFoot');
          if (savFoot) {
            savFoot.textContent = rate < 0 ? 'spending more than earning'
              : rate >= 30 ? 'excellent for the month'
              : rate >= 15 ? 'on track'
              : 'consider trimming spending';
          }
        } else {
          savEl.textContent = '—';
          savEl.className = 'stat-value';
        }
      }

      const daily = Transactions.dailyAverage30Days();
      if (dailyEl) dailyEl.textContent = daily > 0 ? fmtINRShort(daily) : '₹0';
    },

    /* ----- Categories panel ----- */
    renderCategories() {
      const list = document.getElementById('catList');
      if (!list) return;
      const byCat = Transactions.byCategoryThisMonth('expense');
      const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
      if (!entries.length) {
        list.innerHTML = '<div class="empty">No spending recorded this month.</div>';
        return;
      }
      const total = entries.reduce((s, [, v]) => s + v, 0);
      list.innerHTML = entries.slice(0, 8).map(([cat, val]) => {
        const meta = findCategory(cat, 'expense');
        const pct = (val / total) * 100;
        return `
          <div class="cat-row">
            <div class="cat-icon">${meta.icon}</div>
            <div class="cat-info">
              <div class="cat-name">${escapeHtml(cat)}</div>
              <div class="cat-bar">
                <div class="cat-bar-fill" style="width:${pct}%;background:${meta.color}"></div>
              </div>
            </div>
            <div class="cat-amount">
              ${fmtINRShort(val)}
              <span class="cat-pct">${pct.toFixed(1)}%</span>
            </div>
          </div>
        `;
      }).join('');
    },

    /* ----- Recent activity (overview) ----- */
    renderRecent() {
      const list = document.getElementById('recentTxList');
      if (!list) return;
      const recent = Transactions.recent(5);
      if (!recent.length) {
        list.innerHTML = '<div class="empty">No transactions yet. Tap <b>+ Add</b> to begin.</div>';
        return;
      }
      list.innerHTML = recent.map(tx => this._txRowHTML(tx, true)).join('');
    },

    /* ----- Full transaction list ----- */
    renderTransactions() {
      const list = document.getElementById('txList');
      const total = document.getElementById('txTotal');
      if (total) total.textContent = Transactions.count();
      if (!list) return;
      const txs = Transactions.filtered();
      if (!txs.length) {
        if (!Transactions.count()) {
          list.innerHTML = `
            <div class="empty large">
              <div class="empty-mark">·</div>
              <p>No transactions yet.</p>
              <button class="btn btn-primary" id="emptyAddTxBtn">＋ Add your first one</button>
            </div>`;
          // re-wire button (since innerHTML replaces it)
          const b = document.getElementById('emptyAddTxBtn');
          if (b) b.addEventListener('click', () => Modals.openTransaction());
        } else {
          list.innerHTML = '<div class="empty">No transactions match your filters.</div>';
        }
        return;
      }
      list.innerHTML = txs.slice(0, 200).map(tx => this._txRowHTML(tx, false)).join('');
    },

    _txRowHTML(tx, compact) {
      const acc = Accounts.getById(tx.accountId);
      const meta = findCategory(tx.category, tx.type);
      const tagsHtml = tx.tags.length
        ? tx.tags.map(t => `<span class="tag-inline">#${escapeHtml(t)}</span>`).join(' ')
        : '';
      return `
        <div class="tx-row ${tx.flagged ? 'flagged' : ''}" data-tx-id="${tx.id}">
          <div class="tx-icon ${tx.type}">${meta.icon}</div>
          <div class="tx-mid">
            <div class="tx-cat">
              ${escapeHtml(tx.category)}
              ${tx.flagged ? `<span class="flag-badge" title="${escapeHtml(tx.flagReasons.join(' · '))}">unusual</span>` : ''}
            </div>
            <div class="tx-sub">
              <span>${acc ? escapeHtml(acc.name) : 'Unknown'}</span>
              ${tx.note ? `<span class="sep">·</span><span>${escapeHtml(tx.note)}</span>` : ''}
              ${tagsHtml ? `<span class="sep">·</span>${tagsHtml}` : ''}
            </div>
          </div>
          <div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '−'}${fmtINR(tx.amount)}</div>
          <div class="tx-time">${timeAgo(tx.timestamp)}</div>
          ${compact ? '' : `<button class="tx-delete" data-action="delete-tx" data-id="${tx.id}" title="Delete">×</button>`}
        </div>
      `;
    },

    /* ----- Accounts grid ----- */
    renderAccounts() {
      const grid = document.getElementById('accountGrid');
      if (!grid) return;
      if (!State.accounts.length) {
        grid.innerHTML = `
          <div class="empty large">
            <div class="empty-mark">·</div>
            <p>You haven't added any accounts.</p>
            <button class="btn btn-primary" id="emptyAddAccountBtn">＋ Add your first account</button>
          </div>`;
        const b = document.getElementById('emptyAddAccountBtn');
        if (b) b.addEventListener('click', () => Modals.openAccount(null));
        return;
      }
      grid.innerHTML = State.accounts.map(acc => {
        const ratio = Accounts.healthRatio(acc) * 100;
        const isLow = Accounts.isLow(acc);
        const isNear = Accounts.isNear(acc);
        const barClass = isLow ? 'danger' : isNear ? 'warn' : '';
        return `
          <div class="account-card ${isLow ? 'warn' : ''}" data-id="${acc.id}">
            <div class="acc-top">
              <div class="acc-meta">
                <div class="acc-icon ${acc.type}">${ACCOUNT_ICONS[acc.type] || '◇'}</div>
                <div>
                  <div class="acc-name">${escapeHtml(acc.name)}</div>
                  <div class="acc-type">${acc.type}</div>
                </div>
              </div>
              <div class="acc-actions">
                <button class="icon-btn" data-action="edit-account" data-id="${acc.id}" title="Edit">✎</button>
                <button class="icon-btn danger" data-action="delete-account" data-id="${acc.id}" title="Delete">×</button>
              </div>
            </div>
            <div class="acc-balance">${fmtINR(acc.balance)}</div>
            <div class="acc-bar"><div class="acc-bar-fill ${barClass}" style="width:${ratio}%"></div></div>
            <div class="acc-info">
              <span><b>Min:</b> ${fmtINR(acc.minBalance, { decimals: false })}</span>
              <span><b>Available:</b> ${fmtINR(Math.max(0, acc.balance - acc.minBalance), { decimals: false })}</span>
            </div>
            ${isLow ? `<div class="acc-warning">⚠ Below your minimum balance</div>` : ''}
          </div>
        `;
      }).join('');
    },

    /* ----- Budgets grid ----- */
    renderBudgets() {
      const grid = document.getElementById('budgetGrid');
      if (!grid) return;
      const cats = Object.keys(State.budgets);
      if (!cats.length) {
        grid.innerHTML = `
          <div class="empty large">
            <div class="empty-mark">·</div>
            <p>No budgets set.</p>
            <button class="btn btn-primary" id="emptyAddBudgetBtn">＋ Create a budget</button>
          </div>`;
        const b = document.getElementById('emptyAddBudgetBtn');
        if (b) b.addEventListener('click', () => Modals.openBudget());
        return;
      }
      grid.innerHTML = cats.map(cat => {
        const s = Budgets.status(cat);
        const meta = findCategory(cat, 'expense');
        const pct = clamp(s.pct, 0, 100);
        const fillClass = s.level === 'danger' ? 'danger' : s.level === 'warn' ? 'warn' : '';
        const cardClass = s.level === 'danger' ? 'danger' : '';
        return `
          <div class="budget-card ${cardClass}">
            <button class="icon-btn danger" data-action="delete-budget" data-cat="${escapeHtml(cat)}" title="Remove">×</button>
            <div class="budget-head">
              <div class="budget-cat-name">
                <span>${meta.icon}</span> ${escapeHtml(cat)}
              </div>
            </div>
            <div class="budget-amounts">
              ${fmtINR(s.used, { decimals: false })}
              <span class="of">/ ${fmtINR(s.limit, { decimals: false })}</span>
            </div>
            <div class="budget-bar" style="margin-top:14px">
              <div class="budget-bar-fill ${fillClass}" style="width:${pct}%"></div>
            </div>
            <div class="budget-foot">
              <span>${s.level === 'danger' ? 'over budget' : s.level === 'warn' ? 'getting close' : 'on track'}</span>
              <span class="pct ${fillClass}">${s.pct.toFixed(0)}%</span>
            </div>
          </div>
        `;
      }).join('');
    },

    /* ----- Insights ----- */
    renderInsights() {
      const list = document.getElementById('insightsList');
      if (!list) return;
      if (!State.insights.length) {
        list.innerHTML = '<div class="empty">Nothing to report yet — add a few transactions and patterns will appear here.</div>';
        return;
      }
      const marks = { critical: '!', warning: '※', info: '†' };
      list.innerHTML = State.insights.map(ins => `
        <div class="insight ${ins.priority}">
          <span class="insight-mark">${marks[ins.priority] || '·'}</span>
          <div>
            <div class="insight-text">${escapeHtml(ins.text)}</div>
            <span class="insight-time">${timeAgo(ins.timestamp)}</span>
          </div>
        </div>
      `).join('');
    },

    /* ----- Filters ----- */
    renderFilters() {
      const catSel = document.getElementById('filterCategory');
      const accSel = document.getElementById('filterAccount');
      if (catSel) {
        const cats = queryRows('SELECT DISTINCT category FROM transactions ORDER BY category ASC').map(row => row.category);
        const cur = State.filters.category;
        catSel.innerHTML = '<option value="">All categories</option>' +
          cats.map(c => `<option value="${escapeHtml(c)}" ${c === cur ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
      }
      if (accSel) {
        const cur = State.filters.account;
        accSel.innerHTML = '<option value="">All accounts</option>' +
          State.accounts.map(a => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
      }
    },

    /* ----- Tag bar ----- */
    renderTags() {
      const bar = document.getElementById('tagBar');
      if (!bar) return;
      const tags = Transactions.allTags();
      if (!tags.length) { bar.innerHTML = ''; return; }
      bar.innerHTML = tags.map(t =>
        `<span class="tag-chip ${State.filters.tag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`
      ).join('');
    },

    /* ----- Switch view ----- */
    setView(view) {
      State.activeView = view;
      document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.dataset.view === view);
      });
      document.querySelectorAll('.nav-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.view === view);
      });
      document.querySelectorAll('.bnav-btn[data-view]').forEach(t => {
        t.classList.toggle('active', t.dataset.view === view);
      });
      // Redraw chart if switching to overview
      if (view === 'overview') {
        requestAnimationFrame(() => Charts.drawLine());
      }
      // Scroll to top on view change
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  /* ============================================================
     MODALS
     ============================================================ */
  const Modals = {
    open(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); },
    close(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); },

    openAccount(existing) {
      document.getElementById('accountModalTitle').textContent = existing ? 'Edit account' : 'New account';
      document.getElementById('accountId').value = existing?.id || '';
      document.getElementById('accountName').value = existing?.name || '';
      const type = existing?.type || 'bank';
      document.getElementById('accountType').value = type;
      document.querySelectorAll('[data-acc-type]').forEach(b => {
        b.classList.toggle('active', b.dataset.accType === type);
      });
      document.getElementById('accountBalance').value = existing?.balance ?? '';
      document.getElementById('accountMin').value = existing?.minBalance ?? 0;
      this.open('accountModal');
      setTimeout(() => document.getElementById('accountName').focus(), 100);
    },

    openTransaction(presetType) {
      const form = document.getElementById('txForm');
      form.reset();
      const type = presetType || 'expense';
      document.getElementById('txType').value = type;
      document.querySelectorAll('[data-tx-type]').forEach(b => {
        b.classList.toggle('active', b.dataset.txType === type);
      });
      document.getElementById('txModalTitle').textContent = type === 'income' ? 'New income' : 'New expense';
      this.populateTxCategories(type);
      this.populateTxAccounts();
      this.open('txModal');
      setTimeout(() => document.getElementById('txAmount').focus(), 100);
    },

    populateTxCategories(type) {
      const sel = document.getElementById('txCategory');
      sel.innerHTML = CATEGORIES[type].map(c =>
        `<option value="${c.name}">${c.icon}  ${c.name}</option>`
      ).join('');
    },

    populateTxAccounts() {
      const sel = document.getElementById('txAccount');
      if (!State.accounts.length) {
        sel.innerHTML = '<option value="">— Create an account first —</option>';
        return;
      }
      sel.innerHTML = State.accounts.map(a =>
        `<option value="${a.id}">${ACCOUNT_ICONS[a.type]} ${escapeHtml(a.name)} · ${fmtINR(a.balance, { decimals: false })}</option>`
      ).join('');
    },

    openBudget() {
      document.getElementById('budgetForm').reset();
      const sel = document.getElementById('budgetCategory');
      sel.innerHTML = CATEGORIES.expense.map(c =>
        `<option value="${c.name}">${c.icon}  ${c.name}</option>`
      ).join('');
      this.open('budgetModal');
      setTimeout(() => document.getElementById('budgetLimit').focus(), 100);
    }
  };

  /* ============================================================
     EVENT WIRING
     ============================================================ */
  function wireEvents() {

    // ----- View switching (tabs + bottom nav) -----
    document.querySelectorAll('[data-view]').forEach(el => {
      // skip the FAB which has no data-view
      if (!el.dataset.view) return;
      el.addEventListener('click', () => UI.setView(el.dataset.view));
    });
    document.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => UI.setView(el.dataset.goto));
    });

    // ----- Quick add sheet -----
    const openQuick = () => Modals.open('quickSheet');
    const quickBtn = document.getElementById('quickAddBtn');
    const fabBtn = document.getElementById('bnavAddBtn');
    if (quickBtn) quickBtn.addEventListener('click', openQuick);
    if (fabBtn) fabBtn.addEventListener('click', openQuick);

    document.querySelectorAll('[data-quick]').forEach(b => {
      b.addEventListener('click', () => {
        const action = b.dataset.quick;
        Modals.close('quickSheet');
        if (action === 'expense') Modals.openTransaction('expense');
        else if (action === 'income') Modals.openTransaction('income');
        else if (action === 'account') Modals.openAccount(null);
        else if (action === 'budget') Modals.openBudget();
      });
    });

    // Direct buttons
    const addAccBtn = document.getElementById('addAccountBtn');
    if (addAccBtn) addAccBtn.addEventListener('click', () => Modals.openAccount(null));
    const addBudBtn = document.getElementById('addBudgetBtn');
    if (addBudBtn) addBudBtn.addEventListener('click', () => Modals.openBudget());
    const addTxBtn = document.getElementById('addTxBtn');
    if (addTxBtn) addTxBtn.addEventListener('click', () => {
      if (!State.accounts.length) {
        Toast.show('Create an account first', 'warn');
        Modals.openAccount(null);
        return;
      }
      Modals.openTransaction();
    });

    // ----- SQLite file import / export -----
    const saveDbBtn = document.getElementById('saveDbBtn');
    if (saveDbBtn) saveDbBtn.addEventListener('click', () => DatabaseFiles.save());

    const loadDbInput = document.getElementById('loadDbInput');
    if (loadDbInput) loadDbInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      try {
        await DatabaseFiles.load(file);
      } catch (err) {
        console.error(err);
        Toast.show('Could not load that SQLite file', 'error');
      } finally {
        e.target.value = '';
      }
    });

    // ----- Reset -----
    document.getElementById('resetDataBtn').addEventListener('click', () => {
      if (!confirm('Reset everything? This will permanently delete all your accounts, transactions, and budgets.')) return;
      DatabaseFiles.reset();
      State.insights = [];
      Insights.generate();
      UI.render();
      Toast.show('Reset complete', 'success');
    });

    // ----- Modal close -----
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => Modals.close(el.dataset.close));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open, .quick-sheet.open').forEach(m => m.classList.remove('open'));
      }
    });

    // ----- Transaction segmented control -----
    document.querySelectorAll('[data-tx-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.txType;
        document.getElementById('txType').value = t;
        document.querySelectorAll('[data-tx-type]').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('txModalTitle').textContent = t === 'income' ? 'New income' : 'New expense';
        Modals.populateTxCategories(t);
      });
    });

    // ----- Account type segmented control -----
    document.querySelectorAll('[data-acc-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.accType;
        document.getElementById('accountType').value = t;
        document.querySelectorAll('[data-acc-type]').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    // ----- Account form submit -----
    document.getElementById('accountForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('accountId').value;
      const data = {
        name: document.getElementById('accountName').value,
        type: document.getElementById('accountType').value,
        balance: parseFloat(document.getElementById('accountBalance').value) || 0,
        minBalance: parseFloat(document.getElementById('accountMin').value) || 0
      };
      if (!data.name.trim()) { Toast.show('Please enter a name', 'error'); return; }
      if (id) { Accounts.update(id, data); Toast.show('Account updated', 'success'); }
      else { Accounts.create(data); Toast.show('Account added', 'success'); }
      Modals.close('accountModal');
      Insights.generate();
      UI.render();
    });

    // ----- Transaction form submit -----
    document.getElementById('txForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const tags = document.getElementById('txTags').value
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const data = {
        type: document.getElementById('txType').value,
        amount: parseFloat(document.getElementById('txAmount').value),
        category: document.getElementById('txCategory').value,
        accountId: document.getElementById('txAccount').value,
        tags,
        note: document.getElementById('txNote').value
      };
      if (!data.amount || data.amount <= 0) { Toast.show('Enter a valid amount', 'error'); return; }
      if (!data.accountId) { Toast.show('Please select an account', 'error'); return; }
      const tx = Transactions.add(data);
      if (!tx) { Toast.show('Failed to save', 'error'); return; }
      Modals.close('txModal');
      Insights.generate();
      UI.render();
      Toast.show(`${tx.type === 'income' ? 'Income' : 'Expense'} of ${fmtINR(tx.amount)} saved`, 'success');
      if (tx.flagged) {
        setTimeout(() => Toast.show('⚠ Flagged: ' + tx.flagReasons.join(' · '), 'warn', 4500), 600);
      }
    });

    // ----- Budget form submit -----
    document.getElementById('budgetForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const cat = document.getElementById('budgetCategory').value;
      const limit = parseFloat(document.getElementById('budgetLimit').value);
      if (!limit || limit <= 0) { Toast.show('Enter a valid amount', 'error'); return; }
      Budgets.set(cat, limit);
      Modals.close('budgetModal');
      Insights.generate();
      UI.render();
      Toast.show(`Budget set for ${cat}`, 'success');
    });

    // ----- Delegated actions -----
    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const action = t.dataset.action;

      if (action === 'edit-account') {
        const acc = Accounts.getById(t.dataset.id);
        if (acc) Modals.openAccount(acc);
      }
      if (action === 'delete-account') {
        if (confirm('Delete this account and all its transactions?')) {
          Accounts.delete(t.dataset.id);
          Insights.generate();
          UI.render();
          Toast.show('Account deleted', 'info');
        }
      }
      if (action === 'delete-budget') {
        Budgets.remove(t.dataset.cat);
        Insights.generate();
        UI.render();
      }
      if (action === 'delete-tx') {
        e.stopPropagation();
        if (confirm('Delete this transaction? Account balance will be restored.')) {
          Transactions.delete(t.dataset.id);
          Insights.generate();
          UI.render();
          Toast.show('Transaction deleted', 'info');
        }
      }
    });

    // ----- Tag chip filter -----
    const tagBar = document.getElementById('tagBar');
    if (tagBar) {
      tagBar.addEventListener('click', (e) => {
        const chip = e.target.closest('.tag-chip');
        if (!chip) return;
        const tag = chip.dataset.tag;
        State.filters.tag = State.filters.tag === tag ? '' : tag;
        UI.render();
      });
    }

    // ----- Search & filters -----
    const search = document.getElementById('searchInput');
    if (search) search.addEventListener('input', (e) => {
      State.filters.search = e.target.value;
      UI.renderTransactions();
    });
    const fType = document.getElementById('filterType');
    if (fType) fType.addEventListener('change', (e) => {
      State.filters.type = e.target.value;
      UI.renderTransactions();
    });
    const fCat = document.getElementById('filterCategory');
    if (fCat) fCat.addEventListener('change', (e) => {
      State.filters.category = e.target.value;
      UI.renderTransactions();
    });
    const fAcc = document.getElementById('filterAccount');
    if (fAcc) fAcc.addEventListener('change', (e) => {
      State.filters.account = e.target.value;
      UI.renderTransactions();
    });
    const clear = document.getElementById('clearFiltersBtn');
    if (clear) clear.addEventListener('click', () => {
      State.filters = { type: '', category: '', account: '', search: '', tag: '' };
      const s = document.getElementById('searchInput'); if (s) s.value = '';
      const ft = document.getElementById('filterType'); if (ft) ft.value = '';
      const fc = document.getElementById('filterCategory'); if (fc) fc.value = '';
      const fa = document.getElementById('filterAccount'); if (fa) fa.value = '';
      UI.render();
    });

    // ----- Resize: redraw chart -----
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => Charts.drawLine(), 120);
    });

    // ----- Refresh time-ago every 60s -----
    setInterval(() => {
      if (State.activeView === 'overview') UI.renderRecent();
      if (State.activeView === 'transactions') UI.renderTransactions();
    }, 60000);
  }

  /* ============================================================
     INIT
     ============================================================ */
  async function init() {
    await initDb();
    State.hydrate();
    Insights.generate();
    wireEvents();
    UI.render();

    // Welcome message only on truly fresh state
    if (!State.accounts.length && !State.transactions.length) {
      setTimeout(() => Toast.show('Welcome to Khata. Tap + to begin.', 'info', 4000), 600);
    }
  }

  const startApp = () => init().catch(err => {
    console.error(err);
    document.body.insertAdjacentHTML('afterbegin', '<div class="empty large">Could not start the SQLite database. Please reload and try again.</div>');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

})();