
// ============================================================
//  MAPA DAS PROMOTORIAS — Versão Final (Leaflet + Cluster)
//  Compatível com server.py final
// ============================================================

// ------------------------------------------------------------
//  MAPA BASE
// ------------------------------------------------------------
const map = L.map('map', {
    minZoom: 3,
    maxZoom: 18,
    preferCanvas: true
});

// Camada OSM
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
        '&copy; https://www.openstreetmap.orgOpenStreetMap</a>'
}).addTo(map);

// Foco inicial (RS)
map.setView([-30.0, -53.0], 6);

// ------------------------------------------------------------
//  CONSTANTES DE STATUS
// ------------------------------------------------------------
const STATUS = {
    UP:      "UP",
    DOWN:    "DOWN",
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
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;");
}

function fmtDate(ms){
    if (!ms || ms <= 0) return "—";
    return new Date(ms).toLocaleString();
}

// ------------------------------------------------------------
//  CLUSTER POR PIOR STATUS
// ------------------------------------------------------------
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
        let worst = STATUS.UP;

        cluster.getAllChildMarkers().forEach(marker => {
            const st = marker.options._status || STATUS.UNKNOWN;
            if (statusSeverity(st) > statusSeverity(worst)) {
                worst = st;
            }
        });

        const count = cluster.getChildCount();
        const cls   = clusterClassForStatus(worst);

        return L.divIcon({
            html: `<div><span>${count}</span></div>`,
            className: `marker-cluster ${cls}`,
            iconSize: L.point(40, 40)
        });
    }
});

map.addLayer(clusters);

// ------------------------------------------------------------
//  CRIAÇÃO DE MARCADORES
// ------------------------------------------------------------
function createMarker(item){
    const status = item.status ?? STATUS.UNKNOWN;
    const css    = cssClassForStatus(status);

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
        _status: status
    });

    const popup = `
        <div style="min-width:240px">
            <strong>${escapeHtml(item.nome)}</strong><br>
            Host: ${escapeHtml(item.host)}<br>
            Status: <b>${escapeHtml(status)}</b><br>
            <small>${escapeHtml(item.plugin_output || "")}</small>
            <hr style="border:none;border-top:1px solid #eee;margin:6px 0;">
            <small>
                Último UP: ${fmtDate(item.last_time_up)}<br>
                Último DOWN: ${fmtDate(item.last_time_down)}<br>
                Duração última indisponibilidade: ${item.last_downtime_duration_ms ?? 0} ms
            </small>
        </div>
    `;

    marker.bindPopup(popup);
    return marker;
}

// ------------------------------------------------------------
//  BUSCA DE STATUS NO BACKEND
// ------------------------------------------------------------
async function fetchStatus(){
    const resp = await fetch("/api/status?" + Date.now());  // cache-busting
    if (!resp.ok) throw new Error("Falha ao buscar /api/status");
    return await resp.json();
}

// ------------------------------------------------------------
//  ATUALIZAÇÃO DO MAPA
// ------------------------------------------------------------
async function atualizarMapa(){
    try {
        const dados = await fetchStatus();

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
