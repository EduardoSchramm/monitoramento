// ============================================================
// MAPA DAS PROMOTORIAS — Versão Completa (Leaflet + Cluster)
// - Flapping em amarelo + badge
// - Duração corrigida (s/ms) e formato d h m s
// - Popup persistente (só fecha no [x])
// - Alerta sonoro em transição para DOWN
// - Busca com múltiplos resultados + painel flutuante
// ============================================================

// ------------------------------
// MAPA BASE
// ------------------------------
const map = L.map('map', {
  minZoom: 3,
  maxZoom: 18,
  preferCanvas: true,
  // Mantém popups abertos até clicar no [x]
  closePopupOnClick: false
});

// Camada OSM
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Foco inicial (RS)
map.setView([-30.0, -53.0], 6);

// ------------------------------
// CONSTANTES DE STATUS
// ------------------------------
const STATUS = {
  UP: "UP",
  DOWN: "DOWN",
  WARNING: "WARNING",
  UNKNOWN: "UNKNOWN"
};

// Severidade para clusters
function statusSeverity(s){
  switch (s) {
    case STATUS.DOWN:    return 3;
    case STATUS.WARNING: return 2;
    case STATUS.UNKNOWN: return 1;
    case STATUS.UP:
    default:             return 0;
  }
}

// (Opcional) Paleta, caso queira usar em outros pontos
function colorForStatus(s){
  switch (s) {
    case STATUS.UP:      return "#22c55e";
    case STATUS.DOWN:    return "#ef4444";
    case STATUS.WARNING: return "#f59e0b";
    case STATUS.UNKNOWN:
    default:             return "#6b7280";
  }
}

function cssClassForStatus(s){
  switch (s) {
    case STATUS.UP:      return "status-up";
    case STATUS.DOWN:    return "status-down";
    case STATUS.WARNING: return "status-warning";
    case STATUS.UNKNOWN:
    default:             return "status-unknown";
  }
}

function escapeHtml(s){
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

// ------------------------------
// Normalização de epoch e formatações
// ------------------------------

// Converte epoch (s ou ms) em milissegundos para exibição de datas
function epochToMs(epochMaybeSec){
  if (!epochMaybeSec || epochMaybeSec <= 0) return 0;
  // Heurística: < 1e12 → segundos; caso contrário → milissegundos
  return (epochMaybeSec < 1e12) ? epochMaybeSec * 1000 : epochMaybeSec;
}

// Converte epoch (s ou ms) em SEGUNDOS para cálculo de duração
function epochToSeconds(epoch){
  if (!epoch || epoch <= 0) return 0;
  return (epoch >= 1e12) ? Math.floor(epoch / 1000) : Math.floor(epoch);
}

function fmtDate(epochMaybeSec){
  const ms = epochToMs(epochMaybeSec);
  if (!ms || ms <= 0) return "—";
  return new Date(ms).toLocaleString();
}

// d h m s
function formatDhms(seconds){
  let s = Math.max(Math.floor(seconds || 0), 0);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600);  s %= 3600;
  const m = Math.floor(s / 60);    s %= 60;

  const parts = [];
  if (d) parts.push(`${d}d`);
  parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ------------------------------
// CLUSTER POR PIOR STATUS
// ------------------------------
function clusterClassForStatus(s){
  switch (s) {
    case STATUS.DOWN:    return "cluster-down";
    case STATUS.WARNING: return "cluster-warning";
    case STATUS.UNKNOWN: return "cluster-unknown";
    case STATUS.UP:
    default:             return "cluster-up";
  }
}

const clusters = L.markerClusterGroup({
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  chunkedLoading: true,
  iconCreateFunction: function(cluster) {
    // Determina o pior status entre os filhos
    let worst = STATUS.UP;
    cluster.getAllChildMarkers().forEach(marker => {
      // Se o marcador estiver flapping, tratamos como WARNING (amarelo)
      let st = marker.options._status ?? STATUS.UNKNOWN;
      if (marker.options._is_flapping === true) {
        st = STATUS.WARNING;
      }
      if (statusSeverity(st) > statusSeverity(worst)) {
        worst = st;
      }
    });

    const count = cluster.getChildCount();
    const cls = clusterClassForStatus(worst);
    return L.divIcon({
      html: `<div><span>${count}</span></div>`,
      className: `marker-cluster ${cls}`,
      iconSize: L.point(40, 40)
    });
  }
});
map.addLayer(clusters);

// --- Índice dos marcadores carregados (usado pela busca) ---
let CURRENT_MARKERS = []; // { marker: L.Marker, data: <obj da API> }

// ------------------------------
// ÁUDIO: alerta "gota" quando um host passa para DOWN
// ------------------------------
const AudioAlert = (() => {
  let ctx = null;
  let enabled = false;
  let lastPlay = 0;

  function ensureContext() {
    if (!ctx) {
      const ACtx = window.AudioContext || window.webkitAudioContext;
      if (!ACtx) return; // navegador sem Web Audio
      ctx = new ACtx();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function initOnUserGesture() {
    enabled = true;
    ensureContext();
  }

  function playDroplet() {
    if (!enabled) return;
    ensureContext();
    if (!ctx) return;

    const nowWall = Date.now();
    if (nowWall - lastPlay < 300) return; // throttle 300ms
    lastPlay = nowWall;

    const t0 = ctx.currentTime;
    const duration = 0.35;

    const osc = ctx.createOscillator();    // fonte
    const gain = ctx.createGain();         // envelope
    const bp   = ctx.createBiquadFilter(); // "ressonância" de gota

    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, t0);
    bp.Q.value = 5;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, t0);                      // início agudo
    osc.frequency.exponentialRampToValueAtTime(450, t0 + 0.28);  // queda rápida

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(bp).connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function setEnabled(v) {
    enabled = !!v;
    if (enabled) ensureContext();
  }
  function isEnabled() { return enabled; }

  return { playDroplet, setEnabled, isEnabled, initOnUserGesture };
})();

// UI: botão flutuante para ativar/desativar som
function ensureAudioToggleUI() {
  if (document.getElementById('audioToggle')) return;

  const btn = document.createElement('button');
  btn.id = 'audioToggle';
  btn.type = 'button';
  btn.className = 'audio-toggle off';
  btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Ativar som para alertas de DOWN';
  btn.textContent = '🔕 Som';

  btn.addEventListener('click', () => {
    const next = !AudioAlert.isEnabled();
    AudioAlert.setEnabled(next);
    if (next) {
      AudioAlert.initOnUserGesture();      // destrava o áudio no 1º clique
      btn.classList.remove('off');
      btn.classList.add('on');
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = '🔔 Som';
      btn.title = 'Desativar som';
    } else {
      btn.classList.remove('on');
      btn.classList.add('off');
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🔕 Som';
      btn.title = 'Ativar som para alertas de DOWN';
    }
  });

  document.body.appendChild(btn);
}
ensureAudioToggleUI();

// ------------------------------
// CRIAÇÃO DE MARCADORES
// ------------------------------
function createMarker(item){
  // Status vindo da API...
  let status = item.status ?? STATUS.UNKNOWN;

  // Se o host está flapping, força WARNING (amarelo)
  const isFlapping = item.is_flapping === true;
  if (isFlapping) {
    status = STATUS.WARNING;
  }

  const css = cssClassForStatus(status);
  const div = document.createElement("div");
  div.className = css;
  div.innerHTML = `<div class="marker-dot"></div>`;

  const marker = L.marker([item.lat, item.lng], {
    icon: L.divIcon({
      className: "",
      html: div,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    }),
    title: `${item.nome} — ${status}`,
    _status: status,
    _is_flapping: isFlapping
  });

  // Badge "Flapping" quando aplicável
  const flappingBadge = isFlapping
    ? `<span class="badge-flapping" title="Host em estado flapping">Flapping</span>`
    : "";

  // --------- CÁLCULO DE DURAÇÃO (robusto s/ms) ----------
  // Pegamos os epochs e normalizamos para SEGUNDOS para o cálculo.
  const lastUpSec   = epochToSeconds(item.last_time_up   ?? 0);
  const lastDownSec = epochToSeconds(item.last_time_down ?? 0);
  const nowSec      = Math.floor(Date.now() / 1000);

  let durationLabel;
  let durationValueSec = 0;

  if (status === STATUS.DOWN) {
    // Se ainda está DOWN → "Duração até o momento: now - last_down"
    durationLabel = "Duração até o momento:";
    durationValueSec = Math.max(nowSec - lastUpSec, 0);
  } else {
    // Se está UP → "Duração última indisponibilidade: last_up - last_down"
    durationLabel = "Duração última indisponibilidade:";
    durationValueSec = Math.max(lastUpSec - lastDownSec, 0);
  }
  const durationHuman = formatDhms(durationValueSec);
  // ------------------------------------------------------

  const popupHtml = `
    <div style="min-width:240px">
      <strong>${escapeHtml(item.nome)}</strong> ${flappingBadge}<br>
      Host: ${escapeHtml(item.host)}<br>
      Status: <b>${escapeHtml(status)}</b><br>
      <small>${escapeHtml(item.plugin_output ?? "")}</small>
      <hr style="border:none;border-top:1px solid #eee;margin:6px 0;">
      <small>
        <!-- Removido: Último UP -->
        Último DOWN: ${fmtDate(item.last_time_down)}<br>
        ${durationLabel} ${durationHuman}
      </small>
    </div>
  `;

  // Popup fica aberto até clicar no [x]
  marker.bindPopup(popupHtml, {
    autoClose: false,
    closeOnClick: false,
    closeButton: true
  });

  return marker;
}

// ------------------------------
// BUSCA DE STATUS NO BACKEND
// ------------------------------
async function fetchStatus(){
  const resp = await fetch("/api/status?" + Date.now()); // cache-busting
  if (!resp.ok) throw new Error("Falha ao buscar /api/status");
  return await resp.json();
}

// ------------------------------
// ATUALIZAÇÃO DO MAPA + DETECÇÃO DE QUEDAS (som)
// ------------------------------
const _prevStatusByHost = new Map(); // host -> STATUS.*

async function atualizarMapa(){
  try {
    const dados = await fetchStatus();

    // Detecta transições para DOWN antes de redesenhar
    const nextMap = new Map();
    for (const item of dados) {
      // status efetivo (considerando flapping => WARNING)
      const isFlapping = item.is_flapping === true;
      const effectiveStatus = isFlapping ? STATUS.WARNING : (item.status ?? STATUS.UNKNOWN);

      const prev = _prevStatusByHost.get(item.host);
      nextMap.set(item.host, effectiveStatus);

      // Toca som somente em transição (prev não DOWN -> agora DOWN)
      if (prev !== undefined && prev !== STATUS.DOWN && effectiveStatus === STATUS.DOWN) {
        AudioAlert.playDroplet();
      }
    }
    // Atualiza memória
    _prevStatusByHost.clear();
    nextMap.forEach((v, k) => _prevStatusByHost.set(k, v));

    // Redesenha
    clusters.clearLayers();

    // Índice global para buscas no painel
    CURRENT_MARKERS = [];

    dados.forEach(item => {
      const m = createMarker(item);
      CURRENT_MARKERS.push({ marker: m, data: item });
      clusters.addLayer(m);
    });

    const lbl = document.getElementById("lastUpdate");
    if (lbl) lbl.textContent = new Date().toLocaleString();

    if (!atualizarMapa._fitted && dados.length > 0) {
      const bounds = L.latLngBounds(
        dados.map(d => [d.lat, d.lng])
      );
      map.fitBounds(bounds.pad(0.15), { animate: false });
      atualizarMapa._fitted = true;
    }
  } catch (err) {
    console.error(err);
    const lbl = document.getElementById("lastUpdate");
    if (lbl) lbl.textContent = "Erro";
  }
}

// Atualização automática
setInterval(atualizarMapa, 10000);
atualizarMapa();

// ============================================================
// BUSCA E ABERTURA MÚLTIPLA DE RESULTADOS (APIs públicas)
// ============================================================

// Normaliza string para busca (sem acento e minúsculas)
function _normalize(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Retorna array de correspondências para o termo (em nome ou host)
function _buscarResultados(termo) {
  const t = _normalize(termo);
  if (!t) return [];

  return CURRENT_MARKERS
    .map((row, idx) => ({
      idx,                         // índice interno (0-based)
      marker: row.marker,
      item: row.data,              // objeto vindo da API
      nome: row.data?.nome ?? "",
      host: row.data?.host ?? "",
      status: row.data?.status ?? "UNKNOWN"
    }))
    .filter(r => _normalize(r.nome).includes(t) || _normalize(r.host).includes(t));
}

// Interpreta padrões de seleção: "todos", "1,3,5", "2-4", "primeiros 3"
function _parseSelecao(qtd, selecao) {
  if (!selecao) return [...Array(qtd).keys()];

  const p = selecao.toString().trim().toLowerCase();
  if (p === "todos") return [...Array(qtd).keys()];

  // "primeiros N"
  if (p.startsWith("primeiros")) {
    const n = parseInt(p.replace(/[^\d]/g, ""), 10) || 0;
    return [...Array(Math.min(n, qtd)).keys()];
  }

  // Listas e faixas: "1,3,5" e "2-4"
  const out = new Set();
  p.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(part => {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/); // faixa
    if (m) {
      let a = parseInt(m[1], 10) - 1;
      let b = parseInt(m[2], 10) - 1;
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(0, a); i <= Math.min(qtd - 1, b); i++) out.add(i);
      return;
    }
    const k = parseInt(part, 10);
    if (!isNaN(k)) {
      const idx = k - 1;
      if (idx >= 0 && idx < qtd) out.add(idx);
    }
  });

  // Se nada válido foi informado, por padrão retorna todos
  return out.size ? [...out].sort((a, b) => a - b) : [...Array(qtd).keys()];
}

// Fecha todos os popups abertos (se desejar antes de abrir novos)
function _fecharTodosPopups() {
  CURRENT_MARKERS.forEach(({ marker }) => {
    try { marker.closePopup(); } catch (e) {}
  });
}

// Abre popups para os itens selecionados e ajusta a visão do mapa
async function abrirResultados(termo, selecao = "todos", opts = {}) {
  const { centralizar = true, fecharPopups = false, padding = 0.2 } = opts;

  const resultados = _buscarResultados(termo);
  if (!resultados.length) {
    console.warn(`Nenhum resultado para: "${termo}"`);
    return [];
  }

  const indices = _parseSelecao(resultados.length, selecao);
  const escolhidos = indices.map(i => resultados[i]).filter(Boolean);

  if (!escolhidos.length) return [];

  if (fecharPopups) _fecharTodosPopups();

  // Abrir cada popup; se estiver dentro de cluster, usar zoomToShowLayer
  const bounds = L.latLngBounds([]);
  for (const r of escolhidos) {
    try {
      const ll = r.marker.getLatLng();
      if (ll) bounds.extend(ll);
      clusters.zoomToShowLayer(r.marker, () => {
        r.marker.openPopup(); // fica aberto até clicar no [x]
      });
    } catch (e) {
      console.error("Falha ao abrir popup:", e);
    }
  }

  // Centraliza o mapa abrangendo todos os selecionados
  if (centralizar && bounds.isValid()) {
    map.fitBounds(bounds.pad(padding), { animate: false });
  }

  return escolhidos;
}

// --- Exponha funções no escopo global (para chamar via console/integrações) ---
window.mapaListar = function(termo) {
  const res = _buscarResultados(termo);
  // Retorna uma listagem amigável (1-based)
  return res.map((r, i) => `${i + 1}. ${r.nome} (${r.host}) — ${r.status}`);
};
window.mapaAbrir = function(termo, selecao = "todos", opts = {}) {
  return abrirResultados(termo, selecao, opts);
};

// ============================
// Painel flutuante de busca
// ============================
(function initSearchPanel(){
  // --- Fallbacks mínimos se utilitários não existirem ---
  function _normalizeLocal(s) {
    return (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  const buscar = (window._buscarResultados) ? window._buscarResultados : function(termo) {
    const t = _normalizeLocal(termo);
    if (!t) return [];
    return (window.CURRENT_MARKERS || []).map((row, idx) => ({
      idx, marker: row.marker, item: row.data,
      nome: row.data?.nome ?? "", host: row.data?.host ?? "", status: row.data?.status ?? "UNKNOWN"
    })).filter(r => _normalizeLocal(r.nome).includes(t) || _normalizeLocal(r.host).includes(t));
  };
  const fecharTodos = (window._fecharTodosPopups) ? window._fecharTodosPopups : function() {
    (window.CURRENT_MARKERS || []).forEach(({ marker }) => { try { marker.closePopup(); } catch(e){} });
  };

  // --- Toggle button (lupa) ---
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'searchToggle';
  toggleBtn.className = 'search-toggle';
  toggleBtn.type = 'button';
  toggleBtn.title = 'Abrir busca (Ctrl+K)';
  toggleBtn.textContent = '🔎 Buscar';
  document.body.appendChild(toggleBtn);

  // --- Painel principal ---
  const panel = document.createElement('div');
  panel.id = 'searchPanel';
  panel.className = 'search-panel';
  panel.innerHTML = `
    <div class="search-panel__header">
      <div>Buscar no mapa</div>
      <button class="search-panel__close" title="Fechar (Esc)">✕</button>
    </div>
    <div class="search-panel__body">
      <div class="search-panel__input">
        <input id="searchTerm" type="text" placeholder="Nome ou host..." />
        <button id="btnSearch" type="button">Buscar</button>
      </div>
      <div class="search-panel__options">
        <label><input id="optCentralizar" type="checkbox" checked> Centralizar ao abrir</label>
        <label><input id="optFecharAntes" type="checkbox"> Fechar popups existentes antes</label>
      </div>
      <div class="search-panel__results">
        <div class="search-panel__results-header">
          <span>Resultados</span>
          <label><input id="chkSelectAll" type="checkbox"> Selecionar todos</label>
        </div>
        <div id="resultsList" class="search-panel__results-list"></div>
      </div>
    </div>
    <div class="search-panel__footer">
      <button id="btnClosePopups" type="button">Fechar popups</button>
      <button id="btnOpenSelected" type="button" class="primary" title="Ctrl+Enter">Abrir selecionados</button>
    </div>
  `;
  document.body.appendChild(panel);

  // --- State ---
  let resultsCache = []; // array dos resultados da busca corrente

  // --- Helpers de UI ---
  function openPanel() {
    panel.classList.add('open');
    setTimeout(() => { termInput.focus(); termInput.select(); }, 0);
  }
  function closePanel() {
    panel.classList.remove('open');
  }
  function statusClass(s) {
    switch ((s || '').toUpperCase()) {
      case 'UP': return 'up';
      case 'DOWN': return 'down';
      case 'WARNING': return 'warning';
      default: return 'unknown';
    }
  }
  function renderResults(res) {
    resultsCache = res || [];
    resultsList.innerHTML = '';

    if (!resultsCache.length) {
      resultsList.innerHTML = `<div style="padding:10px;color:#666;font-size:12px">Nenhum resultado</div>`;
      chkSelectAll.checked = false;
      return;
    }

    const frag = document.createDocumentFragment();
    resultsCache.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'search-item';
      row.innerHTML = `
        <input type="checkbox" class="res-check" data-i="${i}">
        <div>
          <div class="search-item__name">${escapeHtml(r.nome)}</div>
          <div class="search-item__host">${escapeHtml(r.host)}</div>
        </div>
        <div class="search-item__status ${statusClass(r.status)}">${escapeHtml(r.status)}</div>
      `;
      frag.appendChild(row);
    });
    resultsList.appendChild(frag);
    chkSelectAll.checked = false;
  }

  function getSelectedIndices() {
    const checks = resultsList.querySelectorAll('.res-check:checked');
    return Array.from(checks).map(ch => parseInt(ch.getAttribute('data-i'), 10)).filter(i => !isNaN(i));
  }

  function centerAndOpenMultiple(selected, centralizar, fecharAntes) {
    if (!selected.length) return;

    if (fecharAntes) fecharTodos();

    // Abre popups e computa bounds
    const bounds = L.latLngBounds([]);
    selected.forEach(r => {
      try {
        const ll = r.marker.getLatLng();
        if (ll) bounds.extend(ll);
        clusters.zoomToShowLayer(r.marker, () => r.marker.openPopup());
      } catch(e) { console.error(e); }
    });

    if (centralizar && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { animate: false });
    }
  }

  // --- DOM refs ---
  const termInput      = panel.querySelector('#searchTerm');
  const btnSearch      = panel.querySelector('#btnSearch');
  const chkSelectAll   = panel.querySelector('#chkSelectAll');
  const resultsList    = panel.querySelector('#resultsList');
  const btnOpenSel     = panel.querySelector('#btnOpenSelected');
  const btnClosePopups = panel.querySelector('#btnClosePopups');
  const optCentralizar = panel.querySelector('#optCentralizar');
  const optFecharAntes = panel.querySelector('#optFecharAntes');
  const btnCloseX      = panel.querySelector('.search-panel__close');

  // --- Eventos ---
  toggleBtn.addEventListener('click', openPanel);
  btnCloseX.addEventListener('click', closePanel);

  // Atalhos globais: Ctrl+K abre, Esc fecha, Ctrl+Enter abre selecionados
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openPanel(); }
    if (ev.key === 'Escape' && panel.classList.contains('open')) { ev.preventDefault(); closePanel(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && panel.classList.contains('open')) {
      ev.preventDefault(); btnOpenSel.click();
    }
  });

  // Buscar (Enter no input e botão)
  termInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); btnSearch.click(); }
  });
  btnSearch.addEventListener('click', () => {
    const termo = termInput.value.trim();
    const res = buscar(termo);
    renderResults(res);
  });

  // Selecionar todos
  chkSelectAll.addEventListener('change', () => {
    const checks = resultsList.querySelectorAll('.res-check');
    checks.forEach(ch => ch.checked = chkSelectAll.checked);
  });

  // Abrir selecionados
  btnOpenSel.addEventListener('click', () => {
    const idxs = getSelectedIndices();
    const selected = (idxs.length ? idxs : [] ).map(i => resultsCache[i]).filter(Boolean);
    if (!selected.length) {
      // Se nada marcado mas há resultados, abre todos
      if (resultsCache.length) {
        centerAndOpenMultiple(resultsCache, optCentralizar.checked, optFecharAntes.checked);
      }
      return;
    }
    centerAndOpenMultiple(selected, optCentralizar.checked, optFecharAntes.checked);
  });

  // Fechar popups
  btnClosePopups.addEventListener('click', () => fecharTodos());
})();
// ============================