/**
 * TaskForge Frontend v4 — Improved Security, UX & Code Quality
 * 
 * Changes from v3:
 * - XSS: all user content is sanitized before DOM insertion
 * - Removed browser-side `process.env` reference (doesn't exist in browsers)
 * - Toast notifications replace intrusive alert() calls
 * - Debounced / guarded network calls prevent duplicate requests
 * - Better loading & error states
 * - Wallet disconnect actually resets state
 * - postTask validates inputs before prompting wallet
 */

const CONTRACT_ABI = [
    {
        inputs: [
            { name: "_description", type: "string" },
            { name: "_category",    type: "uint8"  },
            { name: "_deadlineHours", type: "uint256" }
        ],
        name: "postJob",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "payable",
        type: "function"
    },
    {
        inputs: [{ name: "_jobId", type: "uint256" }],
        name: "approveResult",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    }
];

// ─── State ───────────────────────────────────────────
let wallet = null;
let contract = null;
let contractAddress = null;
let ws = null;
let isLoadingTasks = false;

// ─── Helpers ─────────────────────────────────────────

/** Prevent XSS — escape HTML entities */
function esc(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = String(str);
    return el.innerHTML;
}

function formatAddr(addr) {
    if (!addr || addr === '0x0000000000000000000000000000000000000000') return '—';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function formatTime(deadline) {
    const diff = new Date(deadline) - Date.now();
    if (diff < 0) return 'Expired';
    const hrs = Math.floor(diff / 3_600_000);
    if (hrs > 24) return Math.floor(hrs / 24) + 'd';
    if (hrs > 0) return hrs + 'h';
    const mins = Math.floor(diff / 60_000);
    return mins + 'm';
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
}

// ─── Toast Notifications ─────────────────────────────

function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span>${esc(message)}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ─── Boot ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    setupNavigation();
    await loadContractAddress();
    await Promise.all([loadStats(), loadTasks(), loadAgentStatus()]);
    setupWebSocket();
    checkWallet();

    // Auto-start agent (fire-and-forget)
    fetch('/api/worker/start', { method: 'POST' }).catch(() => {});
});

// ─── Contract Config ─────────────────────────────────

async function loadContractAddress() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('Config endpoint failed');
        const data = await res.json();
        if (data.success && data.contractAddress) {
            contractAddress = data.contractAddress;
            console.log('Contract address loaded:', contractAddress);
        }
    } catch (err) {
        console.error('Failed to load contract address:', err);
        // Fallback: try stats endpoint
        try {
            const res2 = await fetch('/api/stats');
            const data2 = await res2.json();
            if (data2.success && data2.stats?.contractAddress) {
                contractAddress = data2.stats.contractAddress;
            }
        } catch (_) { /* silent */ }
    }
}

// ─── Navigation ──────────────────────────────────────

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// ─── Wallet ──────────────────────────────────────────

async function checkWallet() {
    if (window.ethereum) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) connectWallet();
        } catch (_) { /* user hasn't connected yet */ }
    }
}

async function connectWallet() {
    if (!window.ethereum) {
        showToast('Please install a Web3 wallet (MetaMask, Rabby, etc.)', 'warning');
        return;
    }

    const btn = document.getElementById('connectWallet');
    btn.textContent = 'Connecting…';
    btn.disabled = true;

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        wallet = accounts[0];

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();

        if (!contractAddress) await loadContractAddress();
        if (!contractAddress) throw new Error('Contract address not available');

        contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

        btn.textContent = formatAddr(wallet);
        btn.classList.add('connected');
        btn.disabled = false;

        document.getElementById('walletWarning').style.display = 'none';
        addActivity('👤 Wallet connected');

        window.ethereum.on('accountsChanged', (accts) => {
            if (accts.length === 0) { disconnectWallet(); return; }
            wallet = accts[0];
            btn.textContent = formatAddr(wallet);
        });
        window.ethereum.on('chainChanged', () => location.reload());

    } catch (err) {
        console.error('Connect failed:', err);
        showToast('Failed to connect: ' + (err.shortMessage || err.message), 'error');
        btn.textContent = 'Connect Wallet';
        btn.disabled = false;
    }
}

function disconnectWallet() {
    wallet = null;
    contract = null;

    const btn = document.getElementById('connectWallet');
    btn.textContent = 'Connect Wallet';
    btn.classList.remove('connected');
    btn.disabled = false;

    document.getElementById('walletWarning').style.display = 'none';
    addActivity('🔌 Wallet disconnected');
    loadTasks();
}

// ─── Tasks ───────────────────────────────────────────

async function loadTasks(category = 'all') {
    if (isLoadingTasks) return;
    isLoadingTasks = true;

    const list = document.getElementById('tasksList');
    list.innerHTML = '<div class="loading"><div class="spinner"></div> Loading tasks…</div>';

    try {
        const res = await fetch('/api/jobs?limit=50');
        const data = await res.json();

        if (!data.success || !data.jobs?.length) {
            list.innerHTML = '<div class="empty-state"><span class="icon">📭</span><p>No active tasks yet</p></div>';
            return;
        }

        let tasks = data.jobs;

        if (category === 'completed') {
            tasks = tasks.filter(j => j.status === 2 || j.status === 3);
        } else if (category !== 'all' && category !== '') {
            const catNum = parseInt(category, 10);
            if (!isNaN(catNum)) tasks = tasks.filter(j => j.category === catNum);
        }

        if (!tasks.length) {
            list.innerHTML = '<div class="empty-state"><p>No tasks in this category</p></div>';
            return;
        }

        list.innerHTML = tasks.map(task => `
            <div class="task-card" onclick="showTask(${Number(task.id)})" role="button" tabindex="0">
                <div class="task-card-header">
                    <span class="task-id">#${esc(String(task.id))}</span>
                    <span class="task-payment">${esc(task.payment)} MON</span>
                </div>
                <p class="task-desc">${esc(truncate(task.description, 120))}</p>
                <div class="task-footer">
                    <span class="task-cat">${esc(task.categoryName)}</span>
                    <span class="badge-status ${esc(task.statusName?.toLowerCase())}">${esc(task.statusName)}</span>
                    <span class="task-time">⏰ ${esc(formatTime(task.deadline))}</span>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('Load tasks failed:', err);
        list.innerHTML = '<div class="empty-state"><span class="icon">⚠️</span><p>Failed to load tasks</p></div>';
    } finally {
        isLoadingTasks = false;
    }
}

async function showTask(taskId) {
    taskId = Number(taskId);
    if (isNaN(taskId) || taskId < 1) return;

    try {
        const res = await fetch(`/api/jobs/${taskId}`);
        const data = await res.json();
        if (!data.success) return;

        const task = data.job;

        document.getElementById('modalTaskId').textContent = task.id;
        const statusEl = document.getElementById('modalStatus');
        statusEl.textContent = task.statusName;
        statusEl.className = 'badge-status ' + (task.statusName?.toLowerCase() || '');
        document.getElementById('modalPayment').textContent = task.payment + ' MON';
        document.getElementById('modalCategory').textContent = task.categoryName;
        document.getElementById('modalDescription').textContent = task.description;
        document.getElementById('modalClient').textContent = formatAddr(task.client);
        document.getElementById('modalAgent').textContent =
            task.worker === '0x0000000000000000000000000000000000000000'
                ? 'Waiting for agent…'
                : formatAddr(task.worker);
        document.getElementById('modalDeadline').textContent = formatTime(task.deadline);
        document.getElementById('modalStake').textContent = task.stakeRequired + ' MON';

        // Result
        const resultDiv = document.getElementById('modalResult');
        if (task.status >= 2 || (task.resultHash && task.resultHash.length > 4)) {
            resultDiv.style.display = 'block';
            let display = task.resultHash;

            if (!display || display.length < 5) {
                display = '✨ Agent has submitted work. Fetching report…';
            }

            try {
                const parsed = JSON.parse(task.resultHash);
                display = parsed.content || parsed.report || JSON.stringify(parsed, null, 2);
            } catch (_) { /* raw string */ }

            document.getElementById('modalResultText').textContent = display;
        } else {
            resultDiv.style.display = 'none';
        }

        // Actions
        const actions = document.getElementById('modalActions');
        actions.innerHTML = '';

        if (wallet && task.status === 2 && task.client?.toLowerCase() === wallet.toLowerCase()) {
            actions.innerHTML = `
                <div class="approve-box">
                    <p class="approve-label">✅ Agent work is ready for approval</p>
                    <button class="btn btn-success btn-full" onclick="approveTask(${task.id})">
                        ✓ Approve & Release ${esc(task.payment)} MON
                    </button>
                </div>
            `;
        } else if (task.status === 0) {
            actions.innerHTML = '<p class="muted small">⏳ Waiting for Forge Agent to claim…</p>';
        } else if (task.status === 1) {
            actions.innerHTML = '<p class="muted small">🤖 Forge Agent is processing…</p>';
        } else if (task.status === 3) {
            actions.innerHTML = '<p class="muted small" style="color:var(--green)">✓ Completed & Funds Released</p>';
        }

        openModal('taskModal');
    } catch (err) {
        console.error('Load task failed:', err);
        showToast('Failed to load task details', 'error');
    }
}

// ─── Post Task ───────────────────────────────────────

async function postTask() {
    if (!wallet) {
        document.getElementById('walletWarning').style.display = 'block';
        return;
    }
    if (!contract) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }

    const desc     = document.getElementById('taskDescription').value.trim();
    const cat      = parseInt(document.getElementById('taskCategory').value, 10);
    const pay      = document.getElementById('taskPayment').value;
    const deadline = parseInt(document.getElementById('taskDeadline').value, 10);

    // ── Validation ──
    if (!desc || desc.length < 10) {
        showToast('Task description must be at least 10 characters', 'warning');
        return;
    }
    if (desc.length > 2000) {
        showToast('Task description too long (max 2000 chars)', 'warning');
        return;
    }
    if (isNaN(cat) || cat < 0 || cat > 5) {
        showToast('Invalid category', 'warning');
        return;
    }
    const payNum = parseFloat(pay);
    if (isNaN(payNum) || payNum < 0.01 || payNum > 1000) {
        showToast('Payment must be between 0.01 and 1000 MON', 'warning');
        return;
    }
    if (isNaN(deadline) || deadline < 1 || deadline > 720) {
        showToast('Deadline must be between 1 and 720 hours', 'warning');
        return;
    }

    const btn = document.getElementById('submitTask');
    btn.disabled = true;
    btn.textContent = 'Confirming…';

    try {
        // Check network
        const provider = new ethers.BrowserProvider(window.ethereum);
        const network  = await provider.getNetwork();

        if (network.chainId !== 143n) {
            btn.textContent = 'Switching network…';
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x8f' }]
                });
            } catch (switchErr) {
                if (switchErr.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x8f',
                            chainName: 'Monad Mainnet',
                            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
                            rpcUrls: ['https://rpc.monad.xyz'],
                            blockExplorerUrls: ['https://monadscan.xyz']
                        }]
                    });
                } else {
                    showToast('Please switch to Monad Mainnet manually', 'warning');
                }
            }
            // Let user retry after switch
            return;
        }

        // Submit tx
        const tx = await contract.postJob(desc, cat, deadline, {
            value: ethers.parseEther(pay.toString()),
            gasLimit: 1_000_000
        });

        btn.textContent = 'Processing…';
        await tx.wait();

        closeModal('postTaskModal');
        document.getElementById('taskDescription').value = '';
        showToast('Task submitted! (' + pay + ' MON)', 'success');
        addActivity('📝 Task submitted! (' + pay + ' MON)');
        loadTasks();
        loadStats();
    } catch (err) {
        console.error('Post task error:', err);
        if (err.code !== 'ACTION_REJECTED') {
            showToast('Transaction failed: ' + (err.reason || err.shortMessage || err.message), 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Task & Pay ' + pay + ' MON';
    }
}

// ─── Approve ─────────────────────────────────────────

async function approveTask(taskId) {
    if (!wallet || !contract) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }

    try {
        const tx = await contract.approveResult(taskId, { gasLimit: 500_000 });
        showToast('Approving task #' + taskId + '…', 'info');
        await tx.wait();
        showToast('Task #' + taskId + ' approved & paid!', 'success');
        addActivity('💰 Task #' + taskId + ' paid!');
        closeModal('taskModal');
        loadTasks();
        loadStats();
    } catch (err) {
        console.error('Approve error:', err);
        showToast('Approval failed: ' + (err.reason || err.message), 'error');
    }
}

// ─── Stats & Agent ───────────────────────────────────

async function loadStats() {
    try {
        const res  = await fetch('/api/stats');
        const data = await res.json();
        if (!data.success) return;

        const s = data.stats;
        const completed = Math.max(0, s.totalJobs - s.openJobs);

        document.getElementById('statTotalTasks').textContent = s.totalJobs || '0';
        document.getElementById('statCompleted').textContent  = completed;
        document.getElementById('statPaidOut').textContent     = parseFloat(s.totalPayouts || 0).toFixed(2);

        const link = document.getElementById('contractLink');
        if (link && s.contractAddress) {
            link.href = 'https://explorer.monad.xyz/address/' + s.contractAddress;
            contractAddress = s.contractAddress;
        }
    } catch (err) {
        console.error('Load stats failed:', err);
    }
}

async function loadAgentStatus() {
    try {
        const res  = await fetch('/api/worker/status');
        const data = await res.json();
        if (!data.success) return;

        const s = data.status;
        const statusEl = document.getElementById('agentStatus');
        const textEl   = document.getElementById('agentStatusText');

        if (s.isRunning) {
            statusEl.textContent = 'Active';
            statusEl.className  = 'badge-status active';
            textEl.textContent   = 'Scanning every 30s';
            textEl.className     = 'status-text';
        } else {
            statusEl.textContent = 'Starting…';
            statusEl.className  = 'badge-status offline';
            textEl.textContent   = 'Initializing…';
            fetch('/api/worker/start', { method: 'POST' }).catch(() => {});
        }

        document.getElementById('agentActiveTasks').textContent = (s.activeJobs || 0) + ' tasks';
    } catch (err) {
        console.error('Load agent status failed:', err);
    }
}

// ─── WebSocket ───────────────────────────────────────

function setupWebSocket() {
    if (ws && ws.readyState < 2) return; // already open/connecting

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            const id = data.data?.jobId;
            switch (data.event) {
                case 'job_posted':
                    addActivity('📝 Task #' + id + ' submitted');
                    loadTasks(); loadStats();
                    break;
                case 'job_claimed':
                    addActivity('🎯 Task #' + id + ' claimed');
                    loadTasks(); loadAgentStatus();
                    break;
                case 'job_submitted':
                    addActivity('✅ Task #' + id + ' completed');
                    showToast('Task #' + id + ' result ready!', 'success');
                    loadTasks();
                    break;
                case 'job_completed':
                    addActivity('💰 Task #' + id + ' paid');
                    loadTasks(); loadStats();
                    break;
            }
        } catch (_) { /* ignore malformed messages */ }
    };

    ws.onerror = () => {};
    ws.onclose = () => setTimeout(setupWebSocket, 3000);
}

// ─── Activity Feed ───────────────────────────────────

function addActivity(msg) {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    const empty = feed.querySelector('.muted');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<span>${esc(msg)}</span><span class="muted small">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

    feed.insertBefore(item, feed.firstChild);
    while (feed.children.length > 10) feed.removeChild(feed.lastChild);
}

// ─── Event Listeners ─────────────────────────────────

function setupEventListeners() {
    const connectBtn = document.getElementById('connectWallet');
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            if (wallet) {
                if (confirm('Disconnect wallet?')) disconnectWallet();
            } else {
                connectWallet();
            }
        });
    }

    const postTaskBtn = document.getElementById('postTaskBtn');
    if (postTaskBtn) {
        postTaskBtn.addEventListener('click', () => {
            document.getElementById('walletWarning').style.display = wallet ? 'none' : 'block';
            openModal('postTaskModal');
        });
    }

    const heroPostTask = document.getElementById('heroPostTask');
    if (heroPostTask) {
        heroPostTask.addEventListener('click', async () => {
            if (!wallet) await connectWallet();
            document.getElementById('walletWarning').style.display = wallet ? 'none' : 'block';
            openModal('postTaskModal');
        });
    }

    const submitTask = document.getElementById('submitTask');
    if (submitTask) submitTask.addEventListener('click', postTask);

    const taskPayment = document.getElementById('taskPayment');
    if (taskPayment) {
        taskPayment.addEventListener('input', (e) => {
            const el = document.getElementById('payAmount');
            if (el) el.textContent = e.target.value;
            const btn = document.getElementById('submitTask');
            if (btn) btn.textContent = 'Submit Task & Pay ' + e.target.value + ' MON';
        });
    }

    // Character counter for description
    const taskDesc = document.getElementById('taskDescription');
    if (taskDesc) {
        taskDesc.addEventListener('input', () => {
            const counter = document.getElementById('charCount');
            if (counter) counter.textContent = taskDesc.value.length + ' / 2000';
        });
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadTasks(btn.dataset.category);
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => closeModal(m.id));
        }
    });
}

// ─── Modal ───────────────────────────────────────────

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        // Focus trap
        requestAnimationFrame(() => {
            const focusable = modal.querySelector('button, input, textarea, select');
            if (focusable) focusable.focus();
        });
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// ─── Polling ─────────────────────────────────────────
setInterval(loadAgentStatus, 10_000);
setInterval(loadStats, 30_000);
setInterval(loadTasks, 60_000);
