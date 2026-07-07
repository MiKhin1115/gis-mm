const CONFIG = {
  center: [21.5, 96],
  zoom: 6,
  csvPath: "data/myanmar_cities.csv",
  boundaryPath: "data/myanmar.geojson",
  cityZoom: 12,
  countryPadding: [28, 28]
};

const state = {
  cities: [],
  markersByName: new Map(),
  activeMarker: null,
  userMarker: null,
  accuracyCircle: null,
  boundaryLayer: null
};

const loading = document.querySelector("#loading");
const popupTemplate = document.querySelector("#popup-template");

const map = L.map("map", {
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  zoomControl: true,
  preferCanvas: true
});

const baseLayers = {
  OpenStreetMap: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }),
  "Esri World Imagery": L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri"
    }
  )
};

baseLayers.OpenStreetMap.addTo(map);

const cityCluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  animate: true,
  animateAddingMarkers: true,
  maxClusterRadius: 48
});

map.addLayer(cityCluster);

L.control.layers(baseLayers, {}, { position: "topright", collapsed: true }).addTo(map);
L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(map);

if (L.control.measure) {
  L.control.measure({
    position: "topleft",
    primaryLengthUnit: "meters",
    secondaryLengthUnit: "kilometers",
    primaryAreaUnit: "sqmeters",
    secondaryAreaUnit: "hectares",
    activeColor: "#e53935",
    completedColor: "#23784b"
  }).addTo(map);
}

if (L.Control.Geocoder) {
  L.Control.geocoder({
    position: "topleft",
    defaultMarkGeocode: false,
    placeholder: "Search places..."
  })
    .on("markgeocode", (event) => {
      const center = event.geocode.center;
      map.setView(center, 12);
    })
    .addTo(map);
}

const CitySearchControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const container = L.DomUtil.create("form", "city-search");
    container.setAttribute("role", "search");
    container.innerHTML = `
      <input type="search" list="city-options" placeholder="Search city, e.g. Yangon" aria-label="Search Myanmar city">
      <button type="submit" title="Search city" aria-label="Search city">⌕</button>
    `;

    const input = container.querySelector("input");
    let searchTimer;

    input.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        const value = cleanText(input.value).toLowerCase();
        if (state.markersByName.has(value)) {
          focusCity(input.value);
        }
      }, 360);
    });

    container.addEventListener("submit", (event) => {
      event.preventDefault();
      focusCity(input.value);
    });

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  }
});

map.addControl(new CitySearchControl());

const LocateButton = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const container = L.DomUtil.create("div", "locate-me-control leaflet-control");
    const button = L.DomUtil.create("button", "locate-me-button", container);
    button.type = "button";
    button.title = "Show my current location";
    button.setAttribute("aria-label", "Show my current location");
    button.innerHTML = `<span aria-hidden="true">◎</span><strong>Locate Me</strong>`;

    L.DomEvent.on(button, "click", (event) => {
      L.DomEvent.preventDefault(event);

      if (!navigator.geolocation) {
        showToast("Your browser does not support location detection.");
        return;
      }

      if (!window.isSecureContext) {
        showToast("Location needs HTTPS or localhost. Use GitHub Pages or the local preview URL, not direct file open.");
        return;
      }

      button.classList.add("is-loading");
      map.locate({ setView: false, enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      showToast("Requesting your location permission...");
    });

    L.DomEvent.disableClickPropagation(container);
    return container;
  }
});

map.addControl(new LocateButton());

const CompassControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const container = L.DomUtil.create("div", "compass-control");
    container.title = "North";
    container.innerHTML = '<div class="compass-needle"><span>N</span></div>';
    return container;
  }
});

map.addControl(new CompassControl());

const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = `
    <h2>Legend</h2>
    <div class="legend-row"><span class="legend-symbol city"></span><span>Red Marker = Myanmar City</span></div>
    <div class="legend-row"><span class="legend-symbol user"></span><span>Blue Marker = Your Location</span></div>
    <div class="legend-row"><span class="legend-symbol boundary"></span><span>Green Polygon = Myanmar Boundary</span></div>
  `;
  return div;
};
legend.addTo(map);

map.on("locationfound", (event) => {
  const { latlng, accuracy } = event;

  if (!state.userMarker) {
    state.userMarker = L.marker(latlng, {
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: "",
        html: '<div class="user-location-marker"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    }).addTo(map);
  } else {
    state.userMarker.setLatLng(latlng);
  }

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: "#2563eb",
      weight: 2,
      fillColor: "#60a5fa",
      fillOpacity: 0.16
    }).addTo(map);
  } else {
    state.accuracyCircle.setLatLng(latlng).setRadius(accuracy);
  }

  document.querySelector(".locate-me-button")?.classList.remove("is-loading");
  state.accuracyCircle.bringToFront();
  state.userMarker.bindPopup(`You are within about ${formatDistance(accuracy)} of this point.`).openPopup();
  map.fitBounds(state.accuracyCircle.getBounds(), { maxZoom: 16, padding: [36, 36] });
});

map.on("locationerror", (event) => {
  document.querySelector(".locate-me-button")?.classList.remove("is-loading");
  const message = event.code === 1
    ? "Location permission was denied. You can enable location access in your browser settings and try again."
    : "Your location could not be found right now. Please try again in a moment.";
  showToast(message);
});

loadBoundary();
loadCities();

async function loadCities() {
  setLoading(true);

  Papa.parse(CONFIG.csvPath, {
    download: true,
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    complete: (results) => {
      try {
        if (results.errors.length) {
          console.warn("CSV parse warnings:", results.errors);
        }

        const cities = normalizeCities(results.data);
        renderCities(cities);
        updateSearchOptions(cities);
        fitToLoadedData();
      } catch (error) {
        console.error(error);
        showToast("Cities loaded, but some records could not be rendered. Please check the CSV columns.");
      } finally {
        setLoading(false);
      }
    },
    error: (error) => {
      console.error(error);
      setLoading(false);
      showToast("Unable to load data/myanmar_cities.csv. Check the file path and try again.");
    }
  });
}

async function loadBoundary() {
  try {
    const response = await fetch(CONFIG.boundaryPath);
    if (!response.ok) throw new Error(`Boundary request failed: ${response.status}`);

    const geojson = await response.json();
    state.boundaryLayer = L.geoJSON(geojson, {
      style: {
        color: "#14532d",
        fillColor: "#86efac",
        fillOpacity: 0.16,
        weight: 2
      },
      onEachFeature: (_feature, layer) => {
        layer.bindPopup("<strong>Myanmar Boundary</strong>");
        layer.on("click", () => {
          layer.openPopup();
          map.fitBounds(layer.getBounds(), { padding: CONFIG.countryPadding });
        });
      }
    }).addTo(map);

    state.boundaryLayer.bringToBack();
  } catch (error) {
    console.warn("Myanmar boundary could not be loaded.", error);
    showToast("Myanmar boundary file is a placeholder or could not be loaded.");
  }
}

function normalizeCities(rows) {
  const seen = new Set();

  return rows.reduce((cities, row) => {
    const cityName = cleanText(row.City);
    const country = cleanText(row.Country) || "Myanmar";
    const lat = Number(row.Latitude_Decimal);
    const lng = Number(row.Longitude_Decimal);
    const key = `${cityName.toLowerCase()}|${lat}|${lng}`;

    if (!cityName || !Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(key)) {
      return cities;
    }

    seen.add(key);
    cities.push({
      country,
      city: cityName,
      latitudeText: cleanText(row.Latitude) || lat.toFixed(4),
      longitudeText: cleanText(row.Longitude) || lng.toFixed(4),
      lat,
      lng
    });

    return cities;
  }, []);
}

function renderCities(cities) {
  cityCluster.clearLayers();
  state.cities = cities;
  state.markersByName.clear();

  const markers = cities.map((city) => {
    const marker = createCityMarker(city);
    state.markersByName.set(city.city.toLowerCase(), marker);
    return marker;
  });

  cityCluster.addLayers(markers);
}

function createCityMarker(city) {
  const marker = L.marker([city.lat, city.lng], {
    title: city.city,
    icon: L.divIcon({
      className: "",
      html: '<div class="city-marker"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })
  });

  marker.cityData = city;
  marker.bindTooltip(escapeHtml(city.city), {
    permanent: true,
    direction: "top",
    offset: [0, -16],
    className: "city-label"
  });
  marker.bindPopup(buildPopup(city), { closeButton: true });

  marker.on("mouseover", () => setMarkerActive(marker, true));
  marker.on("mouseout", () => setMarkerActive(marker, false));
  marker.on("click", () => animateMarkerClick(marker));

  return marker;
}

function buildPopup(city) {
  const node = popupTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("h2").textContent = city.city;
  node.querySelector("[data-country]").textContent = city.country;
  node.querySelector("[data-latitude]").textContent = `${city.lat.toFixed(5)} (${city.latitudeText})`;
  node.querySelector("[data-longitude]").textContent = `${city.lng.toFixed(5)} (${city.longitudeText})`;
  return node;
}

function focusCity(query) {
  const term = cleanText(query).toLowerCase();
  if (!term) return;

  const direct = state.markersByName.get(term);
  const fuzzy = state.cities.find((city) => city.city.toLowerCase().includes(term));
  const marker = direct || (fuzzy ? state.markersByName.get(fuzzy.city.toLowerCase()) : null);

  if (!marker) {
    showToast(`No city found for "${escapeHtml(query)}". Try Yangon, Mandalay, or Naypyidaw.`);
    return;
  }

  cityCluster.zoomToShowLayer(marker, () => {
    map.setView(marker.getLatLng(), CONFIG.cityZoom, { animate: true });
    marker.openPopup();
    animateMarkerClick(marker);
    setMarkerActive(marker, true);
    window.setTimeout(() => setMarkerActive(marker, false), 1800);
  });
}

function setMarkerActive(marker, active) {
  const element = marker.getElement()?.querySelector(".city-marker");
  if (element) element.classList.toggle("is-active", active);
}

function animateMarkerClick(marker) {
  const element = marker.getElement()?.querySelector(".city-marker");
  if (!element) return;

  element.classList.remove("is-clicked");
  void element.offsetWidth;
  element.classList.add("is-clicked");
}

function fitToLoadedData() {
  const cityBounds = cityCluster.getBounds();
  if (cityBounds.isValid()) {
    map.fitBounds(cityBounds, { padding: CONFIG.countryPadding, maxZoom: 8 });
    return;
  }

  if (state.boundaryLayer) {
    map.fitBounds(state.boundaryLayer.getBounds(), { padding: CONFIG.countryPadding });
  }
}

function updateSearchOptions(cities) {
  let datalist = document.querySelector("#city-options");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "city-options";
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = cities
    .map((city) => `<option value="${escapeHtml(city.city)}"></option>`)
    .join("");
}

function showToast(message) {
  const toast = L.control({ position: "bottomleft" });
  toast.onAdd = () => {
    const div = L.DomUtil.create("div", "toast");
    div.textContent = message;
    return div;
  };

  toast.addTo(map);
  window.setTimeout(() => toast.remove(), 4200);
}

function setLoading(isLoading) {
  loading.classList.toggle("is-hidden", !isLoading);
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return cleanText(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
