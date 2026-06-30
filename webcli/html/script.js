const state = {
    activeTab: 'chat',
    traces: [],
    config: { github: false, slack: false, stripe: false },
    departments: [
        { name: 'Strategy', head: 'Strategy Head', icon: '🎯' },
        { name: 'Engineering', head: 'CTO', icon: '🏗️' },
        { name: 'Growth', head: 'CMO', icon: '📈' },
        { name: 'Revenue', head: 'CRO', icon: '💰' },
        { name: 'Operations', head: 'Head of Ops', icon: '⚙️' },
        { name: 'Security', head: 'CISO', icon: '🛡️' },
        { name: 'Data', head: 'CDO', icon: '📊' }
    ],
    specialists: [
        { name: 'QA Specialist', dept: 'Engineering' },
        { name: 'SEO Strategist', dept: 'Growth' },
        { name: 'Finance Analyst', dept: 'Operations' }
    ],
    models: [
        { id: 'gpt-4o', provider: 'OpenAI', status: 'Ready' },
        { id: 'claude-3-5-sonnet', provider: 'Anthropic', status: 'Ready' }
    ],
    health: [
        { name: 'AI Gateway', status: 'pass', detail: 'Connected' },
        { name: 'Slack', status: 'warn', detail: 'Not linked' },
        { name: 'Telegram', status: 'error', detail: 'Disabled' }
    ]
};

function init() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => switchTab(item.dataset.tab));
    });
    document.getElementById('chat-input').addEventListener('keypress', e => {
        if (e.key === 'Enter' && e.target.value.trim()) {
            handleChat(e.target.value.trim());
            e.target.value = '';
        }
    });
    switchTab('chat');
    setInterval(animateWaveform, 100);
}

function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tabId));
    document.querySelectorAll('.view-container').forEach(v => v.classList.toggle('hidden', v.id !== `view-${tabId}`));

    // Dynamic Renderings
    if (tabId === 'swarm') renderSwarm();
    if (tabId === 'traces') renderTraces();
    if (tabId === 'doctor') renderDoctor();
    if (tabId === 'models') renderModels();
    if (tabId === 'apps') renderGrid('apps-grid', [{name:'GitHub', toolkit:'github', status:'Linked'}, {name:'Slack', toolkit:'slack', status:'Linked'}]);
    if (tabId === 'mcp') renderGrid('mcp-grid', [{name:'filesystem', type:'stdio', status:'active'}, {name:'playwright', type:'stdio', status:'active'}]);
    if (tabId === 'skills') renderGrid('skills-grid', [{name:'ui-ux-pro', category:'Design', status:'Expert'}, {name:'ai-seo', category:'Growth', status:'Advanced'}]);
    if (tabId === 'triggers') renderGrid('triggers-grid', [{name:'PR Open', toolkit:'github', status:'enabled'}]);
    if (tabId === 'jobs') renderGrid('jobs-grid', [{name:'job_88a', task:'Revenue Sync', status:'completed'}]);
}

function handleChat(text) {
    addMessage('user', text);
    const cmd = text.toLowerCase().trim();
    if (cmd === '/doctor') {
        addMessage('bot', "## System Health Check\n\n| Module | Status | Detail |\n| :--- | :--- | :--- |\n| AI Gateway | 🟢 PASS | Connected |\n| Browser | 🟢 PASS | Playwright 1.44 |\n| Memory | 🟡 WARN | Redis not configured |");
    } else if (cmd === '/setup') {
        showSetupModal();
    } else {
        simulateOrchestration(text);
    }
}

function addMessage(role, text) {
    const container = document.getElementById('chat-output');
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;

    let html = text
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\| (.*?) \|/g, (match) => {
            if (match.includes('---')) return '';
            const cells = match.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
            return `<table><tr>${cells}</tr></table>`;
        });

    msg.innerHTML = `
        <div class="avatar">${role === 'bot' ? 'Z' : 'U'}</div>
        <div class="bubble">${html}</div>
    `;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function simulateOrchestration(task) {
    const sys = document.createElement('div');
    sys.className = 'sys-line';
    sys.style.fontSize = '12px'; sys.style.color = 'var(--outline)'; sys.style.margin = '12px 0';
    sys.style.display = 'flex'; sys.style.alignItems = 'center'; sys.style.gap = '8px';
    sys.innerHTML = `<span style="height:1px; flex:1; background:var(--outline-variant)"></span> COO orchestrating: ${task} <span style="height:1px; flex:1; background:var(--outline-variant)"></span>`;
    document.getElementById('chat-output').appendChild(sys);

    const span = { id: Math.random(), name: 'CTO', dept: 'Engineering', task, startedAt: Date.now(), events: [{label: 'list_files', detail: 'Scanning...'}] };
    state.traces.unshift(span);
    setTimeout(() => addMessage('bot', "The Swarm is analyzing your request. I've engaged the CTO and CMO."), 1000);
}

function renderSwarm() {
    const grid = document.getElementById('swarm-grid');
    grid.innerHTML = state.departments.map(d => `
        <div class="card">
            <div class="card-head"><span class="card-title">${d.icon} ${d.name}</span> <span class="card-status bg-ok">ACTIVE</span></div>
            <div style="font-size: 12px; font-weight: 700; color: var(--primary);">HEAD: ${d.head}</div>
        </div>
    `).join('');
}

function renderTraces() {
    const container = document.getElementById('trace-container');
    container.innerHTML = state.traces.map(s => `
        <div class="trace-node active">
            <div style="font-weight: 700; font-size: 14px; color: var(--primary);">[${s.dept}] ${s.name}</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${s.task}</div>
            ${s.events.map(e => `<div style="font-size: 11px; padding: 4px 8px; background: rgba(0,0,0,0.02); border-radius: 4px; border-left: 3px solid var(--primary-light);">${e.label}: ${e.detail}</div>`).join('')}
        </div>
    `).join('');
}

function renderDoctor() {
    const grid = document.getElementById('doctor-grid');
    grid.innerHTML = state.health.map(h => `
        <div class="card"><div class="card-head"><span class="card-title">${h.name}</span> <span class="card-status bg-${h.status}">${h.status.toUpperCase()}</span></div><div style="font-size: 11px;">${h.detail}</div></div>
    `).join('');
}

function renderModels() {
    const list = document.getElementById('models-list');
    list.innerHTML = state.models.map(m => `
        <tr style="border-bottom: 1px solid var(--outline-variant);"><td style="padding: 12px 24px;">${m.id}</td><td style="padding: 12px 24px;">${m.provider}</td><td style="padding: 12px 24px;"><span class="card-status bg-ok">${m.status}</span></td></tr>
    `).join('');
}

function renderGrid(id, items) {
    const grid = document.getElementById(id);
    grid.innerHTML = items.map(i => `
        <div class="card"><div class="card-head"><span class="card-title">${i.name}</span> <span class="card-status bg-ok">ACTIVE</span></div><div style="font-size: 11px;">${JSON.stringify(i)}</div></div>
    `).join('');
}

function animateWaveform() {
    const wf = document.getElementById('waveform');
    if (!wf) return;
    wf.innerHTML = Array.from({length:15}).map(() => `<div style="width:3px; height:${Math.random()*20+5}px; background:var(--primary-light); border-radius:2px;"></div>`).join('');
}

function showSetupModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal"><h2 style="font-weight:800; margin-bottom:16px;">System Configuration Required</h2><div class="opt-btn"><strong>🐙 GitHub</strong><div>Sync codebase intelligence</div></div><div class="opt-btn"><strong>💳 Stripe</strong><div>Revenue & Billing automation</div></div><button class="btn btn-primary" style="width:100%; margin-top:20px;" onclick="this.parentElement.parentElement.remove()">Dismiss</button></div>`;
    document.body.appendChild(overlay);
}

window.onload = init;
