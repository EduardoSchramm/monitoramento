
// ======================= MAPA ===========================
const map = L.map('map').setView([-30, -51], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18
}).addTo(map);

const iconBase = '/icons/';

// ======================= FUNÇÃO DE ÍCONES ===========================
function iconStatus(st) {
  st = (st || "").toUpperCase();
  let file = "unknown.png"; // padrão
  if (st === "UP") file = "up.png";
  else if (st === "DOWN") file = "down.png";
  else if (st === "WARNING") file = "warning.png";
  else if (st === "UNKNOWN" || st === "UNKNOW") file = "unknown.png"; // compatibilidade
  return L.icon({
    iconUrl: iconBase + file,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28]
  });
}

// ======================= CLUSTER ===========================
const clusterGroup = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false, // vírgula corrigida
  iconCreateFunction: function (cluster) {
    const children = cluster.getAllChildMarkers();
    const count = children.length;

    const hasDown = children.some(m =>
      ((m.options.statusNagios || '') + '').toUpperCase() === 'DOWN'
    );

    const size = count < 10 ? 28 : (count < 50 ? 34 : 40);

    return L.divIcon({
      html: `${count}`,
      className: `cluster-base ${hasDown ? 'cluster-warn' : 'cluster-ok'}`,
      iconSize: [size, size]
    });
  }
});

map.addLayer(clusterGroup);

const markers = {};
const popupTimers = {}; // timers por popup

// ======================= FORMATADORES ===========================
function fmtEpochMs(ms) {
  if (!ms || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

function fmtDurationMs(ms) {
  if (!ms || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(' ');
}

function fmtDynamicDownDuration(lastDownMs) {
  if (!lastDownMs || lastDownMs <= 0) return '—';
  const now = Date.now();
  const diff = now - lastUpMs;
  return fmtDurationMs(diff);
}

// ======================= POPUP ===========================
function popupHtml(p, dynamic = false) {
  let dur;

  if (p.status_nagios.toUpperCase() === "DOWN" && dynamic) {
    dur = fmtDynamicDownDuration(p.last_time_down);
  } else {
    dur = fmtDurationMs(p.last_downtime_duration_ms);
  }

  const plugin = (p.plugin_output || '—').toString();

  return `
    <b>${p.nome}</b><br>
    Host: ${p.host}<br>
    Status Nagios: <b>${p.status_nagios}</b><br>
    Flapping: <b>${p.is_flapping ? 'Sim' : 'Não'}</b><br>
    Último DOWN: ${fmtEpochMs(p.last_time_down)}<br>
    Último UP após DOWN: ${fmtEpochMs(p.last_time_up)}<br>

    <b>Duração do último DOWN:</b> ${dur}<br>

    Plugin:<br>
    <pre style="white-space:pre-wrap;margin:4px 0 0">${plugin}</pre>
  `;
}

// ======================= ATUALIZAÇÃO ===========================
async function atualizar() {
  try {
    const dados = await fetch('/api/status').then(r => r.json());

    dados.forEach(p => {
      const key = p.host;
      const ic = iconStatus(p.status_nagios);

      if (!markers[key]) {
        // Criar novo marcador
        const m = L.marker([p.lat, p.lng], {
          icon: ic,
          statusNagios: p.status_nagios
        });

        m.bindPopup(popupHtml(p, true));
        markers[key] = m;
        clusterGroup.addLayer(m);

        // animação DOWN
        m.on('add', () => {
          const el = m.getElement();
          if (!el) return;
          if (p.status_nagios.toUpperCase() === "DOWN") el.classList.add("blinking-icon");
          else el.classList.remove("blinking-icon");
        });

        // timer de atualização dinâmica do popup
        m.on("popupopen", () => {
          if (popupTimers[key]) clearInterval(popupTimers[key]);

          if (p.status_nagios.toUpperCase() !== "DOWN") return;

          popupTimers[key] = setInterval(() => {
            m.setPopupContent(popupHtml(p, true));
          }, 1000);
        });

        m.on("popupclose", () => {
          if (popupTimers[key]) {
            clearInterval(popupTimers[key]);
            delete popupTimers[key];
          }
        });

      } else {
        // Atualizar marcador existente
        markers[key].options.statusNagios = p.status_nagios;
        markers[key].setIcon(ic);

        markers[key].setPopupContent(popupHtml(p, true));

        // Atualizar animação
        const el = markers[key].getElement();
        if (el) {
          if (p.status_nagios.toUpperCase() === "DOWN") el.classList.add("blinking-icon");
          else el.classList.remove("blinking-icon");
        }

        // Controle de timers
        markers[key].on("popupopen", () => {
          if (popupTimers[key]) clearInterval(popupTimers[key]);

          if (p.status_nagios.toUpperCase() !== "DOWN") return;

          popupTimers[key] = setInterval(() => {
            markers[key].setPopupContent(popupHtml(p, true));
          }, 1000);
        });

        markers[key].on("popupclose", () => {
          if (popupTimers[key]) {
            clearInterval(popupTimers[key]);
            delete popupTimers[key];
          }
        });
      }
    });

  } catch (e) {
    console.error('Falha ao atualizar:', e);
  }
}

// Chamada inicial e a cada 30s
atualizar();
setInterval(atualizar, 30000);

