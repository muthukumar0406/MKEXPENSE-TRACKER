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
  const categoryCtx = document.getElementById('categoryChart')?.getContext('2d');
  const monthlyCtx = document.getElementById('monthlyChart')?.getContext('2d');
  let categoryChart, monthlyChart;

  // Data
  let transactions = JSON.parse(localStorage.getItem('transactions')) || [];
  // expose to global for the Insights small script that reads window.transactions
  window.transactions = transactions;

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

    // expose refreshAllViews for other scripts
    window.refreshAllViews = refreshAllViews;
    // ensure window.transactions points to the app's transactions array
    window.transactions = transactions;
  }

  function setupEventListeners() {
    transactionForm?.addEventListener('submit', addTransaction);
    filterType?.addEventListener('change', onFilterChange);
    filterCategory?.addEventListener('change', onFilterChange);
    filterMonth?.addEventListener('change', onFilterChange);

    closeModal?.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    clearLocalBtn?.addEventListener('click', () => {
      if (!confirm('Clear all local transactions? This does not remove cloud-synced data.')) return;
      transactions = [];
      saveTransactions();
      refreshAllViews();
    });

    themeToggle?.addEventListener('change', async () => {
      const newTheme = themeToggle.checked ? 'dark' : 'light';
      setTheme(newTheme);
      localStorage.setItem('et_theme', newTheme);
      if (firebaseReady && auth?.currentUser) {
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
      if (isNaN(d)) return;
      const key = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      months.add(key);
    });

    // clear old options except default
    while (filterMonth.options.length > 1) filterMonth.remove(1);
    Array.from(months).sort((a,b) => {
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
    const typeRaw = document.getElementById('type').value;
    const type = String(typeRaw || '').toLowerCase();
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
    // keep global reference up to date
    window.transactions = transactions;
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
    // update global ref
    window.transactions = transactions;
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
    // expose globally
    window.transactions = transactions;
  }

  function updateSummary() {
    const amounts = transactions.map(t => Number(t.amount) || 0);
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

    if (type !== 'all') filtered = filtered.filter(t => String(t.type).toLowerCase() === String(type).toLowerCase());
    if (category !== 'all') filtered = filtered.filter(t => String(t.category) === String(category));
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
      const typeDisplay = String(t.type || '').charAt(0).toUpperCase() + String(t.type || '').slice(1);
      const categoryDisplay = String(t.category || '').charAt(0).toUpperCase() + String(t.category || '').slice(1);
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

    // attach delete handlers
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

    if (!categoryCtx || !monthlyCtx) return;

    // categories match your HTML select values
    const categories = ['Gym','Food','Transport','Salary','Rent','Others'];

    const expenseData = categories.map(cat =>
      Math.abs(transactions.filter(t => String(t.type).toLowerCase() === 'expense' && String(t.category).toLowerCase() === String(cat).toLowerCase()).reduce((s,n) => s + (Number(n.amount) || 0), 0))
    );
    const incomeData = categories.map(cat =>
      transactions.filter(t => String(t.type).toLowerCase() === 'income' && String(t.category).toLowerCase() === String(cat).toLowerCase()).reduce((s,n) => s + (Number(n.amount) || 0), 0)
    );

    // ensure container heights so maintainAspectRatio:false works
    const categoryContainer = categoryCtx.canvas.parentElement;
    const monthlyContainer = monthlyCtx.canvas.parentElement;
    categoryContainer.style.minHeight = '220px';
    monthlyContainer.style.minHeight = '220px';

    categoryChart = new Chart(categoryCtx, {
      type: 'bar',
      data: {
        labels: categories.map(c => c),
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
      if (isNaN(d)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!monthlyData[key]) monthlyData[key] = { income:0, expense:0 };
      if ((Number(t.amount) || 0) > 0) monthlyData[key].income += Number(t.amount);
      else monthlyData[key].expense += Math.abs(Number(t.amount) || 0);
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
      if (isNaN(d)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; // yyyy-mm
      const label = `${d.toLocaleDateString(undefined,{ month:'short' })} ${d.getFullYear()}`;
      if (!monthly[key]) monthly[key] = { income:0, expense:0, label };
      if (Number(t.amount) > 0) monthly[key].income += Number(t.amount);
      else monthly[key].expense += Math.abs(Number(t.amount));
    });

    // Build rows sorted descending
    const rows = Object.keys(monthly).sort((a,b) => (b.localeCompare(a)));
    // If a specific month is selected, filter to that month only
    const selectedMonth = filterMonth.value; // 'All Months' -> 'all' else 'Month Year'
    let filteredRows = rows;
    if (selectedMonth && selectedMonth !== 'all') {
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

    googleSigninBtn?.addEventListener('click', () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(err => console.error('Sign-in error', err));
    });

    signoutBtn?.addEventListener('click', () => auth.signOut());

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
        // normalize types locally
        transactions = transactions.map(t => Object.assign({}, t, { type: String(t.type || '').toLowerCase() }));
        window.transactions = transactions;
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
            type: String(l.type || '').toLowerCase(),
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
        transactions = cloud2.map(c => ({ id: c.id, type: String(c.type || '').toLowerCase(), category: c.category, amount: c.amount, description: c.description || '', date: c.date || c.createdAt }));
        saveTransactions();
      } else if (cloud.length > 0) {
        transactions = cloud.map(c => ({ id: c.id, type: String(c.type || '').toLowerCase(), category: c.category, amount: c.amount, description: c.description || '', date: c.date || c.createdAt }));
        saveTransactions();
      } else {
        transactions = local.map(l => Object.assign({}, l, { type: String(l.type || '').toLowerCase() }));
      }

      window.transactions = transactions;
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
          transactions = data.map(c => ({ id: c.id, type: String(c.type || '').toLowerCase(), category: c.category, amount: c.amount, description: c.description || '', date: c.date || c.createdAt }));
          saveTransactions();
          window.transactions = transactions;
          refreshAllViews();
        }, err => { console.warn('Realtime error', err); });

    } catch(e) {
      console.warn('Cloud load error', e);
      transactions = JSON.parse(localStorage.getItem('transactions')) || [];
      transactions = transactions.map(t => Object.assign({}, t, { type: String(t.type || '').toLowerCase() }));
      window.transactions = transactions;
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


/* ===== UI: Mobile menu (slide from right) and Insights (category + month combined) ===== */

/* ===== UI: Mobile menu (slide from right) and Insights (category + month combined) ===== */
(function(){
  document.addEventListener('DOMContentLoaded', function () {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileMenuClose = document.getElementById('mobile-menu-close');
    const mobileMenuLinks = document.querySelectorAll('.mobile-nav-link');
    const mobileSignInBtn = document.getElementById('mobile-google-signin-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const mobileThemeToggle = document.getElementById('mobile-theme-toggle');

    function openMobileMenu(){
      if(!mobileMenu) return;
      mobileMenu.classList.add('open');
      mobileMenu.setAttribute('aria-hidden','false');
      mobileMenuBtn && mobileMenuBtn.setAttribute('aria-expanded','true');
      document.body.style.overflow = 'hidden';
    }
    function closeMobileMenu(){
      if(!mobileMenu) return;
      mobileMenu.classList.remove('open');
      mobileMenu.setAttribute('aria-hidden','true');
      mobileMenuBtn && mobileMenuBtn.setAttribute('aria-expanded','false');
      document.body.style.overflow = '';
    }

    if(mobileMenuBtn){
      mobileMenuBtn.addEventListener('click', function(e){
        e.stopPropagation();
        const expanded = mobileMenuBtn.getAttribute('aria-expanded') === 'true';
        if(expanded) closeMobileMenu(); else openMobileMenu();
      });
    }
    if(mobileMenuClose) mobileMenuClose.addEventListener('click', closeMobileMenu);
    if(mobileMenu){
      mobileMenu.addEventListener('click', function(e){
        if(e.target === mobileMenu) closeMobileMenu();
      });
    }
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') closeMobileMenu();
    });

    // mobile links scroll & close
    mobileMenuLinks.forEach(link => {
      link.addEventListener('click', function(e){
        e.preventDefault();
        const target = link.getAttribute('data-target');
        if(target){
          const el = document.getElementById(target);
          if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
        }
        closeMobileMenu();
      });
    });

    if(mobileSignInBtn){
      mobileSignInBtn.addEventListener('click', function(){
        const desktopBtn = document.getElementById('google-signin-btn');
        if(desktopBtn) desktopBtn.click();
      });
    }
    if(mobileThemeToggle){
      mobileThemeToggle.addEventListener('click', function(){
        if(themeToggle){
          themeToggle.checked = !themeToggle.checked;
          themeToggle.dispatchEvent(new Event('change'));
        }
      });
    }

    // -----------------------
    // Insights functionality
    // -----------------------
    const insightsSelect = document.getElementById('insights-category');
    const insightsMonthSelect = document.getElementById('insights-month');
    const globalMonthFilter = document.getElementById('filter-month'); // existing filter
    const insightsContainer = document.querySelector('.insights');

    // helper: populate the insights month select (mirror global months)
    function populateInsightsMonths() {
      if(!insightsMonthSelect) return;
      // clear except default
      while (insightsMonthSelect.options.length > 1) insightsMonthSelect.remove(1);

      // gather months from global transactions (window.transactions)
      try {
        const monthsSet = new Set();
        (window.transactions || []).forEach(t => {
          if(!t || !t.date) return;
          const d = new Date(t.date);
          if(isNaN(d)) return;
          const label = `${d.toLocaleDateString(undefined,{ month:'long' })} ${d.getFullYear()}`;
          monthsSet.add(label);
        });
        // sort newest first
        Array.from(monthsSet).sort((a,b) => {
          const [ma, ya] = a.split(' '); const [mb, yb] = b.split(' ');
          return new Date(`${yb} 1`).getTime() - new Date(`${ya} 1`).getTime();
        }).forEach(m => {
          const opt = document.createElement('option');
          opt.value = m; opt.textContent = m;
          insightsMonthSelect.appendChild(opt);
        });
      } catch(e) { /* ignore */ }
    }

    if(insightsContainer){
      let insightsSummary = document.getElementById('insights-summary');
      if(!insightsSummary){
        insightsSummary = document.createElement('div');
        insightsSummary.id = 'insights-summary';
        insightsSummary.className = 'insights-summary';
        insightsContainer.appendChild(insightsSummary);
      }

      function formatMoney(v){ return '$'+Number(v||0).toFixed(2); }

      function getFilteredTransactions(category, monthLabel){
        if(!window.transactions) return [];
        let arr = Array.isArray(window.transactions) ? window.transactions.slice() : [];
        if(category && category !== 'all'){
          arr = arr.filter(t => String(t.category) === String(category));
        }
        // month selection priority: insightsMonthSelect -> passed monthLabel -> globalMonthFilter
        let mLabel = 'all';
        if(insightsMonthSelect && insightsMonthSelect.value) mLabel = insightsMonthSelect.value;
        else if(monthLabel) mLabel = monthLabel;
        else if(globalMonthFilter && globalMonthFilter.value) mLabel = globalMonthFilter.value;

        if(mLabel && mLabel !== 'all'){
          const [mName, y] = mLabel.split(' ');
          const monthIndex = new Date(mName + ' 1, ' + y).getMonth();
          arr = arr.filter(t => {
            if(!t.date) return false;
            const d = new Date(t.date);
            return d.getFullYear() === parseInt(y,10) && d.getMonth() === monthIndex;
          });
        }
        return arr;
      }

      function updateInsights(){
        // ensure months are populated (so "All Months" + specific months available)
        populateInsightsMonths();

        const category = insightsSelect ? insightsSelect.value : 'all';
        const items = getFilteredTransactions(category);

        let income = 0, expense = 0;
        items.forEach(t => {
          const amountNum = Number(t.amount || 0);
          const tType = String(t.type || '').toLowerCase();
          if(tType === 'income') income += amountNum;
          else if(tType === 'expense') expense += Math.abs(amountNum);
          else {
            if(amountNum >= 0) income += amountNum;
            else expense += Math.abs(amountNum);
          }
        });
        const balance = income - expense;

        insightsSummary.innerHTML = '';
        const cards = [
          {title:'Income', val: formatMoney(income), cls:'income'},
          {title:'Expense', val: formatMoney(expense), cls:'expense'},
          {title:'Balance', val: formatMoney(balance), cls:'balance'}
        ];
        cards.forEach(c => {
          const d = document.createElement('div');
          d.className = 'insight-card';
          d.innerHTML = '<h4>'+c.title+'</h4><p class="'+c.cls+'">'+c.val+'</p>';
          insightsSummary.appendChild(d);
        });
      }

      // wire change events
      if(insightsSelect) insightsSelect.addEventListener('change', updateInsights);
      if(insightsMonthSelect) insightsMonthSelect.addEventListener('change', updateInsights);
      if(globalMonthFilter) globalMonthFilter.addEventListener('change', updateInsights);

      // call update on initial load and whenever transactions refresh
      updateInsights();
      // Also hook into refreshAllViews if available
      if(typeof window.refreshAllViews === 'function'){
        const orig = window.refreshAllViews;
        window.refreshAllViews = function(){
          try{ orig(); } catch(e){ console.warn(e); }
          populateInsightsMonths();
          updateInsights();
        };
      } else {
        setInterval(() => { populateInsightsMonths(); updateInsights(); }, 2000);
      }
    }
  });
})();




// (function(){
//   document.addEventListener('DOMContentLoaded', function () {
//     const mobileMenuBtn = document.getElementById('mobile-menu-btn');
//     const mobileMenu = document.getElementById('mobile-menu');
//     const mobileMenuClose = document.getElementById('mobile-menu-close');
//     const mobileMenuLinks = document.querySelectorAll('.mobile-nav-link');
//     const desktopNavLinks = document.querySelectorAll('.main-nav .nav-link');
//     const mobileSignInBtn = document.getElementById('mobile-google-signin-btn');
//     const themeToggle = document.getElementById('theme-toggle');
//     const mobileThemeToggle = document.getElementById('mobile-theme-toggle');

//     function openMobileMenu(){
//       if(!mobileMenu) return;
//       mobileMenu.classList.add('open');
//       mobileMenu.setAttribute('aria-hidden','false');
//       mobileMenuBtn && mobileMenuBtn.setAttribute('aria-expanded','true');
//       document.body.style.overflow = 'hidden';
//     }
//     function closeMobileMenu(){
//       if(!mobileMenu) return;
//       mobileMenu.classList.remove('open');
//       mobileMenu.setAttribute('aria-hidden','true');
//       mobileMenuBtn && mobileMenuBtn.setAttribute('aria-expanded','false');
//       document.body.style.overflow = '';
//     }

//     if(mobileMenuBtn){
//       mobileMenuBtn.addEventListener('click', function(e){
//         e.stopPropagation();
//         const expanded = mobileMenuBtn.getAttribute('aria-expanded') === 'true';
//         if(expanded) closeMobileMenu(); else openMobileMenu();
//       });
//     }
//     if(mobileMenuClose) mobileMenuClose.addEventListener('click', closeMobileMenu);
//     if(mobileMenu){
//       mobileMenu.addEventListener('click', function(e){
//         if(e.target === mobileMenu) closeMobileMenu();
//       });
//     }
//     document.addEventListener('keydown', function(e){
//       if(e.key === 'Escape') closeMobileMenu();
//     });

//     // mobile links scroll & close
//     mobileMenuLinks.forEach(link => {
//       link.addEventListener('click', function(e){
//         e.preventDefault();
//         const target = link.getAttribute('data-target');
//         if(target){
//           const el = document.getElementById(target);
//           if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
//         }
//         closeMobileMenu();
//       });
//     });

//     if(mobileSignInBtn){
//       mobileSignInBtn.addEventListener('click', function(){
//         const desktopBtn = document.getElementById('google-signin-btn');
//         if(desktopBtn) desktopBtn.click();
//       });
//     }
//     if(mobileThemeToggle){
//       mobileThemeToggle.addEventListener('click', function(){
//         if(themeToggle){
//           themeToggle.checked = !themeToggle.checked;
//           themeToggle.dispatchEvent(new Event('change'));
//         }
//       });
//     }

//     // Insights functionality: uses global 'transactions' and existing filterMonth element
//     // const insightsSelect = document.getElementById('insights-category');
//     // const globalMonthFilter = document.getElementById('filter-month');
//     // const insightsContainer = document.querySelector('.insights');

//     // if(insightsContainer){
//     //   let insightsSummary = document.getElementById('insights-summary');
//     //   if(!insightsSummary){
//     //     insightsSummary = document.createElement('div');
//     //     insightsSummary.id = 'insights-summary';
//     //     insightsSummary.className = 'insights-summary';
//     //     insightsContainer.appendChild(insightsSummary);
//     //   }

//     //   function formatMoney(v){ return '$'+Number(v||0).toFixed(2); }

//     //   function getFilteredTransactions(category, monthLabel){
//     //     // use the globally-exposed transactions
//     //     if(!window.transactions) return [];
//     //     let arr = window.transactions.slice();
//     //     if(category && category !== 'all'){
//     //       arr = arr.filter(t => String(t.category) === String(category));
//     //     }
//     //     if(monthLabel && monthLabel !== 'all'){
//     //       const [mName, y] = monthLabel.split(' ');
//     //       const monthIndex = new Date(mName + ' 1, ' + y).getMonth();
//     //       arr = arr.filter(t => {
//     //         if(!t.date) return false;
//     //         const d = new Date(t.date);
//     //         return d.getFullYear() === parseInt(y,10) && d.getMonth() === monthIndex;
//     //       });
//     //     }
//     //     return arr;
//     //   }

//     //   function updateInsights(){
//     //     const category = insightsSelect ? insightsSelect.value : 'all';
//     //     const monthLabel = globalMonthFilter ? globalMonthFilter.value : 'all';
//     //     const items = getFilteredTransactions(category, monthLabel);

//     //     let income = 0, expense = 0;
//     //     items.forEach(t => {
//     //       if(t.type && String(t.type).toLowerCase() === 'income') income += Number(t.amount || 0);
//     //       else if(t.type && String(t.type).toLowerCase() === 'expense') expense += Math.abs(Number(t.amount || 0));
//     //       else {
//     //         if(Number(t.amount) >= 0) income += Number(t.amount || 0);
//     //         else expense += Math.abs(Number(t.amount || 0));
//     //       }
//     //     });
//     //     const balance = income - expense;

//     //     insightsSummary.innerHTML = '';
//     //     const cards = [
//     //       {title:'Income', val: formatMoney(income), cls:'income'},
//     //       {title:'Expense', val: formatMoney(expense), cls:'expense'},
//     //       {title:'Balance', val: formatMoney(balance), cls:'balance'}
//     //     ];
//     //     cards.forEach(c => {
//     //       const d = document.createElement('div');
//     //       d.className = 'insight-card';
//     //       d.innerHTML = '<h4>'+c.title+'</h4><p class="'+c.cls+'">'+c.val+'</p>';
//     //       insightsSummary.appendChild(d);
//     //     });
//     //   }

//     //   if(insightsSelect) insightsSelect.addEventListener('change', updateInsights);
//     //   if(globalMonthFilter) globalMonthFilter.addEventListener('change', updateInsights);

//     //   // Hook into existing refreshAllViews if available
//     //   if(typeof window.refreshAllViews === 'function'){
//     //     const orig = window.refreshAllViews;
//     //     window.refreshAllViews = function(){
//     //       try{ orig(); }catch(e){ console.warn(e); }
//     //       updateInsights();
//     //     };
//     //   } else {
//     //     updateInsights();
//     //     setInterval(updateInsights, 2000);
//     //   }
//     // }
//   });
// })();
