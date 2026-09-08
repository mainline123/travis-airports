/**
 * MOON PALACE JAMAICA — AIRPORT INFORMATION & LIVE FLIGHT KIOSK
 * Real-time flight schedule engine for MBJ, KIN, and POT.
 * Matches mainline123 schema and 9:16 portrait display requirements.
 */

/* ==========================================================================
   CONFIG & DATA SOURCES
   ========================================================================== */

const MAX_ROWS = 24;
const KEEP_PREVIOUS = 4;
const INACTIVITY_TIMEOUT_MS = 90000; // 90 seconds auto-return to menu
const REFRESH_INTERVAL_MS = 60000;   // 1 minute data polling

const AIRPORT_CONFIG = {
  MBJ: {
    code: "MBJ",
    name: "SANGSTER INTERNATIONAL AIRPORT",
    location: "MONTEGO BAY • JAMAICA",
    sourceBadge: "OFFICIAL MBJ DATA",
    footerName: "Sangster International Airport",
    liveUrls: {
      departures: "https://mainline123.github.io/MBJ-Arrivals-/departures.json",
      arrivals: "https://mainline123.github.io/MBJ-Arrivals-/flights.json"
    },
    localUrls: {
      departures: "data/mbj-departures.json",
      arrivals: "data/mbj-arrivals.json"
    }
  },
  KIN: {
    code: "KIN",
    name: "NORMAN MANLEY INTERNATIONAL AIRPORT",
    location: "KINGSTON • JAMAICA",
    sourceBadge: "OFFICIAL NMIA DATA",
    footerName: "Norman Manley International Airport",
    liveUrls: {
      departures: "data/kin-departures.json",
      arrivals: "data/kin-arrivals.json"
    },
    localUrls: {
      departures: "data/kin-departures.json",
      arrivals: "data/kin-arrivals.json"
    }
  },
  POT: {
    code: "POT",
    name: "IAN FLEMING INTERNATIONAL AIRPORT",
    location: "OCHO RIOS • JAMAICA",
    sourceBadge: "OFFICIAL IAN FLEMING DATA",
    footerName: "Ian Fleming International Airport",
    liveUrls: {
      departures: "data/pot-departures.json",
      arrivals: "data/pot-arrivals.json"
    },
    localUrls: {
      departures: "data/pot-departures.json",
      arrivals: "data/pot-arrivals.json"
    }
  }
};

/* AIRLINE ICAO CODE MAP (FOR OFFICIAL LOGOS) */
const AIRLINES = {
  "AA": "AAL", // American Airlines
  "B6": "JBU", // JetBlue
  "AC": "ACA", // Air Canada
  "WS": "WJA", // WestJet
  "DL": "DAL", // Delta
  "UA": "UAL", // United Airlines
  "WN": "SWA", // Southwest
  "BA": "BAW", // British Airways
  "NK": "NKS", // Spirit Airlines
  "F9": "FFT", // Frontier
  "CM": "CMP", // Copa Airlines
  "TS": "TSC", // Air Transat
  "WG": "SWG", // Sunwing
  "BW": "BWA", // Caribbean Airlines
  "VS": "VIR", // Virgin Atlantic
  "BY": "TOM", // TUI Airways
  "OR": "TFL", // TUI fly Netherlands
  "SY": "SCX", // Sun Country
  "5Y": "GTI", // Atlas Air
  "P5": "RPB", // Wingo
  "JY": "IWY", // interCaribbean Airways
  "KX": "CAY", // Cayman Airways
  "DM": "ARA", // Arajet
  "TA": "TMA", // TimAir
  "AL": "ALK"  // Airlink Express
};

const LOGO_BASE = "https://raw.githubusercontent.com/imgmongelli/airlines-logos-dataset/master/images/";


/* ==========================================================================
   APP STATE
   ========================================================================== */

let currentAirport = "MBJ";
let currentType = "departures"; // "arrivals" or "departures"
let autoRefreshTimer = null;
let inactivityTimer = null;


/* ==========================================================================
   HELPER UTILITIES
   ========================================================================== */

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getAirlineCode(text) {
  const value = String(text || "").toUpperCase();
  const match = value.match(/\b([A-Z0-9]{2})\s*\d{1,4}[A-Z]?\b/);
  return match ? match[1] : "";
}

function renderAirlineCell(airlineFlight) {
  const safeText = escapeHTML(airlineFlight || "—");
  const code = getAirlineCode(airlineFlight);
  const icao = AIRLINES[code];

  if (!code) {
    return `<div class="airline-text">${safeText}</div>`;
  }

  // Local logo for instant 0ms offline rendering, falling back to remote dataset, then badge
  const localLogo = icao ? `assets/logos/${encodeURIComponent(icao)}.png` : "";
  const remoteLogo = icao ? `${LOGO_BASE}${encodeURIComponent(icao)}.png` : "";

  return `
    <div class="airline-logo-box">
      <img
        class="airline-logo-img"
        src="${localLogo}"
        alt=""
        onerror="if(this.dataset.triedRemote !== '1' && '${remoteLogo}'){ this.dataset.triedRemote='1'; this.src='${remoteLogo}'; } else { this.style.display='none'; this.nextElementSibling.style.display='flex'; }"
      />
      <div class="airline-fallback-badge">${escapeHTML(code)}</div>
    </div>
    <div class="airline-text">${safeText}</div>
  `;
}

function getStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("cancel")) return "status-cancelled";
  if (s.includes("delay")) return "status-delayed";
  if (s.includes("on-time") || s.includes("on time")) return "status-ontime";
  if (s.includes("landed") || s.includes("departed")) return "status-landed";
  return "";
}


/* ==========================================================================
   JAMAICA CLOCK & TIME MANAGEMENT
   ========================================================================== */

function updateJamaicaClock() {
  const now = new Date();

  // 12-hour time with seconds
  const timeString = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);

  // Full formatted date
  const dateString = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(now);

  const clockEl = document.getElementById("boardLiveClock");
  const dateEl = document.getElementById("boardLiveDate");

  if (clockEl) clockEl.textContent = timeString;
  if (dateEl) dateEl.textContent = dateString;
}

function getJamaicaMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(parts.find(p => p.type === "hour")?.value || 0);
  const minute = Number(parts.find(p => p.type === "minute")?.value || 0);

  return (hour % 24) * 60 + minute;
}

function parseFlightMinutes(timeString) {
  if (!timeString) return null;
  const match = String(timeString).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (ampm === "PM") hour += 12;

  return hour * 60 + minute;
}

function sliceMovingWindow(flights) {
  if (!Array.isArray(flights) || flights.length <= MAX_ROWS) {
    return flights || [];
  }

  const nowMins = getJamaicaMinutesNow();

  let nextIndex = flights.findIndex(f => {
    const mins = parseFlightMinutes(f.scheduledTime);
    return mins !== null && mins >= nowMins;
  });

  if (nextIndex === -1) {
    return flights.slice(-MAX_ROWS);
  }

  let start = Math.max(0, nextIndex - KEEP_PREVIOUS);
  if (start + MAX_ROWS > flights.length) {
    start = Math.max(0, flights.length - MAX_ROWS);
  }

  return flights.slice(start, start + MAX_ROWS);
}


/* ==========================================================================
   RENDER FLIGHT BOARD (Scrollable with all scheduled flights)
   ========================================================================== */

function renderFlightBoard(flights, type) {
  const bodyEl = document.getElementById("boardFlightList");
  if (!bodyEl) return;

  const allFlights = Array.isArray(flights) ? flights : [];

  if (allFlights.length === 0) {
    bodyEl.innerHTML = `
      <div class="empty-state">
        <p>No ${type} scheduled at this time.</p>
      </div>
    `;
    return;
  }

  const isDepartures = type === "departures";
  const nowMins = getJamaicaMinutesNow();

  let nextIndex = allFlights.findIndex(f => {
    const mins = parseFlightMinutes(f.scheduledTime);
    return mins !== null && mins >= nowMins;
  });

  bodyEl.innerHTML = allFlights.map((f, idx) => {
    const place = isDepartures ? (f.to || "—") : (f.from || "—");
    const desk = isDepartures ? (f.checkInCounters || "—") : (f.baggage || "—");
    const gate = f.gate || "—";
    const time = f.scheduledTime || "—";
    
    const displayStatus = f.actualTime
      ? `${f.actualTime}${f.status ? " • " + f.status : ""}`
      : (f.status || "—");

    const statusCls = getStatusClass(f.status);
    const isCurrent = idx === nextIndex ? " row-current-time" : "";

    return `
      <div class="flight-row${isCurrent}" data-index="${idx}">
        <div class="cell-airline">
          ${renderAirlineCell(f.airlineFlight)}
        </div>
        <div class="cell-place">${escapeHTML(place)}</div>
        <div class="cell-counter cell-center">${escapeHTML(desk)}</div>
        <div class="cell-gate cell-center">${escapeHTML(gate)}</div>
        <div class="cell-time cell-center">${escapeHTML(time)}</div>
        <div class="cell-status ${statusCls}">${escapeHTML(displayStatus)}</div>
      </div>
    `;
  }).join("");

  // Auto-scroll to upcoming flights smoothly while allowing full scrolling
  if (nextIndex > 2) {
    setTimeout(() => {
      const targetRow = bodyEl.querySelector(`[data-index="${nextIndex - 2}"]`);
      if (targetRow) {
        bodyEl.scrollTop = targetRow.offsetTop - bodyEl.offsetTop;
      }
    }, 150);
  }
}


/* ==========================================================================
   DATA FETCHING ENGINE (Live with Local Fallback)
   ========================================================================== */

async function loadFlightData(airportCode, type) {
  const config = AIRPORT_CONFIG[airportCode] || AIRPORT_CONFIG.MBJ;
  const liveUrl = config.liveUrls[type];
  const localUrl = config.localUrls[type];

  const bodyEl = document.getElementById("boardFlightList");
  if (bodyEl && !bodyEl.hasChildNodes()) {
    bodyEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading live flight data...</p>
      </div>
    `;
  }

  let data = null;

  // 1. Try Live Endpoint
  try {
    const res = await fetch(`${liveUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      data = await res.json();
    }
  } catch (err) {
    console.warn(`Live fetch failed for ${airportCode} ${type}, falling back to local dataset:`, err);
  }

  // 2. Fallback to Local Dataset if live fetch failed
  if (!data && localUrl) {
    try {
      const resLocal = await fetch(`${localUrl}?t=${Date.now()}`);
      if (resLocal.ok) {
        data = await resLocal.json();
      }
    } catch (errLocal) {
      console.error(`Local fetch failed for ${airportCode} ${type}:`, errLocal);
    }
  }

  // 3. Render
  if (data && Array.isArray(data.flights)) {
    renderFlightBoard(data.flights, type);

    // Update timestamp
    const updatedEl = document.getElementById("boardLastUpdated");
    if (updatedEl && data.updated) {
      const updatedTime = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Jamaica",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).format(new Date(data.updated));

      updatedEl.textContent = `UPDATED ${updatedTime}`;
    }
  } else {
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="empty-state">
          <p>Flight data temporarily unavailable.</p>
        </div>
      `;
    }
  }
}


/* ==========================================================================
   VIEW SWITCHING & INACTIVITY MANAGEMENT
   ========================================================================== */

function openFlightBoard(airportCode, type) {
  currentAirport = airportCode;
  currentType = type;

  const config = AIRPORT_CONFIG[airportCode] || AIRPORT_CONFIG.MBJ;
  const isDepartures = type === "departures";

  // Update Header details
  document.getElementById("boardAirportCode").textContent = config.code;
  document.getElementById("boardAirportName").textContent = config.name;
  document.getElementById("boardAirportLocation").textContent = config.location;
  document.getElementById("boardSourceBadge").textContent = config.sourceBadge;
  document.getElementById("boardFooterAirport").textContent = config.footerName;

  // Update Hero Category Title
  const categoryTitleEl = document.getElementById("boardCategoryTitle");
  if (isDepartures) {
    categoryTitleEl.innerHTML = `DEPARTURES <span class="hero-cat-icon">&#9992;</span>`;
    document.getElementById("colHeaderPlace").textContent = "TO";
    document.getElementById("colHeaderDesk").textContent = "CHECK-IN";
  } else {
    categoryTitleEl.innerHTML = `ARRIVALS <span class="hero-cat-icon">&#128748;</span>`;
    document.getElementById("colHeaderPlace").textContent = "FROM";
    document.getElementById("colHeaderDesk").textContent = "BAG";
  }

  // Clear previous flights immediately and show spinner
  const bodyEl = document.getElementById("boardFlightList");
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading live flight data...</p>
      </div>
    `;
  }

  // Switch views
  const menuView = document.getElementById("menuView");
  const boardView = document.getElementById("boardView");

  menuView.classList.remove("view-active");
  menuView.classList.add("view-hidden");

  boardView.classList.remove("view-hidden");
  boardView.classList.add("view-active");

  // Load flights immediately
  loadFlightData(currentAirport, currentType);

  // Set up auto-refresh
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    loadFlightData(currentAirport, currentType);
  }, REFRESH_INTERVAL_MS);

  // Reset inactivity timer
  resetInactivityTimer();
}

function returnToMenu() {
  const menuView = document.getElementById("menuView");
  const boardView = document.getElementById("boardView");

  boardView.classList.remove("view-active");
  boardView.classList.add("view-hidden");

  menuView.classList.remove("view-hidden");
  menuView.classList.add("view-active");

  // Clear timers
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  
  const boardView = document.getElementById("boardView");
  if (boardView.classList.contains("view-active")) {
    inactivityTimer = setTimeout(() => {
      returnToMenu();
    }, INACTIVITY_TIMEOUT_MS);
  }
}


/* ==========================================================================
   EVENT LISTENERS & INITIALIZATION
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {

  // 1. Clock Engine
  updateJamaicaClock();
  setInterval(updateJamaicaClock, 1000);

  // 2. Action Buttons on Menu (Arrivals / Departures for MBJ, KIN, POT)
  const actionButtons = document.querySelectorAll(".btn-action");
  actionButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const airport = btn.getAttribute("data-airport");
      const type = btn.getAttribute("data-type");
      openFlightBoard(airport, type);
    });
  });

  // 3. Return to Menu Button
  const btnReturn = document.getElementById("btnReturnToMenu");
  if (btnReturn) {
    btnReturn.addEventListener("click", (e) => {
      e.preventDefault();
      returnToMenu();
    });
  }

  // 4. Inactivity listeners (resets 90s timer on user touch / click / scroll)
  ["touchstart", "click", "mousemove", "keydown"].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });

  // 5. Query Parameter Deep Linking (e.g. ?airport=MBJ&type=departures)
  const params = new URLSearchParams(window.location.search);
  const qAirport = params.get("airport")?.toUpperCase();
  const qType = params.get("type")?.toLowerCase();

  if (qAirport && AIRPORT_CONFIG[qAirport] && (qType === "arrivals" || qType === "departures")) {
    openFlightBoard(qAirport, qType);
  }

  // 6. Anti-Tamper Kiosk Protection (Right-click restored for debugging & development)
  document.addEventListener("selectstart", e => e.preventDefault());
  document.addEventListener("dragstart", e => e.preventDefault());
});
