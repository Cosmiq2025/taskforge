
const CONTRACT_ABI = [
    {
        "inputs": [{"name": "_description", "type": "string"}, {"name": "_category", "type": "uint8"}, {"name": "_deadlineHours", "type": "uint256"}],
        "name": "postJob",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [{"name": "_jobId", "type": "uint256"}],
        "name": "approveResult",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

let wallet = null;
let contract = null;
let contractAddress = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupEventListeners();
    await loadContractAddress(); // Load contract address FIRST
    await loadStats();
    await loadTasks();
    await loadAgentStatus();
    setupWebSocket();
    checkWallet();
    
    // Auto-start agent (server-side)
    fetch('/api/worker/start', { method: 'POST' }).catch(() => {});
});

async function loadContractAddress() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.success && data.stats) {
            // Try to get contract address from stats
            contractAddress = data.stats.contractAddress || process.env.CONTRACT_ADDRESS;
            
            // If still not available, try to get from environment
            if (!contractAddress) {
                const configRes = await fetch('/api/config');
                if (configRes.ok) {
                    const configData = await configRes.json();
                    contractAddress = configData.contractAddress;
                }
            }
            
            console.log('Contract address loaded:', contractAddress);
        }
    } catch (err) {
        console.error('Failed to load contract address:', err);
    }
}

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    });
}

async function checkWallet() {
    if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) connectWallet();
    }
}

async function connectWallet() {
    if (!window.ethereum) {
        alert('Please install a Web3 wallet (MetaMask, Rabby, etc.)');
        return;
    }
    
    const btn = document.getElementById('connectWallet');
    btn.textContent = 'Connecting...';
    btn.disabled = true;
    
    try {
        // Request accounts
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        wallet = accounts[0];
        
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        
        // Make sure we have contract address
        if (!contractAddress) {
            await loadContractAddress();
        }
        
        if (!contractAddress) {
            throw new Error('Contract address not available');
        }
        
        contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
        
        btn.textContent = wallet.slice(0, 6) + '...' + wallet.slice(-4);
        btn.classList.add('connected');
        btn.disabled = false;
        
        document.getElementById('walletWarning').style.display = 'none';
        addActivity('👤 Wallet connected');
        
        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length === 0) location.reload();
            else {
                wallet = accounts[0];
                btn.textContent = wallet.slice(0, 6) + '...' + wallet.slice(-4);
            }
        });
        
        window.ethereum.on('chainChanged', () => location.reload());
        
    } catch (err) {
        console.error('Connect failed:', err);
        alert('Failed to connect wallet: ' + err.message);
        btn.textContent = 'Connect Wallet';
        btn.disabled = false;
    }
}

async function loadTasks(category = 'all') {
    const list = document.getElementById('tasksList');
    
    try {
        const res = await fetch('/api/jobs?limit=50');
        const data = await res.json();
        
        if (!data.success || !data.jobs.length) {
            list.innerHTML = '<div class="empty-state"><span class="icon">📭</span><p>No active tasks yet</p><button class="btn btn-primary btn-sm" onclick="openModal(\'postTaskModal\')" style="margin-top:1rem">+ Submit First Task</button></div>';
            return;
        }
        
        let tasks = data.jobs;
        
        // --- FIXED FILTER LOGIC ---
      // Change this in your app.js
if (category === 'all' || category === '') {
    tasks = data.jobs; 
} else if (category === 'completed') {
    tasks = data.jobs.filter(j => j.status === 2 || j.status === 3);
} else {
    tasks = data.jobs.filter(j => j.category === parseInt(category));
}

        } else if (category === 'completed') {
            tasks = data.jobs.filter(j => j.status === 2 || j.status === 3);
        } else {
            tasks = data.jobs.filter(j => j.category === parseInt(category));
        }
        
        if (!tasks.length) {
            list.innerHTML = '<div class="empty-state"><p>No tasks in this category</p></div>';
            return;
        }
        
        list.innerHTML = tasks.map(task => `
            <div class="task-card" onclick="showTask(${task.id})">
                <div class="task-card-header">
                    <span class="task-id">#${task.id}</span>
                    <span class="task-payment">${task.payment} MON</span>
                </div>
                <p class="task-desc">${truncate(task.description, 120)}</p>
                <div class="task-footer">
                    <span class="task-cat">${task.categoryName}</span>
                    <span class="badge-status ${task.statusName.toLowerCase()}">${task.statusName}</span>
                    <span class="task-time">⏰ ${formatTime(task.deadline)}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Load tasks failed:', err);
        list.innerHTML = '<div class="loading">Failed to load</div>';
    }
}

async function showTask(taskId) {
    try {
        const res = await fetch(`/api/jobs/${taskId}`);
        const data = await res.json();
        if (!data.success) return;
        
        const task = data.job;
        
        document.getElementById('modalTaskId').textContent = task.id;
        document.getElementById('modalStatus').textContent = task.statusName;
        document.getElementById('modalStatus').className = 'badge-status ' + task.statusName.toLowerCase();
        document.getElementById('modalPayment').textContent = task.payment + ' MON';
        document.getElementById('modalCategory').textContent = task.categoryName;
        document.getElementById('modalDescription').textContent = task.description;
        document.getElementById('modalClient').textContent = formatAddr(task.client);
        document.getElementById('modalAgent').textContent = task.worker === '0x0000000000000000000000000000000000000000' ? 'Waiting for agent...' : formatAddr(task.worker);
        document.getElementById('modalDeadline').textContent = formatTime(task.deadline);
        document.getElementById('modalStake').textContent = task.stakeRequired + ' MON';
        
        const resultDiv = document.getElementById('modalResult');
        
        // Show result box if status is 2 (Submitted) or 3 (Completed)
        if (task.status >= 2 || (task.resultHash && task.resultHash.length > 0)) {
            resultDiv.style.display = 'block';
            
            let displayResult = task.resultHash;
            
            if (!displayResult || displayResult.length < 5) {
                displayResult = "✨ Agent has submitted work. Fetching report from blockchain...";
            }

            try {
                const parsed = JSON.parse(task.resultHash);
                displayResult = parsed.content || parsed.report || JSON.stringify(parsed, null, 2);
            } catch (e) {
                // If not JSON, just show the raw string
            }
            
            document.getElementById('modalResultText').textContent = displayResult;
        } else {
            resultDiv.style.display = 'none';
        }
        
        const actions = document.getElementById('modalActions');
        actions.innerHTML = '';
        
        // Status 2 is the "Sweet Spot" where work is done but money hasn't moved yet
        if (wallet && task.status === 2 && task.client.toLowerCase() === wallet.toLowerCase()) {
            actions.innerHTML = `
                <div style="background: rgba(0, 255, 157, 0.05); border: 1px solid var(--green); padding: 15px; border-radius: 8px; margin-top: 15px;">
                    <p style="color: var(--green); font-size: 0.9rem; margin-bottom: 10px; font-weight: bold;">✅ Agent work is ready for approval</p>
                    <button class="btn btn-success btn-full" onclick="approveTask(${task.id})">✓ Approve & Release 0.1 MON</button>
                </div>
            `;
        } else if (task.status === 0) {
            actions.innerHTML = '<p class="muted small">⏳ Waiting for Forge Agent to claim...</p>';
        } else if (task.status === 1) {
            actions.innerHTML = '<p class="muted small">🤖 Forge Agent is processing...</p>';
        } else if (task.status === 3) {
            actions.innerHTML = '<p class="muted small" style="color:var(--green)">✓ Task Completed & Funds Released</p>';
        }
        
        openModal('taskModal');
    } catch (err) {
        console.error('Load task failed:', err);
    }
} // <--- MAKE SURE THIS IS HERE TO CLOSE showTask



async function postTask() {
    if (!wallet) {
        document.getElementById('walletWarning').style.display = 'block';
        return;
    }
    
    if (!contract) {
        alert('Please connect your wallet first');
        return;
    }
    
    const desc = document.getElementById('taskDescription').value.trim();
    const cat = parseInt(document.getElementById('taskCategory').value);
    const pay = document.getElementById('taskPayment').value;
    const deadline = parseInt(document.getElementById('taskDeadline').value);
    
    if (!desc || desc.length < 10) {
        alert('Please provide a clear task description (at least 10 characters)');
        return;
    }
    
    const btn = document.getElementById('submitTask');
    btn.disabled = true;
    btn.textContent = 'Confirming...';
    
   try {
        // 1. Check if the user is on the correct network (Chain ID 143 for Monad Mainnet)
        const provider = new ethers.BrowserProvider(window.ethereum);
        const network = await provider.getNetwork();
        if (network.chainId !== 143n) {
            try {
                // This triggers the MetaMask popup to switch networks
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x8f' }], // 0x8f is 143 in hex
                });
                // After switching, the function should stop so the user can click 'Submit' again on the right chain
                return; 
            } catch (switchError) {
                // Error 4902 means the network isn't in their MetaMask yet
                if (switchError.code === 4902) {
                    try {
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
                    } catch (addError) {
                        console.error('Failed to add network:', addError);
                    }
                } else {
                    alert("Please switch your wallet to Monad Mainnet manually.");
                }
                return;
            }
        }

        // 2. Post the job with a manual gas limit to prevent RPC errors
        const tx = await contract.postJob(desc, cat, deadline, { 
            value: ethers.parseEther(pay.toString()),
            gasLimit: 1000000 // <--- THIS IS THE LINE TO ADD
        });
        
        btn.textContent = 'Processing...';
        await tx.wait();
        
        closeModal('postTaskModal');
        document.getElementById('taskDescription').value = '';
        addActivity('📝 Task submitted! (' + pay + ' MON)');
        loadTasks();
        loadStats();
    } catch (err) {
        console.error('Post task error:', err);
        if (err.code !== 'ACTION_REJECTED') {
            alert('Failed: ' + (err.reason || err.message));
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Task & Pay ' + pay + ' MON';
    }
}

async function approveTask(taskId) {
    if (!wallet || !contract) {
        alert('Please connect your wallet first');
        return;
    }
    
    try {
const tx = await contract.approveResult(taskId, { gasLimit: 500000 });
        await tx.wait();
        addActivity('💰 Task #' + taskId + ' paid!');
        closeModal('taskModal');
        loadTasks();
        loadStats();
    } catch (err) {
        console.error('Approve error:', err);
        alert('Failed: ' + (err.reason || err.message));
    }
}

async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        if (data.success) {
            const s = data.stats;
            const completed = Math.max(0, s.totalJobs - s.openJobs);
            
            document.getElementById('statTotalTasks').textContent = s.totalJobs || '0';
            document.getElementById('statCompleted').textContent = completed;
            document.getElementById('statPaidOut').textContent = parseFloat(s.totalPayouts || 0).toFixed(2);
            
            const link = document.getElementById('contractLink');
            if (link && s.contractAddress) {
                link.href = 'https://explorer.monad.xyz/address/' + s.contractAddress;
                contractAddress = s.contractAddress;
            }
        }
    } catch (err) {
        console.error('Load stats failed:', err);
    }
}

async function loadAgentStatus() {
    try {
        const res = await fetch('/api/worker/status');
        const data = await res.json();
        
        if (data.success) {
            const s = data.status;
            const statusEl = document.getElementById('agentStatus');
            const textEl = document.getElementById('agentStatusText');
            
            if (s.isRunning) {
                statusEl.textContent = 'Active';
                statusEl.className = 'badge-status active';
                textEl.textContent = 'Scanning every 30s';
                textEl.className = 'status-text';
            } else {
                statusEl.textContent = 'Starting...';
                statusEl.className = 'badge-status offline';
                textEl.textContent = 'Initializing...';
                // Auto-start if not running
                fetch('/api/worker/start', { method: 'POST' });
            }
            
            document.getElementById('agentActiveTasks').textContent = (s.activeJobs || 0) + ' tasks';
        }
    } catch (err) {
        console.error('Load agent status failed:', err);
    }
}

function setupWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host);
    
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        switch (data.event) {
            case 'job_posted':
                addActivity('📝 Task #' + data.data.jobId + ' submitted');
                loadTasks(); loadStats();
                break;
            case 'job_claimed':
                addActivity('🎯 Task #' + data.data.jobId + ' claimed');
                loadTasks(); loadAgentStatus();
                break;
            case 'job_submitted':
                addActivity('✅ Task #' + data.data.jobId + ' completed');
                loadTasks();
                break;
            case 'job_completed':
                addActivity('💰 Task #' + data.data.jobId + ' paid');
                loadTasks(); loadStats();
                break;
        }
    };
    
    ws.onerror = (err) => console.error('WebSocket error:', err);
    ws.onclose = () => setTimeout(setupWebSocket, 3000);
}

function addActivity(msg) {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    
    const empty = feed.querySelector('.muted');
    if (empty) empty.remove();
    
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = '<span>' + msg + '</span><span class="muted small">' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</span>';
    
    feed.insertBefore(item, feed.firstChild);
    while (feed.children.length > 8) feed.removeChild(feed.lastChild);
}

function setupEventListeners() {
    const connectBtn = document.getElementById('connectWallet');
    if (connectBtn) connectBtn.addEventListener('click', connectWallet);
    
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
            const payAmount = document.getElementById('payAmount');
            if (payAmount) payAmount.textContent = e.target.value;
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
        if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    });
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function formatAddr(addr) { return addr ? addr.slice(0,6) + '...' + addr.slice(-4) : '-'; }

function formatTime(deadline) {
    const diff = new Date(deadline) - new Date();
    if (diff < 0) return 'Expired';
    const hrs = Math.floor(diff / 3600000);
    if (hrs > 24) return Math.floor(hrs/24) + 'd';
    return hrs + 'h';
}

function truncate(str, len) { return str && str.length > len ? str.slice(0,len) + '...' : str; }

setInterval(loadAgentStatus, 10000);
setInterval(loadStats, 30000);
setInterval(loadTasks, 60000);
