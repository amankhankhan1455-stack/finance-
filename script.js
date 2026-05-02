// Global Configuration
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyNGYCbfg_mRpfBN07Ez1dQJuKhhHILFOs-D3ElVlo3Jw0wYpqXFUnmMEYz4iK27BuX/exec";
const USD_TO_INR = 83; // 1 USD = 83 INR

// Auth Check (Immediate)
const currentUser = localStorage.getItem("currentUser");
if (!currentUser && !window.location.href.includes('login.html')) {
    window.location.href = "login.html";
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Loaded - Initializing Dashboard...");

    // UI Elements
    const sidebar = document.getElementById('sidebar');
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const currencySelector = document.getElementById('currencySelector');
    const userNameEl = document.querySelector(".user-name");

    // Global Instances
    let barChartInstance = null;
    let pieChartInstance = null;
    let analyticsLineChartInstance = null;
    let analyticsBalanceChartInstance = null;
    let currentEditId = null;
    let currentCardEditId = null;

    // Formatting Helpers
    function formatCurrencyDisplay(amount) {
        const inr = amount;
        const usd = amount / USD_TO_INR;
        const inrStr = `₹${inr.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        const usdStr = `$${usd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        if (currencySelector && currencySelector.value === 'USD') {
            return `${usdStr} <span class="secondary-currency">(${inrStr})</span>`;
        }
        return `${inrStr} <span class="secondary-currency">(${usdStr})</span>`;
    }

    function getConvertedValue(amount) {
        return (currencySelector && currencySelector.value === 'USD') ? amount / USD_TO_INR : amount;
    }

    // --- Data Module ---
    const FinanceData = {
        getStorageKey(prefix) {
            const user = localStorage.getItem('currentUser');
            return user ? `${prefix}_${user}` : prefix;
        },

        async init() {
            try {
                console.log("Syncing with cloud...");
                await fetchFromSheet();
                console.log("Cloud sync successful.");
            } catch (e) {
                console.warn("Cloud sync failed, using local data.", e);
            }
        },

        getTransactions() {
            const data = localStorage.getItem(this.getStorageKey('transactions'));
            return data && data !== 'null' ? JSON.parse(data) : [];
        },

        saveTransactions(txs) {
            localStorage.setItem(this.getStorageKey('transactions'), JSON.stringify(txs));
        },

        deleteTransaction(id) {
            const txs = this.getTransactions().filter(t => t.id !== id);
            this.saveTransactions(txs);
        },

        getGoals() {
            const data = localStorage.getItem(this.getStorageKey('goals'));
            return data && data !== 'null' ? JSON.parse(data) : [];
        },

        saveGoals(goals) {
            localStorage.setItem(this.getStorageKey('goals'), JSON.stringify(goals));
        },

        addGoal(goal) {
            const goals = this.getGoals();
            goals.push(goal);
            this.saveGoals(goals);
        },

        getCards() {
            const data = localStorage.getItem(this.getStorageKey('cards'));
            return data && data !== 'null' ? JSON.parse(data) : [];
        },

        saveCards(cards) {
            localStorage.setItem(this.getStorageKey('cards'), JSON.stringify(cards));
        },

        addCard(card) {
            const cards = this.getCards();
            cards.push(card);
            this.saveCards(cards);
        },

        deleteCard(id) {
            const cards = this.getCards().filter(c => c.id !== id);
            this.saveCards(cards);
        },

        getSummary() {
            const txs = this.getTransactions();
            let inc = 0, exp = 0;
            txs.forEach(t => {
                if (t.type === 'income') inc += t.amount;
                else exp += t.amount;
            });
            const balance = inc - exp;
            const goals = this.getGoals();
            const totalSavings = goals.reduce((acc, g) => acc + g.current, 0);
            const totalTarget = goals.reduce((acc, g) => acc + g.target, 0);
            const progress = totalTarget > 0 ? (totalSavings / totalTarget) * 100 : 0;
            return { totalIncome: inc, totalExpense: exp, balance, totalSavings, goalProgress: progress };
        }
    };

    // --- UI Update Modules ---
    function updateSummaryCards() {
        const s = FinanceData.getSummary();
        const bEl = document.getElementById('totalBalanceAmt');
        const iEl = document.getElementById('totalIncomeAmt');
        const eEl = document.getElementById('totalExpenseAmt');
        const sEl = document.getElementById('totalSavingsAmt');
        
        if (bEl) bEl.innerHTML = formatCurrencyDisplay(s.balance);
        if (iEl) iEl.innerHTML = formatCurrencyDisplay(s.totalIncome);
        if (eEl) eEl.innerHTML = formatCurrencyDisplay(s.totalExpense);
        if (sEl) sEl.innerHTML = formatCurrencyDisplay(s.totalSavings);

        const progEl = document.querySelector('.progress-bar .progress');
        if (progEl) progEl.style.width = `${s.goalProgress}%`;

        // Monthly Stats
        const now = new Date(), m = now.getMonth(), y = now.getFullYear();
        let mInc = 0, mExp = 0;
        FinanceData.getTransactions().forEach(t => {
            const d = new Date(t.date);
            if (d.getMonth() === m && d.getFullYear() === y) {
                if (t.type === 'income') mInc += t.amount;
                else mExp += t.amount;
            }
        });

        const mIncEl = document.getElementById('monthlyIncomeAmt');
        const mExpEl = document.getElementById('monthlyExpenseAmt');
        const mSavEl = document.getElementById('monthlySavingsAmt');
        const mLabEl = document.getElementById('currentMonthLabel');

        if (mIncEl) mIncEl.innerHTML = formatCurrencyDisplay(mInc);
        if (mExpEl) mExpEl.innerHTML = formatCurrencyDisplay(mExp);
        if (mSavEl) mSavEl.innerHTML = formatCurrencyDisplay(mInc - mExp);
        if (mLabEl) mLabEl.innerText = `(${now.toLocaleString('default', { month: 'long' })} ${y})`;
    }

    function renderTransactions(query = '', type = 'all', cat = 'all') {
        const dList = document.getElementById('transactionsList');
        const fList = document.getElementById('fullTransactionsList');
        if (!dList && !fList) return;

        let txs = FinanceData.getTransactions();
        txs.sort((a, b) => new Date(b.date) - new Date(a.date));

        const filtered = txs.filter(t => {
            const mQ = t.desc.toLowerCase().includes(query.toLowerCase());
            const mT = type === 'all' || t.type === type;
            const mC = cat === 'all' || t.category === cat;
            return mQ && mT && mC;
        });

        const render = (container, list, limit = null) => {
            if (!container) return;
            container.innerHTML = '';
            const items = limit ? list.slice(0, limit) : list;
            if (items.length === 0) {
                container.innerHTML = '<div class="empty-state"><h4>No data found</h4></div>';
                return;
            }

            items.forEach(t => {
                const isExp = t.type === 'expense';
                container.insertAdjacentHTML('beforeend', `
                    <div class="transaction-item fade-in">
                        <div class="tx-left">
                            <div class="tx-icon ${isExp ? 'sub' : 'add'}"><i class='bx bx-receipt'></i></div>
                            <div class="tx-details"><h4>${t.desc}</h4><p>${t.date}</p></div>
                        </div>
                        <div class="tx-right-group">
                            <div class="tx-right ${isExp ? 'negative' : 'positive'}">${isExp ? '-' : '+'}${formatCurrencyDisplay(t.amount)}</div>
                            <button class="edit-tx-btn" data-id="${t.id}"><i class='bx bx-edit-alt'></i></button>
                            <button class="delete-tx-btn" data-id="${t.id}"><i class='bx bx-trash'></i></button>
                        </div>
                    </div>
                `);
            });

            // Action Listeners
            container.querySelectorAll('.edit-tx-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tx = FinanceData.getTransactions().find(x => x.id == btn.dataset.id);
                    if (tx) {
                        currentEditId = tx.id;
                        document.querySelector('#transactionModal h3').innerText = "Edit Transaction";
                        document.getElementById('expType').value = tx.type;
                        document.getElementById('expAmount').value = tx.amount;
                        document.getElementById('expCategory').value = tx.category;
                        document.getElementById('expDate').value = tx.date;
                        document.getElementById('expDesc').value = tx.desc;
                        document.getElementById('transactionModal').classList.add('active');
                    }
                });
            });

            container.querySelectorAll('.delete-tx-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('Delete this transaction?')) {
                        FinanceData.deleteTransaction(parseFloat(btn.dataset.id));
                        renderTransactions();
                        await sendToSheet({ action: 'delete', id: btn.dataset.id });
                        await fetchFromSheet();
                    }
                });
            });
        };

        render(dList, txs, 5);
        render(fList, filtered);
        updateSummaryCards();
        updateCharts(txs);
        updateInsights(txs);
        updateAnalyticsCharts();
    }

    function renderCards() {
        const grid = document.getElementById('cardsGrid');
        if (!grid) return;
        const cards = FinanceData.getCards();
        grid.innerHTML = '';

        if (cards.length === 0) {
            grid.innerHTML = '<div class="empty-state"><h4>No cards added</h4></div>';
            return;
        }

        cards.forEach((c, idx) => {
            const gr = ['#1e293b', '#4c1d95', '#064e3b', '#7c2d12'][idx % 4];
            grid.insertAdjacentHTML('beforeend', `
                <div class="credit-card-widget fade-in" style="background: linear-gradient(135deg, ${gr} 0%, #000 100%);">
                    <div class="card-actions">
                        <button class="card-action-btn edit" data-id="${c.id}"><i class='bx bx-edit-alt'></i></button>
                        <button class="card-action-btn delete" data-id="${c.id}"><i class='bx bx-trash'></i></button>
                    </div>
                    <div class="cc-header"><div class="cc-chip"></div><i class='bx bxl-${c.type} cc-type-icon'></i></div>
                    <span class="cc-number">**** **** **** ${c.number}</span>
                    <div class="cc-footer">
                        <div class="cc-info"><label>Holder</label><h4>${c.holder}</h4></div>
                        <div class="cc-info"><label>Expires</label><h4>${c.expiry}</h4></div>
                    </div>
                </div>
            `);
        });

        grid.querySelectorAll('.card-action-btn.delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseFloat(btn.dataset.id);
                if (confirm('Are you sure you want to remove this card from your wallet?')) {
                    FinanceData.deleteCard(id);
                    console.log(`Card with ID ${id} removed.`);
                    renderCards();
                }
            });
        });

        grid.querySelectorAll('.card-action-btn.edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const card = FinanceData.getCards().find(x => x.id == btn.dataset.id);
                if (card) {
                    currentCardEditId = card.id;
                    document.querySelector('#cardModal h3').innerText = "Edit Card";
                    document.getElementById('cardNumber').value = card.number;
                    document.getElementById('cardHolder').value = card.holder;
                    document.getElementById('cardExpiry').value = card.expiry;
                    document.getElementById('cardType').value = card.type;
                    document.getElementById('cardModal').classList.add('active');
                }
            });
        });
    }

    function renderGoals() {
        const grid = document.getElementById('goalsGrid');
        if (!grid) return;
        const goals = FinanceData.getGoals();
        grid.innerHTML = '';
        goals.forEach(g => {
            const p = (g.current / g.target) * 100;
            grid.insertAdjacentHTML('beforeend', `
                <div class="card glass-panel fade-in">
                    <div class="card-header"><span class="card-title">${g.name}</span></div>
                    <div class="card-body">
                        <h3>$${g.current.toLocaleString()} / $${g.target.toLocaleString()}</h3>
                        <div class="progress-bar"><div class="progress" style="width: ${p}%; background: ${g.color};"></div></div>
                    </div>
                </div>
            `);
        });
    }

    // --- Analytics Logic ---
    function updateCharts(txs) {
        const ctx = document.getElementById('barChart');
        const pieCtx = document.getElementById('pieChart');
        if (!ctx || !pieCtx) return;
        const mLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mData = Array(12).fill(0);
        const cData = {};
        txs.forEach(t => {
            if (t.type === 'expense') {
                mData[new Date(t.date).getMonth()] += t.amount;
                cData[t.category] = (cData[t.category] || 0) + t.amount;
            }
        });
        if (barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(ctx, { type: 'bar', data: { labels: mLabels, datasets: [{ label: 'Expenses', data: mData, backgroundColor: '#3b82f6' }] }, options: { responsive: true, maintainAspectRatio: false } });
        if (pieChartInstance) pieChartInstance.destroy();
        pieChartInstance = new Chart(pieCtx, { type: 'doughnut', data: { labels: Object.keys(cData), datasets: [{ data: Object.values(cData), backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981'] }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%' } });
    }

    function updateAnalyticsCharts() {
        const lineCtx = document.getElementById('analyticsLineChart');
        const balCtx = document.getElementById('analyticsBalanceChart');
        if (!lineCtx || !balCtx) return;
        const txs = FinanceData.getTransactions();
        const mLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const incD = Array(12).fill(0), expD = Array(12).fill(0), balD = Array(12).fill(0);
        let curB = 0;
        [...txs].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(t => {
            const m = new Date(t.date).getMonth();
            if (t.type === 'income') curB += t.amount; else curB -= t.amount;
            if (t.type === 'income') incD[m] += t.amount; else expD[m] += t.amount;
            balD[m] = curB;
        });
        if (analyticsLineChartInstance) analyticsLineChartInstance.destroy();
        analyticsLineChartInstance = new Chart(lineCtx, { type: 'line', data: { labels: mLabels, datasets: [{ label: 'Income', data: incD, borderColor: '#10b981' }, { label: 'Expenses', data: expD, borderColor: '#ef4444' }] }, options: { responsive: true, maintainAspectRatio: false } });
        if (analyticsBalanceChartInstance) analyticsBalanceChartInstance.destroy();
        analyticsBalanceChartInstance = new Chart(balCtx, { type: 'line', data: { labels: mLabels, datasets: [{ label: 'Net Balance', data: balD, borderColor: '#3b82f6', fill: true }] }, options: { responsive: true, maintainAspectRatio: false } });
    }

    function updateInsights(txs) {
        const list = document.getElementById('insightsList');
        if (!list) return;
        list.innerHTML = '';
        
        if (txs.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>Add transactions to see smart insights.</p></div>';
            return;
        }

        const summary = FinanceData.getSummary();
        const rate = summary.totalIncome > 0 ? ((summary.totalIncome - summary.totalExpense) / summary.totalIncome) * 100 : 0;
        const insights = [];

        // 1. Savings Rate Analysis
        if (rate > 20) {
            insights.push({ title: 'Great Savings!', text: `You saved ${Math.round(rate)}% of your income this period. High five!`, icon: 'bx-trending-up', color: 'success' });
        } else if (rate > 0 && rate < 10) {
            insights.push({ title: 'Increase Savings', text: 'Your savings rate is low. Try the 50/30/20 budget rule.', icon: 'bx-shield-quarter', color: 'warning' });
        } else if (rate < 0) {
            insights.push({ title: 'Negative Balance', text: 'You spent more than you earned. Review your fixed costs.', icon: 'bx-error-circle', color: 'danger' });
        }

        // 2. Category Concentration
        const catData = {};
        txs.filter(t => t.type === 'expense').forEach(t => {
            catData[t.category] = (catData[t.category] || 0) + t.amount;
        });

        const sortedCats = Object.keys(catData).sort((a,b) => catData[b] - catData[a]);
        if (sortedCats.length > 0) {
            const topCat = sortedCats[0];
            const topPct = (catData[topCat] / summary.totalExpense) * 100;
            if (topPct > 40) {
                const text = `${topCat.charAt(0).toUpperCase() + topCat.slice(1)} accounts for ${Math.round(topPct)}% of your expenses.`;
                insights.push({ title: 'Spending Alert', text, icon: 'bx-pie-chart-alt', color: 'warning' });
                
                // Add notification if not already sent for this high spend (simple check)
                const lastNotif = NotificationManager.get()[0];
                if (!lastNotif || !lastNotif.text.includes(topCat)) {
                    NotificationManager.add({ title: 'Budget Warning', text, type: 'warning', icon: 'bx-error-circle' });
                }
            }
        }

        // 3. Spending Trends (Daily Pace)
        const days = new Set(txs.map(t => t.date)).size;
        const avgDaily = days > 0 ? summary.totalExpense / days : 0;
        if (avgDaily > 0) {
            insights.push({ title: 'Spending Pace', text: `You spend roughly ${formatCurrencyDisplay(avgDaily)} per active day.`, icon: 'bx-stopwatch', color: 'info' });
        }

        if (insights.length === 0) {
            insights.push({ title: 'Looking Good', text: 'Your spending is well-balanced across categories.', icon: 'bx-check-circle', color: 'success' });
        }
        
        insights.forEach(i => {
            const colors = { success: '#10b981', danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
            list.insertAdjacentHTML('beforeend', `
                <div class="insight-card fade-in">
                    <div class="insight-icon" style="color: ${colors[i.color]};"><i class='bx ${i.icon}'></i></div>
                    <div class="insight-content"><h4>${i.title}</h4><p>${i.text}</p></div>
                </div>
            `);
        });
    }

    // --- Notification Manager ---
    const NotificationManager = {
        get() {
            const user = localStorage.getItem('currentUser');
            return JSON.parse(localStorage.getItem(`notifs_${user}`)) || [];
        },
        add(notif) {
            const user = localStorage.getItem('currentUser');
            const notifs = this.get();
            notifs.unshift({ ...notif, id: Date.now(), time: new Date().toLocaleTimeString(), read: false });
            localStorage.setItem(`notifs_${user}`, JSON.stringify(notifs.slice(0, 20))); // Keep last 20
            this.render();
        },
        clear() {
            const user = localStorage.getItem('currentUser');
            localStorage.setItem(`notifs_${user}`, JSON.stringify([]));
            this.render();
        },
        markAllRead() {
            const user = localStorage.getItem('currentUser');
            const notifs = this.get().map(n => ({ ...n, read: true }));
            localStorage.setItem(`notifs_${user}`, JSON.stringify(notifs));
            this.render();
        },
        render() {
            const list = document.getElementById('notifList');
            const badge = document.getElementById('notifBadge');
            if (!list) return;

            const notifs = this.get();
            const unread = notifs.filter(n => !n.read).length;

            if (badge) {
                badge.innerText = unread;
                badge.style.display = unread > 0 ? 'block' : 'none';
            }

            if (notifs.length === 0) {
                list.innerHTML = '<div class="empty-state" style="padding: 20px;"><p>No notifications</p></div>';
                return;
            }

            list.innerHTML = notifs.map(n => `
                <div class="notif-item ${n.type || 'info'}">
                    <i class='bx ${n.icon || 'bx-bell'}'></i>
                    <div class="notif-item-content">
                        <h4>${n.title}</h4>
                        <p>${n.text}</p>
                        <span class="notif-time">${n.time}</span>
                    </div>
                </div>
            `).join('');
        }
    };

    // Notification Listeners
    document.getElementById('notificationBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('notifDropdown').classList.toggle('active');
        NotificationManager.markAllRead();
    });

    document.getElementById('clearNotifs')?.addEventListener('click', (e) => {
        e.stopPropagation();
        NotificationManager.clear();
    });

    document.addEventListener('click', () => {
        document.getElementById('notifDropdown')?.classList.remove('active');
    });

    document.getElementById('notifDropdown')?.addEventListener('click', (e) => e.stopPropagation());

    // --- Chatbot Logic ---
    const chatbotToggle = document.getElementById('chatbotToggleBtn');
    const chatbotPanel = document.getElementById('chatbotPanel');
    const closeChatbot = document.getElementById('closeChatbotBtn');
    const chatbotSend = document.getElementById('chatbotSendBtn');
    const chatbotInput = document.getElementById('chatbotInput');
    const chatbotMessages = document.getElementById('chatbotMessages');

    function addChatMessage(text, isAi = false) {
        if (!chatbotMessages) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isAi ? 'ai-message' : 'user-message'} fade-in`;
        msgDiv.innerHTML = `<div class="msg-bubble">${text}</div>`;
        chatbotMessages.appendChild(msgDiv);
        chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    }

    function generateBotResponse(text) {
        const msg = text.toLowerCase();
        let response = "I'm not sure about that. Try asking about your 'expenses', 'savings', or 'balance'!";
        
        if (msg.includes("hello") || msg.includes("hi")) {
            response = "Hello! I'm your AI Financial Advisor. How can I help you manage your money today?";
        } else if (msg.includes("expense") || msg.includes("spend")) {
            const summary = FinanceData.getSummary();
            response = `Your total expenses so far are ${formatCurrencyDisplay(summary.totalExpense).replace(/<[^>]*>/g, '')}. You should check the insights panel for more details.`;
        } else if (msg.includes("save") || msg.includes("savings")) {
            const summary = FinanceData.getSummary();
            response = `You've currently saved ${formatCurrencyDisplay(summary.totalSavings).replace(/<[^>]*>/g, '')}. Keep consistent and you'll reach your goals!`;
        } else if (msg.includes("balance")) {
            const summary = FinanceData.getSummary();
            response = `Your net balance is ${formatCurrencyDisplay(summary.balance).replace(/<[^>]*>/g, '')}.`;
        } else if (msg.includes("card")) {
            const cards = FinanceData.getCards();
            response = `You have ${cards.length} cards connected to your dashboard.`;
        } else if (msg.includes("thank")) {
            response = "You're very welcome! Let me know if you need anything else.";
        }

        console.log("Chatbot responding...");
        setTimeout(() => addChatMessage(response, true), 600);
    }

    chatbotToggle?.addEventListener('click', () => {
        chatbotPanel.classList.toggle('active');
        console.log("Chatbot toggled");
    });

    closeChatbot?.addEventListener('click', () => {
        chatbotPanel.classList.remove('active');
    });

    const sendUserMessage = () => {
        const text = chatbotInput.value.trim();
        if (!text) return;
        
        console.log("User sent message:", text);
        addChatMessage(text);
        chatbotInput.value = '';
        generateBotResponse(text);
    };

    chatbotSend?.addEventListener('click', sendUserMessage);
    chatbotInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendUserMessage();
    });

    // --- Listeners & Handlers ---
    console.log("Setting up event listeners...");

    menuToggleBtn?.addEventListener('click', () => sidebar.classList.add('active'));
    closeSidebarBtn?.addEventListener('click', () => sidebar.classList.remove('active'));

    document.getElementById('openAddModalBtn')?.addEventListener('click', () => {
        currentEditId = null;
        document.querySelector('#transactionModal h3').innerText = "Add New Transaction";
        document.getElementById('expenseForm').reset();
        document.getElementById('transactionModal').classList.add('active');
    });

    document.getElementById('closeModalBtn')?.addEventListener('click', () => document.getElementById('transactionModal').classList.remove('active'));

    document.getElementById('openAddCardModalBtn')?.addEventListener('click', () => {
        currentCardEditId = null;
        document.querySelector('#cardModal h3').innerText = "Add New Card";
        document.getElementById('cardForm').reset();
        document.getElementById('cardModal').classList.add('active');
    });

    document.getElementById('closeCardModalBtn')?.addEventListener('click', () => document.getElementById('cardModal').classList.remove('active'));

    // Goal Modal Listeners
    document.getElementById('openAddGoalModalBtn')?.addEventListener('click', () => {
        console.log("Opening Add Goal Modal");
        document.getElementById('goalForm').reset();
        document.getElementById('goalModal').classList.add('active');
    });

    document.getElementById('closeGoalModalBtn')?.addEventListener('click', () => {
        console.log("Closing Goal Modal");
        document.getElementById('goalModal').classList.remove('active');
    });

    document.getElementById('expenseForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const txData = {
            id: currentEditId || Date.now(),
            type: document.getElementById('expType').value,
            amount: parseFloat(document.getElementById('expAmount').value),
            category: document.getElementById('expCategory').value,
            date: document.getElementById('expDate').value,
            desc: document.getElementById('expDesc').value,
            time: new Date().toLocaleTimeString()
        };

        // 1. Optimistic UI Update (Instant feedback)
        console.log("Optimistic update: Adding transaction to local storage...");
        const txs = FinanceData.getTransactions();
        if (currentEditId) {
            const idx = txs.findIndex(t => t.id === currentEditId);
            if (idx !== -1) txs[idx] = txData;
        } else {
            txs.push(txData);
        }
        FinanceData.saveTransactions(txs);
        renderTransactions(); // Refresh UI immediately
        
        NotificationManager.add({
            title: currentEditId ? 'Transaction Updated' : 'New Transaction',
            text: `${txData.type === 'income' ? 'Income' : 'Expense'} of ${formatCurrencyDisplay(txData.amount)} added.`,
            type: txData.type === 'income' ? 'success' : 'info',
            icon: txData.type === 'income' ? 'bx-trending-up' : 'bx-shopping-bag'
        });

        document.getElementById('transactionModal').classList.remove('active');
        document.getElementById('expenseForm').reset();

        // 2. Cloud Sync (Background)
        const u = JSON.parse(localStorage.getItem('user_' + localStorage.getItem('currentUser'))) || {};
        try {
            await sendToSheet({ 
                action: currentEditId ? 'update' : 'add', 
                email: localStorage.getItem('currentUser'), 
                name: u.name, 
                ...txData, 
                description: txData.desc 
            });
            await fetchFromSheet(); // Sync back to ensure server-side IDs and ordering
        } catch (err) {
            console.error("Cloud sync failed:", err);
            alert("Warning: Could not sync with Google Sheets. Data is saved locally.");
        }
        
        currentEditId = null;
    });

    document.getElementById('cardForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const num = document.getElementById('cardNumber').value.trim();
        const hol = document.getElementById('cardHolder').value.trim();
        const exp = document.getElementById('cardExpiry').value.trim();
        const typ = document.getElementById('cardType').value;
        
        if (num.length !== 4 || isNaN(num)) return alert("Enter 4-digit card number");
        
        const cards = FinanceData.getCards();
        if (currentCardEditId) {
            const idx = cards.findIndex(c => c.id === currentCardEditId);
            if (idx !== -1) cards[idx] = { id: currentCardEditId, number: num, holder: hol, expiry: exp, type: typ };
        } else {
            cards.push({ id: Date.now(), number: num, holder: hol, expiry: exp, type: typ });
        }
        FinanceData.saveCards(cards);
        console.log("Cards saved to persistent storage:", cards);
        renderCards();
        document.getElementById('cardModal').classList.remove('active');
    });

    // Goal Form Submission
    document.getElementById('goalForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log("Goal form submitted");

        const name = document.getElementById('goalName').value.trim();
        const target = parseFloat(document.getElementById('goalTarget').value);
        const initial = parseFloat(document.getElementById('goalInitial').value) || 0;
        const color = document.getElementById('goalColor').value;

        console.log("Goal Data:", { name, target, initial, color });

        if (!name || isNaN(target) || target <= 0) {
            alert("Please enter a valid goal name and target amount.");
            return;
        }

        const newGoal = {
            id: Date.now(),
            name: name,
            target: target,
            current: initial,
            color: color
        };

        FinanceData.addGoal(newGoal);
        console.log("Goal added successfully:", newGoal);

        renderGoals();
        updateSummaryCards(); // Update total savings progress on dashboard

        NotificationManager.add({
            title: 'Goal Created',
            text: `Success! You've started a new goal: ${name}`,
            type: 'success',
            icon: 'bx-target-lock'
        });

        document.getElementById('goalModal').classList.remove('active');
        document.getElementById('goalForm').reset();
    });

    // Quick Transfer Logic
    let selectedContact = null;
    document.querySelectorAll('.contact-avatar').forEach(avatar => {
        avatar.addEventListener('click', () => {
            document.querySelectorAll('.contact-avatar').forEach(a => a.classList.remove('selected'));
            avatar.classList.add('selected');
            selectedContact = avatar.dataset.name;
            console.log("Selected contact:", selectedContact);
        });
    });

    document.getElementById('quickTransferBtn')?.addEventListener('click', async () => {
        const amountInput = document.getElementById('quickTransferAmount');
        const amount = parseFloat(amountInput.value);
        
        console.log("Quick Transfer Attempted:", { selectedContact, amount });

        if (!selectedContact) {
            alert("❌ Please select a contact (Alice, Bob, or Charlie) first!");
            return;
        }
        if (isNaN(amount) || amount <= 0) {
            alert("❌ Please enter a valid positive amount.");
            return;
        }

        const transferData = {
            id: Date.now(),
            type: 'expense',
            amount: amount,
            category: 'transfer',
            date: new Date().toISOString().split('T')[0],
            desc: `Quick Transfer to ${selectedContact}`,
            time: new Date().toLocaleTimeString()
        };

        // 1. Instant UI Update (Optimistic)
        console.log("Processing One-Click Transfer...");
        const txs = FinanceData.getTransactions();
        txs.push(transferData);
        FinanceData.saveTransactions(txs);
        renderTransactions(); // This updates charts, summary, and lists instantly
        
        NotificationManager.add({
            title: 'Transfer Sent',
            text: `Quick transfer of ${amount} to ${selectedContact} completed.`,
            type: 'success',
            icon: 'bx-paper-plane'
        });
        
        // 2. Clear UI immediately
        amountInput.value = '';
        document.querySelectorAll('.contact-avatar').forEach(a => a.classList.remove('selected'));
        const nameToReset = selectedContact;
        selectedContact = null;
        
        console.log(`Success: Transferred ${amount} to ${nameToReset}`);

        // 3. Background Cloud Sync
        const u = JSON.parse(localStorage.getItem('user_' + localStorage.getItem('currentUser'))) || {};
        try {
            await sendToSheet({ 
                action: 'add', 
                email: localStorage.getItem('currentUser'), 
                name: u.name, 
                ...transferData, 
                description: transferData.desc 
            });
            await fetchFromSheet(); // Final sync with Google Sheets source of truth
        } catch (e) {
            console.error("Cloud Transfer Sync Failed:", e);
        }
    });

    // --- UPI Transfer Logic ---
    const upiPayBtn = document.getElementById('upiPayBtn');
    const upiIdInput = document.getElementById('upiIdInput');
    const upiAmountInput = document.getElementById('upiAmountInput');
    const upiLoadingModal = document.getElementById('upiLoadingModal');
    const upiSuccessModal = document.getElementById('upiSuccessModal');

    upiPayBtn?.addEventListener('click', async () => {
        const upiId = upiIdInput.value.trim();
        const amount = parseFloat(upiAmountInput.value);

        console.log("UPI Payment Initiated:", { upiId, amount });

        // 1. Validation
        if (!upiId.includes('@') || upiId.length < 3) {
            alert("❌ Please enter a valid UPI ID (e.g., name@bank)");
            return;
        }
        if (isNaN(amount) || amount <= 0) {
            alert("❌ Please enter a valid payment amount.");
            return;
        }

        // 2. Show Loading Simulation
        upiLoadingModal.classList.add('active');

        // 3. Simulate Processing (1.5 seconds)
        setTimeout(async () => {
            const txnId = 'TXN' + Math.floor(Math.random() * 10000000000);
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateTimeDisplay = `${now.getDate()} ${now.toLocaleString('default', { month: 'short' })} ${now.getFullYear()}, ${timeStr}`;

            const upiTxData = {
                id: Date.now(),
                type: 'expense',
                amount: amount,
                category: 'UPI Transfer',
                date: dateStr,
                desc: `UPI Payment to ${upiId}`,
                txnId: txnId,
                time: timeStr
            };

            // 4. Save Locally
            const txs = FinanceData.getTransactions();
            txs.push(upiTxData);
            FinanceData.saveTransactions(txs);

            // 5. Update UI
            renderTransactions();
            updateSummaryCards();

            // 6. Populate Success Modal
            document.getElementById('successUpiId').innerText = upiId;
            document.getElementById('successAmount').innerText = (currencySelector.value === 'USD' ? '$' : '₹') + amount.toLocaleString();
            document.getElementById('successTxnId').innerText = txnId;
            document.getElementById('successDateTime').innerText = dateTimeDisplay;

            // 7. Toggle Modals
            upiLoadingModal.classList.remove('active');
            upiSuccessModal.classList.add('active');

            console.log("UPI Payment Successful:", upiTxData);

            // 8. Background Cloud Sync
            const u = JSON.parse(localStorage.getItem('user_' + localStorage.getItem('currentUser'))) || {};
            try {
                await sendToSheet({ 
                    action: 'add', 
                    email: localStorage.getItem('currentUser'), 
                    name: u.name, 
                    ...upiTxData,
                    description: upiTxData.desc
                });
                await fetchFromSheet();
            } catch (e) {
                console.error("UPI Cloud Sync Failed:", e);
            }

            // Reset Inputs
            upiIdInput.value = '';
            upiAmountInput.value = '';
        }, 1500);
    });

    document.getElementById('closeUpiSuccessBtn')?.addEventListener('click', () => {
        upiSuccessModal.classList.remove('active');
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('currentUser');
        window.location.href = 'login.html';
    });

    currencySelector?.addEventListener('change', () => renderTransactions());

    // Navigation
    document.querySelectorAll('.nav-item[data-target]').forEach(item => {
        item.addEventListener('click', () => {
            const target = item.dataset.target;
            document.querySelectorAll('.view-section').forEach(s => s.classList.toggle('active', s.id === target));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.target === target));
            sidebar.classList.remove('active');
        });
    });

    // --- Final Execution ---
    await FinanceData.init();
    renderTransactions();
    console.log("Loading cards from storage...");
    renderCards();
    renderGoals();
    NotificationManager.render();

    // Set User Name
    const user = JSON.parse(localStorage.getItem('user_' + localStorage.getItem('currentUser'))) || {};
    if (userNameEl && user.name) userNameEl.innerText = user.name;
    const pName = document.getElementById('profileDisplayName');
    if (pName && user.name) pName.innerText = user.name;
    const pEmail = document.getElementById('profileDisplayEmail');
    if (pEmail && user.email) pEmail.innerText = user.email;

}); // CLOSING DOMContentLoaded CORRECTLY

// --- API Functions (Outside scope) ---
async function fetchFromSheet() {
    const user = localStorage.getItem('currentUser');
    if (!user) return;
    const resp = await fetch(`${SCRIPT_URL}?email=${encodeURIComponent(user)}`);
    const data = await resp.json();
    const txs = data.map(r => ({ id: r.id || Date.now(), type: r.type || 'expense', amount: parseFloat(r.amount) || 0, category: (r.category || 'other').toLowerCase(), date: r.date || new Date().toISOString().split('T')[0], desc: r.description || r.name || "Sync" }));
    localStorage.setItem(`transactions_${user}`, JSON.stringify(txs));
    if (typeof renderTransactions === 'function') renderTransactions();
}

async function sendToSheet(data) {
    try {
        await fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify(data) });
        console.log("Synced ✅");
    } catch (e) { console.error("Send error", e); }
}