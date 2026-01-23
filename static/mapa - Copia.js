const map = L.map('map').setView([-30, -51], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18
}).addTo(map);

const iconBase = '/icons/';
function iconStatus(st) {
  let file = 'unknown.png';
  if (st === 'OK') file = 'ok.png';
  else if (st === 'WARNING') file = 'warning.png';
  else if (st === 'CRITICAL') file = 'critical.png';
  return L.icon({
    iconUrl: iconBase + file,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28]
  });
}

const clusterGroup = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false
});
map.addLayer(clusterGroup);

const markers = {};

async function atualizar() {
  try {
    const dados = await fetch('/api/status').then(r => r.json());
    dados.forEach(p => {
      const key = p.host;
      const ic = iconStatus(p.status_nagios);
      if (!markers[key]) {
        const m = L.marker([p.lat, p.lng], { icon: ic });
        m.bindPopup(`
          <b>${p.nome}</b><br>
          Host: ${p.host}<br>
          Status Nagios: <b>${p.status_nagios}</b><br>
          Status Local: ${p.status_local}
        `);
        markers[key] = m;
        clusterGroup.addLayer(m);
      } else {
        markers[key].setIcon(ic);
        markers[key].setPopupContent(`
          <b>${p.nome}</b><br>
          Host: ${p.host}<br>
          Status Nagios: <b>${p.status_nagios}</b><br>
          Status Local: ${p.status_local}
        `);
      }
    });
  } catch (e) {
    console.error('Falha ao atualizar:', e);
  }
}

atualizar();
setInterval(atualizar, 30000);
