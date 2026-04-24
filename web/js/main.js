// --- GERENCIAMENTO DE TEMA ---
const tabTitles = {
    monitoring: 'Monitoramento',
    lookup: 'Buscar Loja',
    inventory: 'Hardware',
    hvlist: 'Hv list',
    transfer: 'transferência',
    schedule: 'Agendamento',
    groups: 'GRupos',
    search: 'Lojas',
    shutdown: 'Area 51'
};

const searchState = {
    allStores: [],
    lookupStores: [],
    pendingImport: [],
    selectedCsvName: null,
    previewLimit: 100
};

const groupState = {
    groups: {},
    selectedGroup: null
};

const monitoringState = {
    hosts: [],
    statusByHost: {},
    filter: 'all',
    search: '',
    lastUpdatedAt: null
};

// Alterna entre modo claro e escuro e persiste a escolha no navegador.
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('nexus-theme', newTheme);
    updateThemeUI(newTheme);
    writeLog(`Tema alterado para: ${newTheme.toUpperCase()}`, 'info');
}

// Atualiza texto e icone do botao de tema conforme o modo ativo.
function updateThemeUI(theme) {
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (theme === 'dark') {
        icon.innerText = 'Lua';
        text.innerText = 'Modo Escuro';
    } else {
        icon.innerText = 'Sol';
        text.innerText = 'Modo Claro';
    }
}

const savedTheme = localStorage.getItem('nexus-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
window.addEventListener('DOMContentLoaded', () => updateThemeUI(savedTheme));

function activateTab(tabId, triggerElement = null) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    const navButton = triggerElement || document.querySelector(`.nav-btn[onclick*="${tabId}"]`);
    if (navButton) {
        navButton.classList.add('active');
    }
    document.getElementById(`${tabId}-tab`).classList.add('active');
    document.getElementById('tab-title').innerText = tabTitles[tabId];

    if (tabId === 'monitoring') {
        refreshStatus();
    }

    if (tabId === 'groups') {
        loadGroups();
    }

    if (tabId === 'search') {
        refreshStoreDashboard();
    }

    if (tabId === 'lookup') {
        loadLookupStores();
    }
}

// Controla a navegacao entre abas e dispara as cargas de dados de cada area.
function switchTab(tabId, event) {
    activateTab(tabId, event?.currentTarget || null);
}

// Escreve mensagens no console visual exibido no rodape da aplicacao.
function writeLog(message, type = 'info') {
    const consoleElement = document.getElementById('log-console');
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    let colorClass = '';
    if (type === 'success') colorClass = 'log-success';
    if (type === 'error') colorClass = 'log-error';
    
    entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="${colorClass}">${message}</span>`;
    consoleElement.appendChild(entry);
    consoleElement.scrollTop = consoleElement.scrollHeight;
}

eel.expose(js_log);
function js_log(msg, type) { writeLog(msg, type); }

eel.expose(js_alert);
function js_alert(msg) { alert(msg); }

// Atualiza a barra de progresso usada em operacoes mais longas.
function setLoadingState(isLoading, message = 'Processando...', progress = 30) {
    const panel = document.getElementById('loading-panel');
    const text = document.getElementById('loading-text');
    const fill = document.getElementById('loading-bar-fill');

    if (!panel || !text || !fill) {
        return;
    }

    if (isLoading) {
        panel.classList.remove('hidden');
        text.innerText = message;
        fill.style.width = `${progress}%`;
    } else {
        text.innerText = message;
        fill.style.width = '100%';
        setTimeout(() => {
            panel.classList.add('hidden');
            fill.style.width = '0%';
        }, 700);
    }
}

// Exibe na tela qual arquivo CSV esta selecionado no momento.
function updateCsvFileSummary(message) {
    const summary = document.getElementById('csv-file-summary');
    if (summary) {
        summary.innerText = message;
    }
}

// Recarrega os hosts conhecidos e atualiza o dashboard de monitoramento.
async function refreshStatus() {
    writeLog('Sincronizando status dos servidores...', 'info');
    await loadGroups();
    const hosts = await eel.get_all_hosts()();
    monitoringState.hosts = hosts;
    monitoringState.lastUpdatedAt = new Date();
    renderMonitoring();
    hosts.forEach(host => {
        eel.check_ping(host.name);
    });
}

function getHostGroups(hostname) {
    return Object.entries(groupState.groups)
        .filter(([, hosts]) => Array.isArray(hosts) && hosts.includes(hostname))
        .map(([groupName]) => groupName);
}

function buildMonitoringGroups(hosts) {
    const grouped = new Map();
    hosts.forEach(host => {
        const groups = getHostGroups(host.name);
        const primaryGroup = groups[0] || 'Sem grupo';
        if (!grouped.has(primaryGroup)) {
            grouped.set(primaryGroup, []);
        }
        grouped.get(primaryGroup).push(host);
    });
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function getFilteredHosts() {
    const searchInput = document.getElementById('monitor-search');
    monitoringState.search = searchInput ? searchInput.value.trim().toLowerCase() : monitoringState.search;

    return monitoringState.hosts.filter(host => {
        const status = monitoringState.statusByHost[host.name];
        const hostGroups = getHostGroups(host.name).join(' ').toLowerCase();
        const matchesSearch = !monitoringState.search
            || host.name.toLowerCase().includes(monitoringState.search)
            || hostGroups.includes(monitoringState.search);
        const matchesFilter = monitoringState.filter === 'all'
            || (monitoringState.filter === 'online' && status === true)
            || (monitoringState.filter === 'offline' && status === false);
        return matchesSearch && matchesFilter;
    });
}

function updateMonitoringSummary() {
    const total = monitoringState.hosts.length;
    const online = Object.values(monitoringState.statusByHost).filter(status => status === true).length;
    const offline = Object.values(monitoringState.statusByHost).filter(status => status === false).length;
    const totalElement = document.getElementById('monitor-total-count');
    const onlineElement = document.getElementById('monitor-online-count');
    const offlineElement = document.getElementById('monitor-offline-count');
    const lastUpdateElement = document.getElementById('monitor-last-update');

    if (totalElement) totalElement.innerText = total;
    if (onlineElement) onlineElement.innerText = online;
    if (offlineElement) offlineElement.innerText = offline;
    if (lastUpdateElement) {
        lastUpdateElement.innerText = monitoringState.lastUpdatedAt
            ? monitoringState.lastUpdatedAt.toLocaleTimeString()
            : '--:--:--';
    }
}

function renderMonitoring() {
    updateMonitoringSummary();
    updateMonitoringFilterButtons();
    renderCards(getFilteredHosts());
}

// Desenha os cards de hosts na aba de monitoramento.
function renderCards(hosts) {
    const grid = document.getElementById('host-grid');
    grid.innerHTML = '';

    if (hosts.length === 0) {
        grid.innerHTML = '<div class="glass-card empty-panel">Nenhum host encontrado com os filtros atuais.</div>';
        updateCounters();
        return;
    }

    hosts.forEach((host, index) => {
            const groups = getHostGroups(host.name);
            const groupName = groups[0] || 'Sem grupo';
            const status = monitoringState.statusByHost[host.name];
            const card = document.createElement('div');
            card.className = 'glass-card monitor-card';
            card.id = `card-${host.name.replace(/\./g, '-')}`;
            
            // Adiciona um atraso baseado no índice para o efeito cascata
            card.style.animationDelay = `${index * 0.05}s`;
            
            card.innerHTML = `
                <div class="monitor-card-head">
                    <div class="monitor-card-title">
                        <div class="monitor-hostname">${escapeHtml(host.name)}</div>
                        <span class="monitor-group-chip">${escapeHtml(groupName)}</span>
                    </div>
                    <div class="monitor-status-stack">
                        <span class="status-badge ${status === true ? 'online' : status === false ? 'offline' : ''}" id="status-${host.name.replace(/\./g, '-')}">
                            ${status === true ? 'ONLINE' : status === false ? 'OFFLINE' : 'VERIFICANDO'}
                        </span>
                    </div>
                </div>
                <div class="monitor-meta">
                    <div class="monitor-meta-row">
                        <span>Status atual</span>
                        <strong>${status === true ? 'Respondendo' : status === false ? 'Sem resposta' : 'Em teste'}</strong>
                    </div>
                    <div class="monitor-meta-row">
                        <span>Atualizado</span>
                        <strong>${monitoringState.lastUpdatedAt ? monitoringState.lastUpdatedAt.toLocaleTimeString() : '--:--:--'}</strong>
                    </div>
                </div>
                <div class="monitor-actions">
                    <button class="btn-secondary small-btn" onclick="copyToClipboard('${escapeJs(host.name)}', this)">Copiar IP</button>
                    <button class="btn-secondary small-btn success-btn" onclick="pingLoja('${escapeJs(host.name)}')">Ping</button>
                    <button class="btn-secondary small-btn" onclick="runInventoryDirect('${escapeJs(host.name)}')">Inventario</button>
                    <button class="btn-secondary small-btn" onclick="sendHostToTab('${escapeJs(host.name)}', 'transfer')">Transferencia</button>
                    <button class="btn-secondary small-btn danger-outline-btn" onclick="sendHostToTab('${escapeJs(host.name)}', 'shutdown')">Shutdown</button>
                </div>
            `;
            grid.appendChild(card);
        });

    updateCounters();
}

eel.expose(updateHostStatus);
// Recebe do Python o resultado do ping e atualiza cor e estado de cada host.
function updateHostStatus(hostname, isOnline) {
    monitoringState.statusByHost[hostname] = isOnline;
    renderMonitoring();
}

// Atualiza os contadores de hosts online e offline na barra lateral.
function updateCounters() {
    const online = Object.values(monitoringState.statusByHost).filter(status => status === true).length;
    const offline = Object.values(monitoringState.statusByHost).filter(status => status === false).length;
    document.getElementById('count-online').innerText = online;
    document.getElementById('count-offline').innerText = offline;
}

function setMonitoringFilter(filter) {
    monitoringState.filter = filter;
    renderMonitoring();
}

function updateMonitoringFilterButtons() {
    const filterButtons = {
        all: document.getElementById('monitor-filter-all'),
        online: document.getElementById('monitor-filter-online'),
        offline: document.getElementById('monitor-filter-offline')
    };

    Object.entries(filterButtons).forEach(([filterName, button]) => {
        if (!button) return;
        button.classList.toggle('active-filter-btn', monitoringState.filter === filterName);
    });
}

function applyMonitoringFilters() {
    renderMonitoring();
}

function sendHostToTab(hostname, tabId) {
    const targetMap = {
        transfer: 'tra-target',
        shutdown: 'shu-target',
        inventory: 'inv-target'
    };
    const inputId = targetMap[tabId];
    const input = document.getElementById(inputId);
    if (input) {
        input.value = hostname;
    }
    activateTab(tabId);
    writeLog(`Host ${hostname} enviado para ${tabId}.`, 'success');
}

// Salva um grupo novo com os hosts digitados pelo usuario.
async function saveGroup() {
    const name = document.getElementById('group-name').value.trim();
    const hosts = document.getElementById('group-hosts').value.trim();
    if (!name || !hosts) return writeLog('Preencha todos os campos!', 'error');
    await eel.save_group(name, hosts)();
    writeLog(`Grupo ${name} salvo com sucesso!`, 'success');
    document.getElementById('group-name').value = '';
    document.getElementById('group-hosts').value = '';
    await loadGroups();
    refreshStatus();
}

// Abre o seletor de arquivos e importa grupos em massa via CSV.
async function importGroupsCsv() {
    setLoadingState(true, 'Importando grupos do arquivo...', 45);
    try {
        const result = await eel.import_groups_csv_action()();
        setLoadingState(false);
        if (result && result.status === 'ok') {
            writeLog(result.message, 'success');
            await loadGroups();
            refreshStatus();
        } else if (result && result.status === 'error') {
            writeLog(`Falha na importação: ${result.message}`, 'error');
        }
    } catch (err) {
        setLoadingState(false);
        writeLog('Erro ao processar arquivo TXT/CSV de grupos.', 'error');
    }
}

// Carrega todos os grupos do backend para o estado do frontend.
async function loadGroups() {
    const groups = await eel.get_groups()();
    groupState.groups = groups || {};
    renderGroups(groupState.groups);
}

// Renderiza a lista de grupos, estatisticas e o grupo atualmente selecionado.
function renderGroups(groups) {
    const container = document.getElementById('group-list');
    if (!container) {
        return;
    }

    const entries = Object.entries(groups);
    const totalHosts = entries.reduce((acc, [, hosts]) => acc + (Array.isArray(hosts) ? hosts.length : 0), 0);
    const totalCount = document.getElementById('groups-total-count');
    const hostCount = document.getElementById('groups-host-total');
    const badge = document.getElementById('groups-list-badge');

    if (totalCount) totalCount.innerText = entries.length;
    if (hostCount) hostCount.innerText = totalHosts;
    if (badge) badge.innerText = entries.length;

    container.innerHTML = '';

    if (entries.length === 0) {
        groupState.selectedGroup = null;
        renderGroupDetail(null, []);
        container.innerHTML = '<div class="empty-state">Nenhum grupo cadastrado ainda.</div>';
        return;
    }

    const sortedEntries = entries.sort((a, b) => a[0].localeCompare(b[0]));
    const hasSelectedGroup = groupState.selectedGroup && sortedEntries.some(([groupName]) => groupName === groupState.selectedGroup);
    if (!hasSelectedGroup) {
        groupState.selectedGroup = sortedEntries[0][0];
    }

    const list = document.createElement('div');
    list.className = 'group-list-grid';

    sortedEntries.forEach(([groupName, hosts]) => {
            const item = document.createElement('div');
            item.className = `group-item-card selectable-group-card${groupName === groupState.selectedGroup ? ' active' : ''}`;
            const normalizedHosts = Array.isArray(hosts) ? hosts : [];
            item.innerHTML = `
                <div class="group-item-header">
                    <div>
                        <div class="group-item-title">${escapeHtml(groupName)}</div>
                        <div class="group-item-count">${normalizedHosts.length} host(s)</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-secondary small-btn" onclick="editGroup('${escapeJs(groupName)}')">Editar</button>
                        <button class="btn-secondary small-btn danger-outline-btn" onclick="deleteGroup('${escapeJs(groupName)}')">Remover</button>
                    </div>
                </div>
                <div class="group-item-hosts">${normalizedHosts.map(host => `<span class="host-chip">${escapeHtml(host)}</span>`).join('')}</div>
            `;
            item.addEventListener('click', (event) => {
                if (event.target.closest('button')) {
                    return;
                }
                selectGroup(groupName);
            });
            list.appendChild(item);
        });

    container.appendChild(list);
    renderGroupDetail(groupState.selectedGroup, groups[groupState.selectedGroup] || []);
}

// Marca um grupo como selecionado para exibir seu resumo.
function selectGroup(groupName) {
    groupState.selectedGroup = groupName;
    renderGroups(groupState.groups);
}

// Mostra no painel lateral os detalhes e atalhos do grupo selecionado.
function renderGroupDetail(groupName, hosts) {
    const detail = document.getElementById('group-detail');
    const badge = document.getElementById('selected-group-badge');
    if (!detail || !badge) {
        return;
    }

    if (!groupName) {
        badge.innerText = 'Nenhum';
        detail.className = 'group-detail empty-state';
        detail.innerHTML = 'Selecione um grupo para visualizar os hosts e usar os atalhos.';
        return;
    }

    const normalizedHosts = Array.isArray(hosts) ? hosts : [];
    badge.innerText = groupName;
    detail.className = 'group-detail';
    detail.innerHTML = `
        <div class="group-detail-card">
            <div class="group-detail-top">
                <div>
                    <div class="group-detail-title">${escapeHtml(groupName)}</div>
                    <div class="group-item-count">${normalizedHosts.length} host(s) neste grupo</div>
                </div>
                <div class="group-shortcuts">
                    <button class="btn-secondary small-btn" onclick="editGroup('${escapeJs(groupName)}')">Editar Hosts</button>
                    <button class="btn-secondary small-btn" onclick="useGroupTarget('${escapeJs(groupName)}', 'inventory')">Inventario</button>
                    <button class="btn-secondary small-btn" onclick="useGroupTarget('${escapeJs(groupName)}', 'transfer')">Transferencia</button>
                    <button class="btn-secondary small-btn danger-outline-btn" onclick="useGroupTarget('${escapeJs(groupName)}', 'shutdown')">Shutdown</button>
                </div>
            </div>
            <div class="group-detail-hosts">
                ${normalizedHosts.length
                    ? normalizedHosts.map(host => `<span class="host-chip">${escapeHtml(host)}</span>`).join('')
                    : '<div class="empty-state">Este grupo ainda nao possui hosts.</div>'}
            </div>
        </div>
    `;
}

// Carrega os dados do grupo de volta para o formulario de cadastro para edicao.
function editGroup(groupName) {
    const hosts = groupState.groups[groupName];
    if (!hosts || !Array.isArray(hosts)) return;

    document.getElementById('group-name').value = groupName;
    document.getElementById('group-hosts').value = hosts.join(', ');

    // Foca no campo de hosts e rola ate o formulario
    document.getElementById('group-hosts').focus();
    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
    writeLog(`Editando grupo: ${groupName}. Adicione novos hosts ou altere os atuais e clique em Salvar.`, 'info');
}

// Preenche automaticamente o campo de alvo de outra aba usando o grupo escolhido.
// Preenche automaticamente o campo de alvo de outra aba usando o grupo escolhido.
function useGroupTarget(groupName, destination) {
    const targetMap = {
        inventory: 'inv-target',
        transfer: 'tra-target',
        shutdown: 'shu-target'
    };
    const inputId = targetMap[destination];
    const input = document.getElementById(inputId);
    if (!input) {
        return;
    }

    input.value = groupName;
    writeLog(`Grupo ${groupName} enviado para ${destination}.`, 'success');
}

// Remove um grupo e atualiza a interface com os dados restantes.
// Remove um grupo e atualiza a interface com os dados restantes.
async function deleteGroup(name) {
    if (!confirm(`Deseja remover o grupo ${name}?`)) {
        return;
    }

    const result = await eel.delete_group(name)();
    if (result.status === 'ok') {
        writeLog(result.message, 'success');
        await loadGroups();
        refreshStatus();
    } else {
        writeLog(result.message, 'error');
    }
}

let inventoryData = [];
// Inicia a coleta de inventario e prepara a area de resultados.
async function runInventory() {
    const target = document.getElementById('inv-target').value.trim();
    if (!target) return writeLog('Defina um alvo!', 'error');
    const results = document.getElementById('inventory-results');
    results.innerHTML = '<div class="glass-card result-row">Coletando inventario, aguarde...</div>';
    inventoryData = [];
    const response = await eel.run_task('inventory', target)();

    if (!response || response.status !== 'ok') {
        results.innerHTML = `<div class="glass-card result-row">${escapeHtml(response?.message || 'Nao foi possivel iniciar o inventario.')}</div>`;
        writeLog(response?.message || 'Nao foi possivel iniciar o inventario.', 'error');
        return;
    }

    writeLog(response.message || 'Inventario iniciado.', 'info');
}

eel.expose(updateInventoryResult);
// Recebe cada retorno de inventario do backend e adiciona na lista visual.
function updateInventoryResult(host, model) {
    const res = document.getElementById('inventory-results');
    const entry = document.createElement('div');
    entry.className = 'glass-card result-row';
    entry.innerHTML = `<span style="font-weight: bold;">${host}:</span> <span style="color: var(--accent-color);">${model}</span>`;
    res.appendChild(entry);
    inventoryData.push(`${host}: ${model}`);
}

// Exporta o resultado do inventario para um arquivo texto simples.
function exportInventory() {
    if (inventoryData.length === 0) return alert('Nada para exportar!');
    const text = inventoryData.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'inventario_nexus.txt';
    anchor.click();
}

// Dispara a transferencia remota usando os dados do formulario.
async function runTransfer() {
    const target = document.getElementById('tra-target').value;
    const local = document.getElementById('tra-local').value;
    const remote = document.getElementById('tra-remote').value;
    if (!target || !local || !remote) return writeLog('Preencha todos os campos!', 'error');
    await eel.run_task('transfer', target, local, remote)();
}

// Dispara o desligamento remoto do alvo informado apos confirmacao do usuario.
async function runShutdown() {
    const target = document.getElementById('shu-target').value;
    if (!target) return writeLog('Defina um alvo!', 'error');
    if (confirm(`Deseja realmente desligar o alvo: ${target}?`)) {
        await eel.run_task('shutdown', target)();
    }
}

// Dispara o reinicio remoto do alvo informado apos confirmacao do usuario.
async function runReboot() {
    const target = document.getElementById('shu-target').value;
    if (!target) return writeLog('Defina um alvo!', 'error');
    if (confirm(`Deseja realmente reiniciar o alvo: ${target}?`)) {
        await eel.run_task('reboot', target)();
    }
}

// Cria um agendamento novo com os dados preenchidos na tela.
async function addSchedule() {
    const type = document.getElementById('age-type').value;
    const target = document.getElementById('age-target').value;
    const time = document.getElementById('age-time').value;
    if (!target || !time) return writeLog('Preencha todos os campos!', 'error');
    await eel.add_schedule(type, target, time)();
    writeLog(`Tarefa agendada: ${type} em ${time}`, 'info');
}

// Recarrega a base de lojas para manter a aba administrativa atualizada.
async function refreshStoreDashboard() {
    const stores = await eel.get_all_lojas_action()();
    searchState.allStores = stores;
    updateStoreCount(stores.length);
    renderStoreAdminList(stores);
}

// Cadastra manualmente uma loja individual usando o formulario local.
async function addManualStore() {
    const idInput = document.getElementById('manual-store-id');
    const nameInput = document.getElementById('manual-store-name');
    const ipInput = document.getElementById('manual-store-ip');

    const id = idInput.value.trim();
    const nome = nameInput.value.trim();
    const ip = ipInput.value.trim();

    if (!id || !nome || !ip) {
        writeLog('Preencha ID, nome e IP para cadastrar a loja manualmente.', 'error');
        return;
    }

    const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (!ipv4Pattern.test(ip)) {
        writeLog('Informe um IP valido no formato IPv4.', 'error');
        return;
    }

    const success = await eel.add_loja_action(id, nome, ip)();
    if (!success) {
        writeLog('Nao foi possivel cadastrar a loja. Verifique duplicidade de ID ou IP.', 'error');
        return;
    }

    idInput.value = '';
    nameInput.value = '';
    ipInput.value = '';
    writeLog(`Loja ${id} cadastrada com sucesso.`, 'success');
    await refreshStoreDashboard();
    await loadLookupStores();
}

// Filtra a busca de lojas em tempo real na aba de consulta.
async function searchLojasLookup() {
    const query = document.getElementById('lookup-query').value.trim();
    if (!query) {
        displayLookupResults(searchState.lookupStores);
        return;
    }
    const results = await eel.search_lojas(query)();
    displayLookupResults(results);
}

// Carrega todas as lojas para a aba de consulta rapida.
async function loadLookupStores() {
    const stores = await eel.get_all_lojas_action()();
    searchState.lookupStores = stores;
    displayLookupResults(stores);
    updateStoreCount(stores.length);
}

// Atualiza os indicadores numericos da base de lojas.
function updateStoreCount(total) {
    document.getElementById('store-count').innerText = total;
    const badge = document.getElementById('registered-stores-badge');
    if (badge) {
        badge.innerText = total;
    }
}

// Renderiza a lista administrativa de lojas com botoes de editar e excluir.
function renderStoreAdminList(stores) {
    const container = document.getElementById('store-admin-results');
    if (!container) {
        return;
    }

    container.innerHTML = '';
    if (!stores || stores.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhuma loja cadastrada.</div>';
        return;
    }

    const table = document.createElement('div');
    table.className = 'store-table';
    table.innerHTML = `
        <div class="store-row store-head">
            <span>ID</span>
            <span>Nome</span>
            <span>IP</span>
            <span>Acoes</span>
        </div>
    `;

    stores.forEach(loja => {
        const row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML = `
            <span>${escapeHtml(loja.id)}</span>
            <span>${escapeHtml(loja.nome)}</span>
            <span>${escapeHtml(loja.ip)}</span>
            <span class="action-group">
                <button class="btn-secondary small-btn" onclick="editLoja('${escapeJs(loja.id)}', '${escapeJs(loja.nome)}', '${escapeJs(loja.ip)}')">Editar</button>
                <button class="btn-secondary small-btn danger-outline-btn" onclick="deleteStore('${escapeJs(loja.id)}')">Excluir</button>
            </span>
        `;
        table.appendChild(row);
    });

    container.appendChild(table);
}

async function editLoja(id, nome, ip) {
    const newId = prompt('Editar ID da loja:', id);
    if (newId === null) return;
    const normalizedId = newId.trim();

    const newNome = prompt('Editar nome da loja:', nome);
    if (newNome === null) return;
    const normalizedNome = newNome.trim();

    const newIp = prompt('Editar IP da loja:', ip);
    if (newIp === null) return;
    const normalizedIp = newIp.trim();

    if (!normalizedId || !normalizedNome || !normalizedIp) {
        writeLog('ID, nome e IP sao obrigatorios para editar a loja.', 'error');
        return;
    }

    const result = await eel.update_loja_action(id, normalizedId, normalizedNome, normalizedIp)();
    writeLog(result.message, result.status === 'ok' ? 'success' : 'error');
    if (result.status === 'ok') {
        await refreshStoreDashboard();
        await loadLookupStores();
    }
}

// Exclui uma loja e atualiza as duas abas que dependem da base.
async function deleteStore(id_loja) {
    if (confirm(`Deseja realmente excluir a loja ${id_loja}?`)) {
        const success = await eel.delete_loja(id_loja)();
        
        if (success) {
            writeLog(`Loja ${id_loja} excluída com sucesso.`, 'success');
            
            // Estas duas linhas fazem a mágica de atualizar a tela na hora:
            await loadLookupStores();    // Atualiza a aba de busca
            await refreshStoreDashboard(); // Atualiza a aba principal de lojas
        } else {
            writeLog(`Erro ao excluir a loja ${id_loja}.`, 'error');
        }
    }
}

// --- RENDERIZAÇÃO DA TABELA (COM BOTÃO DE EXCLUIR) ---
// Funcao legada para desenhar uma tabela HTML classica de lojas.
function renderStoreTable(stores, containerId) {
    const container = document.getElementById(containerId);
    if (!stores || stores.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhuma loja encontrada.</div>';
        return;
    }

    let html = `
        <table class="win-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>IP</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
    `;

    stores.forEach(loja => {
        html += `
            <tr>
                <td>${escapeHtml(loja.id)}</td>
                <td>${escapeHtml(loja.nome)}</td>
                <td><code>${escapeHtml(loja.ip)}</code></td>
                <td>
                    <button class="btn-small" onclick="pingLoja('${loja.ip}')">Ping</button>
                    <button class="btn-small danger-outline-btn" onclick="deleteStore('${loja.id}')">Excluir</button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
    container.classList.remove('empty-state');
}

// Renderiza os cards da aba Buscar loja com acoes rapidas por registro.
function displayLookupResults(results) {
    const container = document.getElementById('lookup-results');
    container.innerHTML = '';

    if (!results || results.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhuma loja encontrada.</div>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'lookup-grid';

    results.forEach((loja, index) => {
        const card = document.createElement('div');
        card.className = 'glass-card monitor-card lookup-card';
        card.style.animationDelay = `${index * 0.05}s`;
        card.innerHTML = `
            <div class="lookup-title">${escapeHtml(loja.id)} - ${escapeHtml(loja.nome)}</div>
            <div class="lookup-ip-highlight">${escapeHtml(loja.ip)}</div>
            <div class="lookup-meta">IP principal da loja</div>
            <div class="lookup-actions">
                <button class="btn-secondary small-btn" onclick="copyToClipboard('${escapeJs(loja.ip)}', this)">Copiar IP</button>
                <button class="btn-secondary small-btn success-btn" onclick="pingLoja('${escapeJs(loja.ip)}')">Ping</button>
                <button class="btn-secondary small-btn" onclick="runInventoryDirect('${escapeJs(loja.ip)}')">Inventario</button>
            </div>
        `;
        grid.appendChild(card);
    });

    container.appendChild(grid);
}

// Copia um texto para a area de transferencia do sistema.
function copyToClipboard(text, btnElement = null) {
    if (!text) return;

    const showFeedback = () => {
        writeLog(`IP ${text} copiado para a área de transferência com sucesso!`, 'success');
        if (btnElement) {
            const originalText = btnElement.innerText;
            btnElement.innerText = 'Copiado!';
            btnElement.classList.add('success-btn');
            setTimeout(() => {
                btnElement.innerText = originalText;
                btnElement.classList.remove('success-btn');
            }, 1500);
        }
    };

    // Tenta usar a Clipboard API moderna
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showFeedback();
        }).catch(() => {
            fallbackCopyTextToClipboard(text, showFeedback);
        });
    } else {
        fallbackCopyTextToClipboard(text, showFeedback);
    }
}

function fallbackCopyTextToClipboard(text, callback) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        if (callback) callback();
    } catch (err) {
        writeLog('Erro ao copiar IP.', 'error');
    }
    document.body.removeChild(textArea);
}

// Abre o seletor de CSV, faz o preview e atualiza a tela de importacao.
async function triggerCsvImport() {
    setLoadingState(true, 'Abrindo seletor de arquivo...', 18);
    resetCsvPreview();

    try {
        const result = await eel.select_csv_file_action()();

        if (!result || result.status === 'cancelled') {
            searchState.selectedCsvName = null;
            setLoadingState(false, 'Selecao de arquivo cancelada.');
            return;
        }

        searchState.selectedCsvName = result.file_name || null;
        searchState.previewLimit = result.preview_limit || 100;
        updateCsvFileSummary(`Arquivo carregado: ${result.file_name || 'CSV selecionado'}`);

        if (result.status !== 'ok') {
            setLoadingState(false, 'Falha na validacao do CSV.');
            writeLog(result.message || 'Nao foi possivel abrir o arquivo CSV.', 'error');
            return;
        }

        searchState.pendingImport = result.ready || [];
        renderCsvPreview(result.ready || [], result.rejected || []);
        setLoadingState(false, 'Analise concluida.');

        if (result.ready && result.ready.length > 0) {
            writeLog(`${result.ready.length} registro(s) pronto(s) para importar.`, 'success');
        } else {
            writeLog('Nenhum registro novo ficou pronto para importar.', 'info');
        }

        if (result.rejected && result.rejected.length > 0) {
            writeLog(`${result.rejected.length} linha(s) foram rejeitadas na validacao.`, 'info');
        }
    } catch (error) {
        updateCsvFileSummary('Nenhum arquivo CSV carregado.');
        setLoadingState(false, 'Falha ao abrir o arquivo.');
        writeLog(`Falha ao abrir o CSV: ${error.message}`, 'error');
    }
}


// Exibe apenas uma amostra visual das linhas prontas e rejeitadas do CSV.
function renderCsvPreview(ready, rejected) {
    document.getElementById('preview-ready-count').innerText = ready.length;
    document.getElementById('preview-rejected-count').innerText = rejected.length;
    document.getElementById('preview-ready-badge').innerText = ready.length;
    document.getElementById('preview-rejected-badge').innerText = rejected.length;
    document.getElementById('confirm-import-btn').disabled = ready.length === 0;

    const readyList = document.getElementById('preview-ready-list');
    const rejectedList = document.getElementById('preview-rejected-list');
    const readyPreview = ready.slice(0, searchState.previewLimit);
    const rejectedPreview = rejected.slice(0, searchState.previewLimit);
    const readyRemaining = ready.length - readyPreview.length;
    const rejectedRemaining = rejected.length - rejectedPreview.length;

    readyList.innerHTML = ready.length
        ? `
            ${readyRemaining > 0 ? `<div class="preview-row"><strong>Mostrando ${readyPreview.length} de ${ready.length}</strong><span>Os demais registros prontos serao importados normalmente.</span></div>` : ''}
            ${readyPreview.map(item => `
            <div class="preview-row success">
                <strong>Linha ${item.line}</strong>
                <span>${escapeHtml(item.id)} | ${escapeHtml(item.nome)} | ${escapeHtml(item.ip)}</span>
            </div>
        `).join('')}
        `
        : '<div class="empty-state">Nenhum registro apto para importacao.</div>';

    rejectedList.innerHTML = rejected.length
        ? `
            ${rejectedRemaining > 0 ? `<div class="preview-row"><strong>Mostrando ${rejectedPreview.length} de ${rejected.length}</strong><span>Revise o CSV completo se precisar analisar todas as rejeicoes.</span></div>` : ''}
            ${rejectedPreview.map(item => `
            <div class="preview-row danger">
                <strong>Linha ${item.line}</strong>
                <span>${escapeHtml(item.reason)}</span>
                <small>${escapeHtml(`${item.values.id || '-'} | ${item.values.nome || '-'} | ${item.values.ip || '-'}`)}</small>
            </div>
        `).join('')}
        `
        : '<div class="empty-state">Nenhuma linha rejeitada.</div>';
}

// Limpa o estado local do preview para uma nova importacao.
function resetCsvPreview() {
    searchState.pendingImport = [];
    searchState.selectedCsvName = null;
    searchState.previewLimit = 100;
    renderCsvPreview([], []);
}

// Confirma a importacao dos registros aprovados no preview.
async function confirmCsvImport() {
    if (!searchState.pendingImport.length) {
        writeLog('Nenhum registro validado para importar.', 'error');
        return;
    }

    setLoadingState(true, 'Importando registros para a base...', 72);

    try {
        const result = await eel.import_selected_csv_action()();
        writeLog(result.message, result.status === 'ok' ? 'success' : 'error');

        if (result.rejected && result.rejected.length) {
            writeLog(`${result.rejected.length} registro(s) nao foram importados por duplicidade no banco.`, 'info');
        }

        if (result.status === 'ok') {
            updateCsvFileSummary(`Arquivo importado: ${searchState.selectedCsvName || 'CSV selecionado'}`);
            resetCsvPreview();
            setLoadingState(false, 'Importacao concluida com sucesso.');
            await refreshStoreDashboard();
            await loadLookupStores();
        } else {
            setLoadingState(false, 'Importacao concluida com alerta.');
        }
    } catch (error) {
        setLoadingState(false, 'Falha ao importar o arquivo.');
        writeLog(`Falha ao confirmar importacao: ${error.message}`, 'error');
    }
}

// Exclui toda a base de lojas apos dupla confirmacao do usuario.
async function clearLojasBase() {
    const total = Number(document.getElementById('store-count').innerText || '0');
    if (!total) {
        writeLog('Nao ha lojas cadastradas para excluir.', 'info');
        return;
    }

    if (!confirm('Isso vai excluir toda a base de lojas cadastradas. Deseja continuar?')) {
        return;
    }

    const confirmation = prompt('Para confirmar, digite EXCLUIR BASE');
    if (confirmation !== 'EXCLUIR BASE') {
        writeLog('Exclusao cancelada. Confirmacao invalida.', 'error');
        return;
    }

    setLoadingState(true, 'Excluindo base cadastrada...', 64);
    const result = await eel.clear_lojas_action()();
    writeLog(result.message, result.status === 'ok' ? 'success' : 'error');
    if (result.status === 'ok') {
        resetCsvPreview();
        updateCsvFileSummary('Nenhum arquivo CSV carregado.');
        setLoadingState(false, 'Base excluida com sucesso.');
        await refreshStoreDashboard();
        await loadLookupStores();
    } else {
        setLoadingState(false, 'Falha ao excluir a base.');
    }
}

// Gera um arquivo modelo de CSV para facilitar o preenchimento correto.
function downloadCsvTemplate() {
    const template = 'ID,Nome,IP\n001,Loja Centro,192.168.0.10\n002,Loja Norte,192.168.0.11';
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'modelo_lojas_nexus.csv';
    anchor.click();
    writeLog('Modelo de CSV baixado com sucesso.', 'success');
}

// Dispara um ping rapido para o IP de uma loja.
function pingLoja(ip) {
    writeLog(`Fazendo ping em ${ip}...`, 'info');
    eel.check_ping(ip);
}

// Atalho para iniciar inventario a partir de um card da busca de lojas.
async function runInventoryDirect(ip) {
    writeLog(`Iniciando inventario em ${ip}...`, 'info');
    const response = await eel.run_task('inventory', ip)();
    if (!response || response.status !== 'ok') {
        writeLog(response?.message || 'Nao foi possivel iniciar o inventario.', 'error');
    }
}

// Escapa caracteres especiais antes de inserir texto dinamico no HTML.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escapa texto antes de usa-lo dentro de atributos onclick montados por string.
function escapeJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

// --- LÓGICA DE AUTO-UPDATE ---
async function checkForUpdates() {
    const result = await eel.check_for_updates()();
    
    if (result.status === 'debug') {
        writeLog('Verificação de Update: Ignorada (Modo Script/Desenvolvimento).', 'info');
        return;
    }

    if (result.status === 'update_available') {
        if (confirm(`Nova versão ${result.version} disponível! Deseja atualizar agora?\nO sistema será reiniciado.`)) {
            setLoadingState(true, 'Atualizando sistema...', 50);
            const updateResult = await eel.start_update_process(result.url)();
            if (updateResult && updateResult.status === 'error') {
                setLoadingState(false);
                writeLog(`Erro na atualização: ${updateResult.message}`, 'error');
            }
        }
    } else {
        writeLog('Sistema atualizado.', 'success');
    }
}

// Carregamento inicial das principais areas da aplicacao ao abrir a janela.
window.onload = async () => {
    refreshStatus();
    resetCsvPreview();
    updateCsvFileSummary('Nenhum arquivo CSV carregado.');
    await loadGroups();
    await refreshStoreDashboard();
    await loadLookupStores();
    
    // Verifica updates após 3 segundos da inicialização
    setTimeout(checkForUpdates, 3000);
};
