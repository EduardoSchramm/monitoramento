
// ======================= MAPA ===========================
const map = L.map('map').setView([-30, -51], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18
}).addTo(map);

const iconBase = '/icons/';

// ======================= FUNÇÃO DE ÍCONES ===========================
// Status possíveis agora: "UP", "DOWN", "WARNING", "UNKNOW"
function iconStatus(st) {
    st = (st || "").toUpperCase();

    let file = "unknown.png";  // padrão

    if (st === "UP") file = "up.png";
    else if (st === "DOWN") file = "down.png";
    else if (st === "WARNING") file = "warning.png";
    else if (st === "UNKNOW") file = "unknown.png";

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
    showCoverageOnHover: false,

  // NOVO: define o visual dos clusters e propaga o estado "DOWN"
  iconCreateFunction: function (cluster) {
    const children = cluster.getAllChildMarkers();
    const count = children.length;

    // Se algum filho estiver DOWN, marcamos o cluster como "warn"
    const hasDown = children.some(m => (m.options.statusNagios || '').toUpperCase() === 'DOWN');

    // Tamanho proporcional: pequeno / médio / grande
    const size = count < 10 ? 28 : count < 50 ? 34 : 40;

    return L.divIcon({
      html: `<div class="cluster-inner" aria-label="Cluster com ${count} itens">${count}</div>`,
      className: `cluster-base ${hasDown ? 'cluster-warn' : 'cluster-ok'}`,
      iconSize: [size, size]
    });
  }

});
map.addLayer(clusterGroup);

const markers = {};


// ======================= ATUALIZAÇÃO ===========================
async function atualizar() {
    try {
        const dados = await fetch('/api/status').then(r => r.json());

        dados.forEach(p => {
            const key = p.host;
            const ic = iconStatus(p.status_nagios);

            if (!markers[key]) {
                // Criar novo marcador
                const m = L.marker([p.lat, p.lng], { icon: ic });

                m.bindPopup(`
                    <b>${p.nome}</b><br>
                    Host: ${p.host}<br>
                    Status Nagios: <b>${p.status_nagios}</b><br>
                    Status Local: ${p.status_local}
                `);

                markers[key] = m;
                clusterGroup.addLayer(m);

                // ----- aplicar ANIMAÇÃO DOWN -----
                m.on('add', () => {
                    const el = m.getElement();
                    if (el) {
                        if (p.status_nagios === "DOWN") el.classList.add("blinking-icon");
                        else el.classList.remove("blinking-icon");
                    }
                });

            } else {
                // Atualizar ícone
                markers[key].setIcon(ic);

                // Atualizar popup
                markers[key].setPopupContent(`
                    <b>${p.nome}</b><br>
                    Host: ${p.host}<br>
                    Status Nagios: <b>${p.status_nagios}</b><br>
                    Status Local: ${p.status_local}
                `);

                // Atualizar animação
                const el = markers[key].getElement();
                if (el) {
                    if (p.status_nagios === "DOWN") el.classList.add("blinking-icon");
                    else el.classList.remove("blinking-icon");
                }
            }
        });

    } catch (e) {
        console.error('Falha ao atualizar:', e);
    }
}

// Chamada inicial e atualização a cada 30s
atualizar();
setInterval(atualizar, 30000);
