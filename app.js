/* script.js
   Final updates:
   - Balance blue, income green, expense red everywhere
   - Transaction history rows colored
   - Dark theme dropdown fix
   - Monthly summary table (below charts) filtered by month selection
   - Mobile layout adjustments (summary row, filters row, stacked charts)
   - Firebase Google Sign-In + Firestore per-user storage (placeholders for config)
*/

/* =============== Replace with your Firebase config =============== */
const firebaseConfig = {
  apiKey: "AIzaSyBe_19Z0b7WSLFknHXq0PPoGMnWTm3z3ps",
  authDomain: "mkexpensetracker-7b445.firebaseapp.com",
  projectId: "mkexpensetracker-7b445",
  storageBucket: "mkexpensetracker-7b445.firebasestorage.app",
  messagingSenderId: "497398743524",
  appId: "1:497398743524:web:2d1d6fa398e7bc45bec7f1"
};
/* ================================================================= */

document.addEventListener('DOMContentLoaded', function() {
  // DOM elements
  const transactionForm = document.getElementById('transaction-form');
  const transactionsList = document.getElementById('transactions-list');
  const balanceElement = document.getElementById('balance');
  const incomeElement = document.getElementById('income');
  const expenseElement = document.getElementById('expense');
  const filterType = document.getElementById('filter-type');
  const filterCategory = document.getElementById('filter-category');
  const filterMonth = document.getElementById('filter-month');
  const monthlySummaryBody = document.querySelector('#monthly-summary-table tbody');
  const modal = document.getElementById('alert-modal');
  const alertMessage = document.getElementById('alert-message');
  const closeModal = document.querySelector('.close');
  const clearLocalBtn = document.getElementById('clear-local');

  // Auth & UI elements
  const googleSigninBtn = document.getElementById('google-signin-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const loginArea = document.getElementById('login-area');
  const userInfo = document.getElementById('user-info');
  const userPic = document.getElementById('user-pic');
  const userName = document.getElementById('user-name');
  const themeToggle = document.getElementById('theme-toggle');
  const themeLabel = document.getElementById('theme-label');

  // Chart contexts
  const categoryCtx = document.getElementById('categoryChart').getContext('2d');
  const monthlyCtx = document.getElementById('monthlyChart').getContext('2d');
  let categoryChart, monthlyChart;

  // Data
  let transactions = JSON.parse(localStorage.getItem('transactions')) || [];

  // Firebase runtime
  let firebaseReady = false;
  let auth = null;
  let db = null;
  let currentUid = null;
  let unsubscribeSnapshot = null;

  const today = new Date().toISOString().split('T')[0];

  init();

  function init() {
    // set date default
    document.getElementById('date').value = today;

    // populate filters and UI
    populateMonthFilter();
    updateSummary();
    updateTransactionList();
    updateCharts();
    updateMonthlySummary();

    // events
    setupEventListeners();

    // load firebase
    loadFirebaseSdk().then(initFirebase).catch(e => {
      console.warn('Firebase load failed:', e);
    });

    // theme
    const savedLocalTheme = localStorage.getItem('et_theme');
    if (savedLocalTheme) setTheme(savedLocalTheme);
    else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }

    // debounce resize charts
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => updateCharts(), 180);
    });
  }

  function setupEventListeners() {
    transactionForm.addEventListener('submit', addTransaction);
    filterType.addEventListener('change', onFilterChange);
    filterCategory.addEventListener('change', onFilterChange);
    filterMonth.addEventListener('change', onFilterChange);

    closeModal.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    clearLocalBtn?.addEventListener('click', () => {
      if (!confirm('Clear all local transactions? This does not remove cloud-synced data.')) return;
      transactions = [];
      saveTransactions();
      refreshAllViews();
    });

    themeToggle.addEventListener('change', async () => {
      const newTheme = themeToggle.checked ? 'dark' : 'light';
      setTheme(newTheme);
      localStorage.setItem('et_theme', newTheme);
      if (firebaseReady && auth.currentUser) {
        try { await db.collection('users').doc(auth.currentUser.uid).set({ theme: newTheme }, { merge: true }); }
        catch(e){ console.warn('Unable to save theme to cloud', e); }
      }
    });
  }

  function onFilterChange() {
    updateTransactionList();
    updateMonthlySummary(); // update table according to selected month or all
  }

  function populateMonthFilter() {
    const months = new Set();
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    transactions.forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date);
      const key = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      months.add(key);
    });

    // clear old options except default
    while (filterMonth.options.length > 1) filterMonth.remove(1);
    Array.from(months).sort((a,b) => {
      // sort by year-month descending
      const [ma, ya] = a.split(' '); const [mb, yb] = b.split(' ');
      const ia = new Date(`${ma} 1, ${ya}`).getTime();
      const ib = new Date(`${mb} 1, ${yb}`).getTime();
      return ib - ia;
    }).forEach(m => {
      const opt = document.createElement('option'); opt.value = m; opt.textContent = m;
      filterMonth.appendChild(opt);
    });
  }

  async function addTransaction(e) {
    e.preventDefault();
    const type = document.getElementById('type').value;
    const category = document.getElementById('category').value;
    const amountRaw = document.getElementById('amount').value;
    const amountParsed = parseFloat(amountRaw);
    const description = document.getElementById('description').value || '';
    const date = document.getElementById('date').value || today;

    if (!amountRaw || isNaN(amountParsed) || amountParsed <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    const localId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
    const tx = {
      id: localId,
      type,
      category,
      amount: type === 'expense' ? -Math.abs(amountParsed) : Math.abs(amountParsed),
      description,
      date
    };

    transactions.push(tx);
    saveTransactions();
    refreshAllViews();

    transactionForm.reset();
    document.getElementById('date').value = today;

    // push to cloud if logged in
    if (firebaseReady && auth.currentUser) {
      try {
        const payload = {
          type: tx.type,
          category: tx.category,
          amount: tx.amount,
          description: tx.description,
          date: tx.date,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('users').doc(auth.currentUser.uid).collection('expenses').add(payload);
        // replace local id with cloud id for consistency
        const idx = transactions.findIndex(t => t.id === localId);
        if (idx > -1) {
          transactions[idx].id = docRef.id;
          saveTransactions();
          refreshAllViews();
        }
      } catch (err) {
        console.warn('Failed to save transaction to cloud', err);
      }
    }
  }

  function deleteTransaction(id) {
    const tx = transactions.find(t => t.id === id);
    transactions = transactions.filter(t => t.id !== id);
    saveTransactions();
    refreshAllViews();

    if (firebaseReady && auth.currentUser && tx) {
      db.collection('users').doc(auth.currentUser.uid).collection('expenses').doc(id).delete().catch(e => {});
    }
  }

  function saveTransactions() {
    try { localStorage.setItem('transactions', JSON.stringify(transactions)); } catch(e){ console.warn(e); }
  }

  function refreshAllViews() {
    populateMonthFilter();
    updateSummary();
    updateTransactionList();
    updateCharts();
    updateMonthlySummary();
  }

  function updateSummary() {
    const amounts = transactions.map(t => t.amount || 0);
    const total = amounts.reduce((s, n) => s + n, 0);
    const income = amounts.filter(n => n > 0).reduce((s, n) => s + n, 0);
    const expense = Math.abs(amounts.filter(n => n < 0).reduce((s, n) => s + n, 0));

    balanceElement.textContent = `$${total.toFixed(2)}`;
    incomeElement.textContent = `$${income.toFixed(2)}`;
    expenseElement.textContent = `$${expense.toFixed(2)}`;

    // ensure color classes applied (CSS handles colors)
    balanceElement.classList.add('balance-amount');
    incomeElement.classList.add('income-amount');
    expenseElement.classList.add('expense-amount');
  }

  function updateTransactionList() {
    const type = filterType.value;
    const category = filterCategory.value;
    const month = filterMonth.value;

    let filtered = [...transactions];

    if (type !== 'all') filtered = filtered.filter(t => t.type === type);
    if (category !== 'all') filtered = filtered.filter(t => t.category === category);
    if (month !== 'all') {
      const [monthName, year] = month.split(' ');
      const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();
      filtered = filtered.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === monthIndex && d.getFullYear() == year;
      });
    }

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date));

    transactionsList.innerHTML = '';
    if (filtered.length === 0) {
      const r = document.createElement('tr');
      r.innerHTML = `<td colspan="6" style="text-align:center;color:var(--muted);padding:18px 0;">No transactions found</td>`;
      transactionsList.appendChild(r);
      return;
    }

    filtered.forEach(t => {
      const row = document.createElement('tr');
      const amountDisplay = Math.abs(t.amount).toFixed(2);
      const typeDisplay = t.type.charAt(0).toUpperCase() + t.type.slice(1);
      const categoryDisplay = t.category.charAt(0).toUpperCase() + t.category.slice(1);
      row.innerHTML = `
        <td style="white-space:nowrap">${formatDate(t.date)}</td>
        <td>${typeDisplay}</td>
        <td>${categoryDisplay}</td>
        <td>${(t.description || '')}</td>
        <td class="${t.amount>0 ? 'income' : 'expense'}">$${amountDisplay}</td>
        <td><button class="delete-btn" data-id="${t.id}" title="Delete">Delete</button></td>
      `;
      transactionsList.appendChild(row);
    });

    // attach delete handlers (clear duplicates)
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Delete this transaction?')) return;
        deleteTransaction(id);
      });
    });
  }

  function updateCharts() {
    // destroy previous
    if (categoryChart) try{ categoryChart.destroy(); }catch(e){}
    if (monthlyChart) try{ monthlyChart.destroy(); }catch(e){}

    // categories
    const categories = ['food','rent','entertainment','other'];
    const expenseData = categories.map(cat =>
      Math.abs(transactions.filter(t => t.type==='expense' && t.category===cat).reduce((s,n) => s + n.amount, 0))
    );
    const incomeData = categories.map(cat =>
      transactions.filter(t => t.type==='income' && t.category===cat).reduce((s,n) => s + n.amount, 0)
    );

    // ensure container heights so maintainAspectRatio:false works
    const categoryContainer = categoryCtx.canvas.parentElement;
    const monthlyContainer = monthlyCtx.canvas.parentElement;
    categoryContainer.style.minHeight = '220px';
    monthlyContainer.style.minHeight = '220px';

    categoryChart = new Chart(categoryCtx, {
      type: 'bar',
      data: {
        labels: categories.map(c => c.charAt(0).toUpperCase()+c.slice(1)),
        datasets: [
          { label:'Income', data: incomeData, backgroundColor: 'rgba(52,152,219,0.75)', borderColor:'rgba(52,152,219,1)', borderWidth:1 },
          { label:'Expenses', data: expenseData, backgroundColor: 'rgba(231,76,60,0.75)', borderColor:'rgba(231,76,60,1)', borderWidth:1 }
        ]
      },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        scales:{ y:{ beginAtZero:true } },
        plugins:{ title:{ display:true, text:'Income vs Expenses by Category' }, legend:{ position:'bottom' } }
      }
    });

    // monthly line chart
    const monthlyData = {};
    transactions.forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!monthlyData[key]) monthlyData[key] = { income:0, expense:0 };
      if (t.amount > 0) monthlyData[key].income += t.amount;
      else monthlyData[key].expense += Math.abs(t.amount);
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    const monthlyLabels = sortedMonths.map(m => {
      const [y,mon] = m.split('-'); return new Date(y, parseInt(mon)-1).toLocaleDateString('default',{ month:'short', year:'numeric' });
    });
    const monthlyIncomeData = sortedMonths.map(m => monthlyData[m].income);
    const monthlyExpenseData = sortedMonths.map(m => monthlyData[m].expense);

    monthlyChart = new Chart(monthlyCtx, {
      type: 'line',
      data: {
        labels: monthlyLabels,
        datasets: [
          { label:'Income', data: monthlyIncomeData, backgroundColor:'rgba(52,152,219,0.15)', borderColor:'rgba(52,152,219,1)', borderWidth:2, fill:true, tension:0.2 },
          { label:'Expenses', data: monthlyExpenseData, backgroundColor:'rgba(231,76,60,0.15)', borderColor:'rgba(231,76,60,1)', borderWidth:2, fill:true, tension:0.2 }
        ]
      },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        scales:{ y:{ beginAtZero:true } },
        plugins:{ title:{ display:true, text:'Monthly Income vs Expenses' }, legend:{ position:'bottom' } }
      }
    });
  }

  function updateMonthlySummary() {
    // Build aggregated data per month (year-month key)
    const monthly = {};
    transactions.forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; // yyyy-mm
      const label = `${d.toLocaleDateString(undefined,{ month:'short' })} ${d.getFullYear()}`;
      if (!monthly[key]) monthly[key] = { income:0, expense:0, label };
      if (t.amount > 0) monthly[key].income += t.amount;
      else monthly[key].expense += Math.abs(t.amount);
    });

    // Build rows sorted descending
    const rows = Object.keys(monthly).sort((a,b) => (b.localeCompare(a)));
    // If a specific month is selected, filter to that month only
    const selectedMonth = filterMonth.value; // 'All Months' -> 'all' else 'Month Year'
    let filteredRows = rows;
    if (selectedMonth && selectedMonth !== 'all') {
      // convert selectedMonth "January 2025" to key "2025-01"
      const [mName, y] = selectedMonth.split(' ');
      const mIndex = new Date(`${mName} 1, ${y}`).getMonth() + 1;
      const key = `${y}-${String(mIndex).padStart(2,'0')}`;
      filteredRows = rows.filter(r => r === key);
    }

    // render tbody
    monthlySummaryBody.innerHTML = '';
    if (filteredRows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" style="text-align:center;color:var(--muted);padding:12px 0;">No monthly data</td>`;
      monthlySummaryBody.appendChild(tr);
      return;
    }

    filteredRows.forEach(key => {
      const data = monthly[key];
      const balance = (data.income - data.expense);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${data.label}</td>
        <td class="income">$${data.income.toFixed(2)}</td>
        <td class="expense">$${data.expense.toFixed(2)}</td>
        <td class="balance">$${balance.toFixed(2)}</td>
      `;
      monthlySummaryBody.appendChild(tr);
    });
  }

  function showAlert(message) {
    alertMessage.textContent = message;
    modal.style.display = 'flex';
  }

  function formatDate(dateString) {
    if (!dateString) return '';
    const options = { year:'numeric', month:'short', day:'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  }

  /* ===========================
     FIREBASE LOADING & HELPERS
     =========================== */

  function loadFirebaseSdk() {
    return new Promise((resolve, reject) => {
      const base = 'https://www.gstatic.com/firebasejs/9.23.0/';
      const libs = ['firebase-app-compat.js','firebase-auth-compat.js','firebase-firestore-compat.js'];
      let loaded = 0;
      libs.forEach(src => {
        const s = document.createElement('script');
        s.src = base + src;
        s.onload = () => { if (++loaded === libs.length) resolve(); };
        s.onerror = (e) => reject(e);
        document.head.appendChild(s);
      });
      setTimeout(() => { if (!window.firebase) reject(new Error('Firebase load timeout')); }, 8000);
    });
  }

  function initFirebase() {
    if (!window.firebase) throw new Error('Firebase not available');
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    firebaseReady = true;
    auth = firebase.auth();
    db = firebase.firestore();

    googleSigninBtn.addEventListener('click', () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(err => console.error('Sign-in error', err));
    });

    signoutBtn.addEventListener('click', () => auth.signOut());

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUid = user.uid;
        loginArea.style.display = 'none';
        userInfo.style.display = 'flex';
        userPic.src = user.photoURL || '';
        userName.textContent = user.displayName || user.email || 'User';

        // load profile (for theme)
        try {
          const doc = await db.collection('users').doc(currentUid).get();
          if (doc.exists) {
            const data = doc.data();
            if (data.theme) setTheme(data.theme);
          }
        } catch(e){ console.warn(e); }

        // load cloud data
        loadCloudExpensesAndInit(currentUid);
      } else {
        currentUid = null;
        loginArea.style.display = '';
        userInfo.style.display = 'none';
        userPic.src = ''; userName.textContent = '';

        if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
        transactions = JSON.parse(localStorage.getItem('transactions')) || [];
        refreshAllViews();
      }
    });
  }

  async function loadCloudExpensesAndInit(uid) {
    if (!db) return;
    try {
      const snap = await db.collection('users').doc(uid).collection('expenses').orderBy('createdAt','asc').get();
      const cloud = [];
      snap.forEach(doc => {
        const d = doc.data();
        if (d.createdAt && d.createdAt.toDate) d.createdAt = d.createdAt.toDate().toISOString();
        cloud.push(Object.assign({ id: doc.id }, d));
      });

      const local = JSON.parse(localStorage.getItem('transactions')) || [];
      if (cloud.length === 0 && local.length > 0) {
        // push local to cloud
        for (const l of local) {
          const clone = {
            type: l.type,
            category: l.category,
            amount: l.amount,
            description: l.description || '',
            date: l.date || new Date().toISOString(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          await db.collection('users').doc(uid).collection('expenses').add(clone);
        }
        // re-fetch
        const snap2 = await db.collection('users').doc(uid).collection('expenses').orderBy('createdAt','asc').get();
        const cloud2 = [];
        snap2.forEach(doc => {
          const d = doc.data();
          if (d.createdAt && d.createdAt.toDate) d.createdAt = d.createdAt.toDate().toISOString();
          cloud2.push(Object.assign({ id: doc.id }, d));
        });
        transactions = cloud2.map(c => ({ id: c.id, type: c.type, category: c.category, amount: c.amount, description: c.description || '', date: c.date || c.createdAt }));
        saveTransactions();
      } else if (cloud.length > 0) {
        transactions = cloud.map(c => ({ id: c.id, type: c.type, category: c.category, amount: c.amount, description: c.description || '', date: c.date || c.createdAt }));
        saveTransactions();
      } else {
        transactions = local;
      }

      refreshAllViews();

      if (unsubscribeSnapshot) unsubscribeSnapshot();
      unsubscribeSnapshot = db.collection('users').doc(uid).collection('expenses').orderBy('createdAt','asc')
        .onSnapshot(snapshot => {
          const data = [];
          snapshot.forEach(doc => {
            const d = doc.data();
            if (d.createdAt && d.createdAt.toDate) d.createdAt = d.createdAt.toDate().toISOString();
            data.push(Object.assign({ id: doc.id }, d));
          });
          transactions = data.map(c => ({ id: c.id, type: c.type, category: c.category, amount: c.amount, description: c.description || '', date: c.date || c.createdAt }));
          saveTransactions();
          refreshAllViews();
        }, err => { console.warn('Realtime error', err); });

    } catch(e) {
      console.warn('Cloud load error', e);
      transactions = JSON.parse(localStorage.getItem('transactions')) || [];
      refreshAllViews();
    }
  }

  function setTheme(theme) {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.checked = (theme === 'dark');
    themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
  }

}); // DOMContentLoaded
