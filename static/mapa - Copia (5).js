// ============================================================
// MAPA DAS PROMOTORIAS — Versão Final (Leaflet + Cluster)
// Compatível com server.py final
// ============================================================

// ------------------------------
// MAPA BASE
// ------------------------------
const map = L.map('map', {
  minZoom: 3,
  maxZoom: 18,
  preferCanvas: true,

  // ► Mantém popups abertos até clicar no [x]
  closePopupOnClick: false
});

// Camada OSM
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© https://www.openstreetmap.orgOpenStreetMap</a>'
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

  // ► Mantém popup aberto até clicar no [x]
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
    dados.forEach(item => {
      clusters.addLayer(createMarker(item));
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
``