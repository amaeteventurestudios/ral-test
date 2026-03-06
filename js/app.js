/* ═══════════════════════════════════════════════════════════════
   REYDIOUS AUTONOMY LAB — Main Application v2.0
   Governed Multi-Robot Control Dashboard
   Pipeline: Operator → Policy Engine → Safety Envelope → Handshake → Queue → Execution → Telemetry → Audit
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── STATE ──────────────────────────────────────────────────── */
const STATE = {
  loggedIn: false,
  operator: 'operator',
  simMode: true,
  policyMode: 'strict',        // 'strict' | 'training'
  environment: 'indoor',       // 'indoor' | 'outdoor'
  operatorUnlock: false,
  selectedRobots: new Set(),
  activeTeleRobot: 'R-01',
  draftCommand: null,
  lastDecision: null,
  contrastGovernance: true,
  contrastScenario: 'Unsafe Speed',
  contrastReplayTimer: null,
  governanceFeedMode: 'demo',
  governanceEvents: [],
  governanceFeedInterval: null,
  auditLog: [],
  commandQueue: [],            // Command queue array
  robots: {},
  policies: {
    maxSpeed: 80,
    indoorSpeed: 60,
    speedIndoorBlock: true,
    autonomyUnlock: true,
    disconnectedBlock: true,
    lowBattery: true,
  },
  // Dynamic rules added by user
  customRules: [],
  // Safety envelope params
  safety: {
    maxAcceleration: 50,       // cm/s²
    maxTurnRate: 90,           // deg/s
    batteryLowBlock: 5,        // %
    emergencyOverride: false,
  },
};

/* ── DEFAULT GOVERNANCE RULES ────────────────────────────────── */
const DEFAULT_RULES = [
  { id: 'rule-1', name: 'Max Speed Limit', desc: 'Block if speed exceeds threshold', type: 'max_speed', threshold: 80, priority: 10, enabled: true, system: false },
  { id: 'rule-2', name: 'Indoor Mode Max Speed', desc: 'Enforce lower speed when indoors', type: 'max_speed', threshold: 60, priority: 8, enabled: true, system: false, indoorOnly: true },
  { id: 'rule-3', name: 'Speed > 60 in Indoor Mode', desc: 'Block autonomy above 60 cm/s indoors', type: 'max_speed', threshold: 60, priority: 9, enabled: true, system: false, indoorOnly: true, blockStrict: true },
  { id: 'rule-4', name: 'Autonomy Requires Operator Unlock', desc: 'Block autonomy commands without unlock', type: 'unlock', threshold: null, priority: 10, enabled: true, system: false },
  { id: 'rule-5', name: 'Disconnected Robot Block', desc: 'Block all commands to disconnected robots', type: 'connected', threshold: null, priority: 10, enabled: true, system: true },
  { id: 'rule-6', name: 'Low Battery Autonomy Block', desc: 'Block Start Autonomy if battery < 10%', type: 'battery', threshold: 10, priority: 9, enabled: true, system: false },
];

/* ── INITIAL ROBOTS ─────────────────────────────────────────── */
const INITIAL_ROBOTS = {
  'R-01': {
    id: 'R-01', name: 'Alpha',
    connected: true, mode: 'AUTONOMOUS',
    battery: 75, rssi: -52,
    speed: 0, movementState: 'Idle',
    uptime: 9 * 60 + 56,
    lastHeartbeat: Date.now(),
    firmware: 'v2.4.1-esp32',
    ipAddress: '192.168.1.101',
    port: 80,
    connectionType: 'wifi',
    cameraUrl: 'http://192.168.1.101:8080/stream',
    handshakeStatus: 'verified',
    latency: 12,
    capabilities: ['move', 'turn', 'autonomy', 'telemetry'],
    commands: [],
  },
  'R-02': {
    id: 'R-02', name: 'Beta',
    connected: true, mode: 'MANUAL',
    battery: 49, rssi: -68,
    speed: 0, movementState: 'Idle',
    uptime: 22 * 60 + 15,
    lastHeartbeat: Date.now() - 6000,
    firmware: 'v2.3.8-esp32',
    ipAddress: '192.168.1.102',
    port: 80,
    connectionType: 'wifi',
    cameraUrl: '',
    handshakeStatus: 'verified',
    latency: 28,
    capabilities: ['move', 'turn', 'telemetry'],
    commands: [],
  },
  'R-03': {
    id: 'R-03', name: 'Gamma',
    connected: false, mode: 'MANUAL',
    battery: 12, rssi: -90,
    speed: 0, movementState: 'Idle',
    uptime: 2 * 60,
    lastHeartbeat: Date.now() - 2 * 60 * 1000,
    firmware: 'v2.3.5-esp32',
    ipAddress: '192.168.1.103',
    port: 80,
    connectionType: 'sim',
    cameraUrl: '',
    handshakeStatus: 'unverified',
    latency: null,
    capabilities: ['move', 'turn'],
    commands: [],
  },
};

/* ── TELEMETRY HISTORY ───────────────────────────────────────── */
const TELE_HISTORY = {};
Object.keys(INITIAL_ROBOTS).forEach(id => {
  TELE_HISTORY[id] = {
    battery: Array.from({ length: 20 }, (_, i) =>
      Math.round(INITIAL_ROBOTS[id].battery - (i * 0.4) + (Math.random() * 2 - 1))),
    rssi: Array.from({ length: 20 }, (_, i) =>
      Math.round(INITIAL_ROBOTS[id].rssi + (Math.random() * 4 - 2))),
    labels: Array.from({ length: 20 }, (_, i) => {
      const d = new Date(Date.now() - (19 - i) * 30000);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }),
  };
});

/* ── CHART INSTANCES ─────────────────────────────────────────── */
let batteryChartInst = null;
let signalChartInst = null;
let teleUpdateInterval = null;
let heartbeatInterval = null;
let queueInterval = null;

/* ═══════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadPersistedState();
  deepCopyRobots();

  if (STATE.loggedIn) {
    showApp();
  } else {
    showLogin();
  }
  bindLoginForm();
  bindPasswordToggle();
});

function deepCopyRobots() {
  if (Object.keys(STATE.robots).length === 0) {
    Object.keys(INITIAL_ROBOTS).forEach(id => {
      STATE.robots[id] = JSON.parse(JSON.stringify(INITIAL_ROBOTS[id]));
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   PERSISTENCE
═══════════════════════════════════════════════════════════════ */
function loadPersistedState() {
  try {
    const stored = localStorage.getItem('RAL_state');
    if (stored) {
      const s = JSON.parse(stored);
      STATE.loggedIn = s.loggedIn || false;
      STATE.operator = s.operator || 'operator';
      STATE.simMode = s.simMode !== undefined ? s.simMode : true;
      STATE.policyMode = s.policyMode || 'strict';
      STATE.environment = s.environment || 'indoor';
      STATE.policies = { ...STATE.policies, ...(s.policies || {}) };
      STATE.auditLog = s.auditLog || [];
      STATE.commandQueue = (s.commandQueue || []).filter(q => q.status !== 'Executing');
      STATE.customRules = s.customRules || [];
      if (s.safety) STATE.safety = { ...STATE.safety, ...s.safety };
      if (s.robots && Object.keys(s.robots).length > 0) {
        STATE.robots = s.robots;
        Object.keys(s.robots).forEach(id => {
          if (!TELE_HISTORY[id]) {
            const robot = s.robots[id];
            TELE_HISTORY[id] = {
              battery: Array.from({ length: 20 }, () => Math.round(robot.battery + (Math.random() * 4 - 2))),
              rssi: Array.from({ length: 20 }, () => Math.round((robot.rssi || -60) + (Math.random() * 4 - 2))),
              labels: Array.from({ length: 20 }, (_, i) => {
                const d = new Date(Date.now() - (19 - i) * 30000);
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              }),
            };
          }
        });
      }
    }
  } catch (e) {
    console.warn('State load error:', e);
  }
}

function saveState() {
  try {
    const toSave = {
      loggedIn: STATE.loggedIn,
      operator: STATE.operator,
      simMode: STATE.simMode,
      policyMode: STATE.policyMode,
      environment: STATE.environment,
      policies: STATE.policies,
      safety: STATE.safety,
      customRules: STATE.customRules,
      auditLog: STATE.auditLog.slice(-500),
      commandQueue: STATE.commandQueue.slice(-100),
      robots: STATE.robots,
    };
    localStorage.setItem('RAL_state', JSON.stringify(toSave));
  } catch (e) {
    console.warn('State save error:', e);
  }
}

function resetDemo() {
  if (!confirm('Reset all demo data? This will clear logs, restore defaults and reload.')) return;
  localStorage.removeItem('RAL_state');
  location.reload();
}

/* ═══════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════ */
function bindLoginForm() {
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    const err = document.getElementById('loginError');
    if (u === 'operator' && p === 'autonomy') {
      STATE.loggedIn = true;
      STATE.operator = u;
      saveState();
      err.classList.add('hidden');
      showApp();
    } else {
      err.classList.remove('hidden');
    }
  });
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
  closeEventsDrawer();
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  initApp();
}

/* ═══════════════════════════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════════════════════════ */
function initApp() {
  document.getElementById('operatorName').textContent = STATE.operator;
  document.getElementById('simModeToggle').checked = STATE.simMode;
  document.getElementById('operatorUnlockToggle').checked = STATE.operatorUnlock;

  const footerOp = document.getElementById('footerOperator');
  if (footerOp) footerOp.textContent = STATE.operator;

  seedDemoLog();
  renderRobotList();
  renderConsoleTargets();
  updateStatusStrip();
  updateDashboardPulse();
  renderTeleTabs();
  initCharts();
  renderAuditLog();
  renderCommandQueue();
  startSimulation();
  startQueueProcessor();
  startGovernanceEventStream();

  bindNavigation();
  bindHamburgerMenu();
  bindStatusStrip();
  bindContextHelp();
  bindCommandConsole();
  bindManualCommandInput();
  bindPolicyPanel();
  bindModals();
  bindPoliciesPage();
  bindLogsPage();
  bindFleetActions();
  bindChartsToggle();
  bindRobotsPage();
  bindLogResizer();
  bindContrastPage();
  bindGovernanceEventFeed();

  // Clear queue button
  document.getElementById('clearQueueBtn')?.addEventListener('click', () => {
    STATE.commandQueue = STATE.commandQueue.filter(q => q.status === 'Executing');
    renderCommandQueue();
    showToast('Queue cleared', 'info');
  });

  const connectAction = () => {
    showToast('Scanning for robots…', 'info');
    addGovernanceEvent({ severity: 'INFO', category: 'Robot', title: 'Network Scan Initiated', description: 'Searching for registered robots on control network.' });
    closeMobileNav();
    setTimeout(() => {
      STATE.robots['R-01'].connected = true;
      STATE.robots['R-01'].lastHeartbeat = Date.now();
      STATE.robots['R-01'].handshakeStatus = 'verified';
      renderRobotList();
      updateStatusStrip();
      renderRobotsPageList();
      saveState();
      showToast('R-01 connected successfully', 'approved');
      addGovernanceEvent({ severity: 'INFO', category: 'Robot', title: 'R-01 Connected', description: 'Handshake verified and robot available for command dispatch.' });
    }, 1500);
  };

  document.getElementById('connectRobotsBtn').addEventListener('click', connectAction);
  const mobConnect = document.getElementById('connectRobotsMobile');
  if (mobConnect) mobConnect.addEventListener('click', connectAction);

  const logoutAction = () => {
    STATE.loggedIn = false;
    saveState();
    stopSimulation();
    stopGovernanceEventStream();
    closeMobileNav();
    showLogin();
  };
  document.getElementById('logoutBtn').addEventListener('click', logoutAction);
  const mobLogout = document.getElementById('logoutMobile');
  if (mobLogout) mobLogout.addEventListener('click', logoutAction);

  document.getElementById('resetDemoBtn').addEventListener('click', resetDemo);
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════ */
function bindNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });
  document.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
      closeMobileNav();
    });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });

  document.querySelectorAll(`.nav-link[data-page="${page}"], .mobile-nav-link[data-page="${page}"]`)
    .forEach(l => l.classList.add('active'));

  const pageEl = document.getElementById(`page${capitalize(page)}`);
  if (pageEl) { pageEl.classList.remove('hidden'); pageEl.classList.add('active'); }

  if (page === 'logs')     renderFullAuditLog();
  if (page === 'policies') syncPoliciesUI();
  if (page === 'about')    updateAboutPage();
  if (page === 'robots')   renderRobotsPageList();
  if (page === 'protocol') { /* static page, no init needed */ }
  if (page === 'contrast') renderContrastPage();
  if (page === 'dashboard') renderGovernanceEventFeed();

  const main = document.getElementById('mainContent');
  if (main) main.scrollTop = 0;
}

/* ═══════════════════════════════════════════════════════════════
   ABOUT PAGE — live field updater
═══════════════════════════════════════════════════════════════ */
function updateAboutPage() {
  const opEl = document.getElementById('aboutOperator');
  if (opEl) opEl.textContent = STATE.operator;

  const pmEl = document.getElementById('aboutPolicyMode');
  if (pmEl) {
    pmEl.textContent = STATE.policyMode === 'strict' ? 'Strict' : 'Training';
    pmEl.style.color = STATE.policyMode === 'strict' ? 'var(--danger)' : 'var(--accent)';
  }

  const envEl = document.getElementById('aboutEnvironment');
  if (envEl) envEl.textContent = STATE.environment === 'indoor' ? 'Indoor' : 'Outdoor';

  const simDot = document.getElementById('aboutSimDot');
  const simLabel = document.getElementById('aboutSimLabel');
  if (simDot) {
    if (STATE.simMode) {
      simDot.style.background = 'var(--accent)';
      simDot.style.boxShadow = '0 0 4px var(--accent)';
    } else {
      simDot.style.background = 'var(--muted)';
      simDot.style.boxShadow = 'none';
    }
  }
  if (simLabel) simLabel.textContent = STATE.simMode ? 'Active' : 'Disabled';

  const rcEl = document.getElementById('aboutRobotCount');
  if (rcEl) {
    const connected = Object.values(STATE.robots).filter(r => r.connected).length;
    const total = Object.keys(STATE.robots).length;
    rcEl.textContent = `${connected} / ${total}`;
    rcEl.style.color = connected > 0 ? 'var(--success)' : 'var(--danger)';
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ═══════════════════════════════════════════════════════════════
   HAMBURGER MENU
═══════════════════════════════════════════════════════════════ */
function bindHamburgerMenu() {
  const btn = document.getElementById('hamburgerBtn');
  const drawer = document.getElementById('mobileNavDrawer');
  const overlay = document.getElementById('mobileNavOverlay');
  if (!btn || !drawer) return;

  btn.addEventListener('click', () => {
    const isOpen = drawer.classList.contains('open');
    if (isOpen) { closeMobileNav(); } else { openMobileNav(); }
  });
  overlay.addEventListener('click', closeMobileNav);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileNav();
  });
}

function openMobileNav() {
  const btn = document.getElementById('hamburgerBtn');
  const drawer = document.getElementById('mobileNavDrawer');
  const overlay = document.getElementById('mobileNavOverlay');
  if (!drawer) return;
  drawer.classList.add('open');
  overlay.classList.add('open');
  if (btn) {
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const icon = document.getElementById('hamburgerIcon');
    if (icon) { icon.classList.remove('fa-bars'); icon.classList.add('fa-xmark'); }
  }
}

function closeMobileNav() {
  const btn = document.getElementById('hamburgerBtn');
  const drawer = document.getElementById('mobileNavDrawer');
  const overlay = document.getElementById('mobileNavOverlay');
  if (!drawer) return;
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  if (btn) {
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    const icon = document.getElementById('hamburgerIcon');
    if (icon) { icon.classList.remove('fa-xmark'); icon.classList.add('fa-bars'); }
  }
}

/* ═══════════════════════════════════════════════════════════════
   STATUS STRIP
═══════════════════════════════════════════════════════════════ */
function updateStatusStrip() {
  const connected = Object.values(STATE.robots).filter(r => r.connected).length;
  const total = Object.keys(STATE.robots).length;
  document.getElementById('connectedRobotsCount').textContent = `${connected} / ${total}`;
  document.getElementById('operatorName').textContent = STATE.operator;

  const simBadge = document.getElementById('simModeIndicator');
  simBadge.textContent = STATE.simMode ? 'ON' : 'OFF';

  const simLabels = document.querySelectorAll('.sim-badge');
  simLabels.forEach(el => {
    if (STATE.simMode) el.classList.remove('hidden'); else el.classList.add('hidden');
  });

  updateDashboardPulse();
}

function updateDashboardPulse() {
  const robots = Object.values(STATE.robots);
  if (!robots.length) return;

  const connected = robots.filter(r => r.connected).length;
  const avgBattery = Math.round(robots.reduce((sum, r) => sum + (r.battery || 0), 0) / robots.length);
  const healthScore = Math.max(0, Math.min(100, Math.round((connected / robots.length) * 65 + avgBattery * 0.35)));

  const hourAgo = Date.now() - 60 * 60 * 1000;
  const blockedRecent = STATE.auditLog.filter(log => {
    const t = log.timestamp || new Date(log.time || Date.now()).getTime();
    return t >= hourAgo && (log.validation === 'BLOCKED' || log.validation === 'WOULD_BLOCK');
  }).length;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('pulseFleetHealth', `${healthScore}%`);
  setText('pulseFleetHealthHint', `${connected}/${robots.length} connected · avg battery ${avgBattery}%`);
  setText('pulseConnected', `${connected} / ${robots.length}`);
  setText('pulseAvgBattery', `${avgBattery}%`);
  setText('pulseQueueDepth', `${STATE.commandQueue.length}`);
  setText('pulseBlockedHour', `${blockedRecent}`);
}


function bindContextHelp() {
  if (bindContextHelp._bound) return;
  bindContextHelp._bound = true;
  const triggers = Array.from(document.querySelectorAll('.context-help-btn[data-help-text]'));
  if (!triggers.length) return;

  let popover = document.getElementById('contextHelpPopover');
  if (!popover) {
    popover = document.createElement('div');
    popover.id = 'contextHelpPopover';
    popover.className = 'context-help-popover';
    popover.innerHTML = '<div class="context-help-title" id="contextHelpTitle"></div><div class="context-help-body" id="contextHelpBody"></div>';
    document.body.appendChild(popover);
  }

  let activeTrigger = null;
  const placePopover = trigger => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    const estimatedHeight = 84;
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - estimatedHeight - 8);
    }
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const closeHelp = () => {
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeTrigger = null;
  };

  const openHelp = trigger => {
    if (activeTrigger === trigger && popover.classList.contains('open')) {
      closeHelp();
      return;
    }
    activeTrigger = trigger;
    document.getElementById('contextHelpTitle').textContent = trigger.dataset.helpTitle || 'Info';
    document.getElementById('contextHelpBody').textContent = trigger.dataset.helpText || '';
    placePopover(trigger);
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
  };

  triggers.forEach(trigger => {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    trigger.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openHelp(trigger);
    });

    trigger.addEventListener('mouseenter', () => {
      if (window.matchMedia('(hover: hover)').matches) openHelp(trigger);
    });

    trigger.addEventListener('mouseleave', () => {
      if (!window.matchMedia('(hover: hover)').matches) return;
      setTimeout(() => {
        if (!trigger.matches(':hover') && !popover.matches(':hover')) closeHelp();
      }, 110);
    });
  });

  popover.addEventListener('mouseleave', () => {
    if (window.matchMedia('(hover: hover)').matches) closeHelp();
  });

  document.addEventListener('click', e => {
    if (!popover.classList.contains('open')) return;
    if (popover.contains(e.target) || (activeTrigger && activeTrigger.contains(e.target))) return;
    closeHelp();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeHelp();
  });

  window.addEventListener('resize', () => {
    if (activeTrigger && popover.classList.contains('open')) placePopover(activeTrigger);
  });
  document.getElementById('mainContent')?.addEventListener('scroll', closeHelp, { passive: true });
}

function bindStatusStrip() {
  document.getElementById('simModeToggle').addEventListener('change', e => {
    STATE.simMode = e.target.checked;
    updateStatusStrip();
    saveState();
    showToast(`Simulation Mode ${STATE.simMode ? 'enabled' : 'disabled'}`, 'info');
    addGovernanceEvent({ severity: 'INFO', category: 'System', title: `Simulation Mode ${STATE.simMode ? 'Enabled' : 'Disabled'}`, description: 'Operator toggled simulation state from status strip.' });
  });
}

/* ═══════════════════════════════════════════════════════════════
   ROBOT FLEET
═══════════════════════════════════════════════════════════════ */
function renderRobotList() {
  const list = document.getElementById('robotList');
  list.innerHTML = '';
  Object.values(STATE.robots).forEach(robot => {
    const card = createRobotCard(robot);
    list.appendChild(card);
  });
  updateConsoleButtonStates();
  updateDashboardPulse();
}

function createRobotCard(robot) {
  const card = document.createElement('div');
  card.className = `robot-card${robot.connected ? '' : ' disconnected'}${STATE.selectedRobots.has(robot.id) ? ' selected' : ''}`;
  card.dataset.robotId = robot.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${robot.id}: ${robot.connected ? 'Connected' : 'Disconnected'}, Battery ${Math.round(robot.battery)}%`);

  const battPct = Math.max(0, Math.min(100, Math.round(robot.battery)));
  const battClass = battPct < 20 ? 'low' : battPct < 40 ? 'med' : '';
  const hbAgo = formatTimeAgo(robot.lastHeartbeat);
  const rssiStr = robot.connected ? `${robot.rssi} dBm` : '—';
  const hsIcon = robot.handshakeStatus === 'verified'
    ? '<i class="fas fa-handshake" style="color:var(--success);font-size:9px;" title="Handshake verified"></i>'
    : '<i class="fas fa-handshake-slash" style="color:var(--muted);font-size:9px;" title="No handshake"></i>';
  const latencyStr = robot.latency ? `${robot.latency}ms` : '—';

  card.innerHTML = `
    <div class="robot-card-header">
      <input type="checkbox" class="robot-select-check" aria-label="Select ${robot.id}"
        ${STATE.selectedRobots.has(robot.id) ? 'checked' : ''} />
      <span class="robot-id">${robot.id}</span>
      <span class="robot-mode-badge badge-${robot.mode.toLowerCase()}">${robot.mode}</span>
      <span style="margin-left:auto;font-size:9px;">${hsIcon}</span>
    </div>
    <div class="robot-status-row">
      <span class="conn-dot ${robot.connected ? 'connected' : 'disconnected'}"></span>
      <span class="conn-label ${robot.connected ? 'connected' : 'disconnected'}">${robot.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
      ${robot.latency ? `<span class="robot-latency">${latencyStr}</span>` : ''}
    </div>
    <div class="robot-metrics-row">
      <div class="robot-metric">
        <i class="fas fa-battery-half"></i>
        <div class="battery-bar-wrap"><div class="battery-bar ${battClass}" style="width:${battPct}%"></div></div>
        <span class="val">${battPct}%</span>
      </div>
      <div class="robot-metric">
        <i class="fas fa-signal"></i>
        <span class="val">${rssiStr}</span>
      </div>
      <div class="robot-metric" style="margin-left:auto;">
        <i class="fas fa-gauge" style="color:var(--muted)"></i>
        <span class="val">${robot.speed} cm/s</span>
      </div>
    </div>
    <div class="heartbeat-row">
      <span class="heartbeat-label"><i class="fas fa-heart" style="color:var(--danger);font-size:9px;"></i> ${robot.movementState}</span>
      <span class="heartbeat-label" style="margin-left:auto;">Last HB:</span>
      <span class="heartbeat-value">${hbAgo}</span>
    </div>
    <i class="fas fa-chevron-right robot-card-chevron"></i>
  `;

  const checkbox = card.querySelector('.robot-select-check');
  checkbox.addEventListener('change', e => {
    e.stopPropagation();
    toggleRobotSelect(robot.id, e.target.checked);
  });

  card.addEventListener('click', e => {
    if (e.target.classList.contains('robot-select-check')) return;
    openRobotDrawer(robot.id);
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openRobotDrawer(robot.id);
    }
  });

  return card;
}

function toggleRobotSelect(id, selected) {
  if (selected) {
    STATE.selectedRobots.add(id);
  } else {
    STATE.selectedRobots.delete(id);
  }
  renderRobotList();
  renderConsoleTargets();
  updateDraftDisplay();
  updateSendButton();
  updateConsoleButtonStates();
  updateControlSelectedButton();
}

function updateControlSelectedButton() {
  const btn = document.getElementById('controlSelectedBtn');
  btn.disabled = STATE.selectedRobots.size === 0;
}

function bindFleetActions() {
  document.getElementById('controlSelectedBtn').addEventListener('click', () => {
    if (STATE.selectedRobots.size > 0) {
      showToast(`Controlling: ${[...STATE.selectedRobots].join(', ')}`, 'info');
    }
  });
  document.getElementById('pairRobotBtn').addEventListener('click', () => {
    showToast('Scanning for new robots on network…', 'info');
    navigateTo('robots');
  });
}

/* ═══════════════════════════════════════════════════════════════
   CHARTS TOGGLE (mobile collapsible)
═══════════════════════════════════════════════════════════════ */
function bindChartsToggle() {
  const btn = document.getElementById('chartsToggleBtn');
  const charts = document.getElementById('teleCharts');
  if (!btn || !charts) return;

  if (window.innerWidth < 768) {
    charts.classList.add('collapsed');
    btn.classList.add('collapsed');
  }

  btn.addEventListener('click', () => {
    const collapsed = charts.classList.contains('collapsed');
    charts.classList.toggle('collapsed', !collapsed);
    btn.classList.toggle('collapsed', !collapsed);
    if (collapsed) {
      setTimeout(() => {
        if (batteryChartInst) batteryChartInst.resize();
        if (signalChartInst) signalChartInst.resize();
      }, 50);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      charts.classList.remove('collapsed');
      btn.classList.remove('collapsed');
    }
    // Re-render queue inline badge on resize
    renderCommandQueue();
  }, { passive: true });
}

/* ═══════════════════════════════════════════════════════════════
   COMMAND CONSOLE
═══════════════════════════════════════════════════════════════ */
function renderConsoleTargets() {
  const chipsEl = document.getElementById('consoleTargetChips');
  chipsEl.innerHTML = '';
  if (STATE.selectedRobots.size === 0) {
    chipsEl.innerHTML = '<span style="font-size:11px;color:var(--muted);">No robots selected</span>';
    return;
  }
  STATE.selectedRobots.forEach(id => {
    const chip = document.createElement('div');
    chip.className = 'target-chip';
    const dot = `<span style="width:5px;height:5px;border-radius:50%;background:${STATE.robots[id]?.connected ? 'var(--success)' : 'var(--danger)'}"></span>`;
    chip.innerHTML = `${dot} ${id} <span class="chip-remove" data-id="${id}">✕</span>`;
    chip.querySelector('.chip-remove').addEventListener('click', () => toggleRobotSelect(id, false));
    chipsEl.appendChild(chip);
  });
}

function bindCommandConsole() {
  document.querySelectorAll('.cmd-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'ESTOP') {
        handleEStop();
        return;
      }
      selectDraftCommand(cmd);
    });
  });

  const speedSlider = document.getElementById('speedSlider');
  const speedInput = document.getElementById('speedInput');
  speedSlider.addEventListener('input', () => {
    speedInput.value = speedSlider.value;
    updateDraftDisplay();
  });
  speedInput.addEventListener('input', () => {
    const v = Math.max(5, Math.min(120, parseInt(speedInput.value) || 60));
    speedInput.value = v;
    speedSlider.value = v;
    updateDraftDisplay();
  });

  document.getElementById('sendForValidationBtn').addEventListener('click', sendForValidation);

  document.getElementById('operatorUnlockToggle').addEventListener('change', e => {
    STATE.operatorUnlock = e.target.checked;
    const iconEl = document.getElementById('unlockIcon');
    iconEl.innerHTML = STATE.operatorUnlock
      ? '<i class="fas fa-lock-open" style="color:var(--success)"></i>'
      : '<i class="fas fa-lock"></i>';
    if (STATE.operatorUnlock) {
      addAuditLogEntry({
        command: 'OPERATOR_UNLOCK',
        robots: [...STATE.selectedRobots].join(',') || 'SYSTEM',
        validation: 'APPROVED',
        execution: 'EXECUTED',
        rule: '—',
        notes: 'Operator Unlock toggled ON',
      });
      showToast('Operator Unlock enabled', 'approved');
    }
    saveState();
  });
}

function selectDraftCommand(cmd) {
  STATE.draftCommand = cmd;
  document.querySelectorAll('.cmd-btn[data-cmd]').forEach(b => b.classList.remove('active-cmd'));
  const btn = document.querySelector(`.cmd-btn[data-cmd="${cmd}"]`);
  if (btn) btn.classList.add('active-cmd');
  updateDraftDisplay();
  updateSendButton();
  hideBanner();
}

function updateDraftDisplay() {
  const nameEl = document.getElementById('draftCmdName');
  const paramEl = document.getElementById('draftCmdParam');
  const targetsEl = document.getElementById('draftTargets');

  if (!STATE.draftCommand) {
    nameEl.textContent = '—';
    paramEl.textContent = '';
    targetsEl.innerHTML = '';
    return;
  }

  nameEl.textContent = STATE.draftCommand;
  const speed = parseInt(document.getElementById('speedSlider').value);
  const isMove = ['MOVE_FORWARD', 'MOVE_BACK'].includes(STATE.draftCommand);
  paramEl.textContent = isMove ? `@ ${speed} cm/s` : '';

  targetsEl.innerHTML = '';
  STATE.selectedRobots.forEach(id => {
    const chip = document.createElement('div');
    chip.className = 'draft-target-chip';
    chip.innerHTML = `${id}`;
    targetsEl.appendChild(chip);
  });
}

function updateSendButton() {
  const btn = document.getElementById('sendForValidationBtn');
  btn.disabled = !STATE.draftCommand || STATE.selectedRobots.size === 0;
}

function updateConsoleButtonStates() {
  const anyConnected = [...STATE.selectedRobots].some(id => STATE.robots[id]?.connected);
  const hasSelection = STATE.selectedRobots.size > 0;
  document.querySelectorAll('.cmd-btn[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd === 'ESTOP') return;
    btn.disabled = !hasSelection || (!anyConnected && cmd !== 'ESTOP');
  });
}

/* ── E-STOP ── */
function handleEStop() {
  const targets = STATE.selectedRobots.size > 0
    ? [...STATE.selectedRobots]
    : Object.keys(STATE.robots);

  targets.forEach(id => {
    const robot = STATE.robots[id];
    if (robot) {
      robot.speed = 0;
      robot.movementState = 'Idle';
    }
  });

  // Also clear any executing queue items for these robots
  STATE.commandQueue.forEach(item => {
    if (targets.some(id => item.targets.includes(id)) && item.status === 'Executing') {
      item.status = 'Rejected';
    }
  });

  const requestId = generateId();
  addAuditLogEntry({
    requestId,
    command: 'E-STOP',
    robots: targets.join(', '),
    validation: 'APPROVED',
    execution: 'EXECUTED',
    rule: 'EMERGENCY',
    notes: 'Emergency stop — always permitted',
    safetyCheck: 'PASSED',
    handshakeVerified: true,
    dispatchStatus: 'SENT',
    ackState: 'completed',
    ackTimestamp: Date.now(),
  });

  showBanner('approved', '<i class="fas fa-check-circle"></i>', 'E-Stop Executed — All targets halted');
  showToast(`E-Stop: ${targets.join(', ')} halted`, 'warning');
  renderRobotList();
  updateTelemetryDisplay();
  renderCommandQueue();
  saveState();
}

/* ── SEND FOR VALIDATION ── */
async function sendForValidation() {
  if (!STATE.draftCommand || STATE.selectedRobots.size === 0) return;

  const cmd = STATE.draftCommand;
  const targets = [...STATE.selectedRobots];
  const speed = parseInt(document.getElementById('speedSlider').value);
  const requestId = generateId();
  const policyDecisionId = generateId();

  showBanner('pending', '<i class="fas fa-spinner fa-spin"></i>', 'Pending Validation…');
  updateLastDecision('PENDING', '');

  const btn = document.getElementById('sendForValidationBtn');
  btn.disabled = true;

  await delay(500);

  // ── STEP 1: Policy Engine ──
  const decisions = {};
  let allApproved = true;

  targets.forEach(id => {
    const robot = STATE.robots[id];
    const decision = runPolicyEngine(robot, cmd, speed);
    decisions[id] = decision;
    if (decision.status !== 'APPROVED') allApproved = false;
  });

  const combinedRulesApplied = [];
  const blockReasons = [];
  targets.forEach(id => {
    decisions[id].rulesApplied.forEach(r => {
      if (!combinedRulesApplied.find(x => x.id === r.id)) combinedRulesApplied.push(r);
    });
    if (decisions[id].status === 'BLOCKED') blockReasons.push(`${id}: ${decisions[id].reason}`);
  });

  let policyStatus = allApproved ? 'APPROVED'
    : STATE.policyMode === 'training' ? 'WOULD_BLOCK' : 'BLOCKED';

  STATE.lastDecision = {
    requestId, policyDecisionId,
    status: policyStatus,
    command: cmd, speed, targets,
    rulesApplied: combinedRulesApplied,
    reasons: blockReasons,
    decisions,
    timestamp: new Date().toISOString(),
    mode: STATE.policyMode,
  };

  updatePolicyPanel(STATE.lastDecision);
  updateLastDecision(policyStatus, new Date().toLocaleTimeString());

  if (policyStatus === 'BLOCKED') {
    showBanner('blocked', '<i class="fas fa-ban"></i>', `Blocked — ${blockReasons[0] || 'Policy violation'}`);
    addGovernanceEvent({ severity: 'WARNING', category: 'Governance', title: 'Policy Block', description: blockReasons[0] || 'Policy validation blocked command.' });
    showToast(`Command blocked: ${blockReasons[0] || 'Policy violation'}`, 'blocked');
    addAuditLogEntry({
      requestId, policyDecisionId,
      command: cmd, robots: targets.join(', '),
      validation: 'BLOCKED', execution: 'NOT EXECUTED',
      rule: combinedRulesApplied.filter(r => r.type === 'block').map(r => r.id).join(', ') || '—',
      notes: blockReasons.join('; '),
      speed, mode: STATE.policyMode, environment: STATE.environment,
      safetyCheck: 'SKIPPED',
      handshakeVerified: null, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed',
    });
    saveState(); renderAuditLog(); renderFullAuditLog();
    btn.disabled = false;
    return;
  }

  // ── STEP 2: Safety Envelope ──
  showBanner('pending', '<i class="fas fa-lock fa-spin"></i>', 'Safety Envelope check…');
  await delay(400);

  const safetyResult = runSafetyEnvelope(targets, cmd, speed);
  let safetyStatus = safetyResult.passed ? 'PASSED' : (STATE.policyMode === 'training' ? 'WARN' : 'BLOCKED');

  if (!safetyResult.passed && STATE.policyMode === 'strict') {
    showBanner('blocked', '<i class="fas fa-ban"></i>', `Safety Envelope blocked — ${safetyResult.reason}`);
    addGovernanceEvent({ severity: 'CRITICAL', category: 'Safety', title: 'Safety Envelope Block', description: safetyResult.reason });
    showToast(`Safety block: ${safetyResult.reason}`, 'blocked');
    addAuditLogEntry({
      requestId, policyDecisionId,
      command: cmd, robots: targets.join(', '),
      validation: policyStatus, execution: 'NOT EXECUTED',
      rule: 'SAFETY-ENV',
      notes: safetyResult.reason,
      speed, mode: STATE.policyMode, environment: STATE.environment,
      safetyCheck: 'BLOCKED',
      handshakeVerified: null, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed',
    });
    saveState(); renderAuditLog(); renderFullAuditLog();
    btn.disabled = false;
    return;
  }

  // ── STEP 3: Handshake check ──
  showBanner('pending', '<i class="fas fa-handshake fa-spin"></i>', 'Handshake verification…');
  await delay(400);

  const hsResult = targets.every(id => {
    const robot = STATE.robots[id];
    return robot && (robot.handshakeStatus === 'verified' || !robot.connected);
  });

  if (!hsResult) {
    const failedRobots = targets.filter(id => STATE.robots[id]?.handshakeStatus !== 'verified').join(', ');
    showBanner('blocked', '<i class="fas fa-handshake-slash"></i>', `Handshake not verified — ${failedRobots}`);
    addGovernanceEvent({ severity: 'WARNING', category: 'Robot', title: 'Handshake Verification Failed', description: `Unverified robots: ${failedRobots}` });
    showToast(`Handshake failed for: ${failedRobots}`, 'blocked');
    addAuditLogEntry({
      requestId, policyDecisionId,
      command: cmd, robots: targets.join(', '),
      validation: policyStatus, execution: 'NOT EXECUTED',
      rule: 'HANDSHAKE',
      notes: `Handshake not verified for ${failedRobots}`,
      speed, mode: STATE.policyMode, environment: STATE.environment,
      safetyCheck: safetyStatus,
      handshakeVerified: false, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed',
    });
    saveState(); renderAuditLog(); renderFullAuditLog();
    btn.disabled = false;
    return;
  }

  // ── STEP 4: Enqueue ──
  showBanner('approved', '<i class="fas fa-layer-group"></i>', 'Enqueuing command…');
  const queueItem = enqueueCommand({
    requestId, policyDecisionId,
    command: cmd, targets, speed,
    policyStatus, safetyStatus,
    rules: combinedRulesApplied,
    overrideStatus: policyStatus === 'WOULD_BLOCK' ? 'WOULD_BLOCK' : null,
  });

  await delay(300);
  renderCommandQueue();
  showBanner('executing', '<i class="fas fa-cog fa-spin"></i>', `Queued [${queueItem.queueId.slice(0,6)}] — awaiting execution…`);

  btn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════════
   SAFETY ENVELOPE
═══════════════════════════════════════════════════════════════ */
function runSafetyEnvelope(targetIds, cmd, speed) {
  if (STATE.safety.emergencyOverride) {
    return { passed: true, reason: 'Emergency override active' };
  }

  // Battery safety
  const lowBatteryRobots = targetIds.filter(id => {
    const robot = STATE.robots[id];
    return robot && robot.connected && robot.battery < STATE.safety.batteryLowBlock;
  });
  if (lowBatteryRobots.length > 0) {
    return { passed: false, reason: `Battery critically low on ${lowBatteryRobots.join(', ')} (<${STATE.safety.batteryLowBlock}%)` };
  }

  // Speed safety
  const isMove = ['MOVE_FORWARD', 'MOVE_BACK'].includes(cmd);
  if (isMove && speed > STATE.safety.maxAcceleration * 2) {
    return { passed: false, reason: `Speed ${speed} cm/s may exceed safe acceleration limits` };
  }

  return { passed: true, reason: '' };
}

/* ═══════════════════════════════════════════════════════════════
   HANDSHAKE SIMULATION
═══════════════════════════════════════════════════════════════ */
function simulateHandshake(robot) {
  return new Promise(resolve => {
    setTimeout(() => {
      if (robot.connectionType === 'sim' || !robot.connected) {
        resolve({
          success: robot.connected,
          id: robot.id,
          firmware: robot.firmware,
          capabilities: robot.capabilities || [],
          status: robot.connected ? 'ready' : 'offline',
          latency: robot.connected ? Math.round(Math.random() * 30 + 5) : null,
        });
      } else {
        // Real connection attempt would go here
        resolve({
          success: robot.connected,
          id: robot.id,
          firmware: robot.firmware,
          capabilities: robot.capabilities || [],
          status: robot.connected ? 'ready' : 'offline',
          latency: robot.connected ? Math.round(Math.random() * 50 + 10) : null,
        });
      }
    }, 600 + Math.random() * 400);
  });
}

/* ═══════════════════════════════════════════════════════════════
   COMMAND QUEUE
═══════════════════════════════════════════════════════════════ */
function enqueueCommand(params) {
  const queueItem = {
    queueId: generateId(),
    requestId: params.requestId,
    policyDecisionId: params.policyDecisionId,
    command: params.command,
    targets: params.targets,
    speed: params.speed,
    policyStatus: params.policyStatus,
    safetyStatus: params.safetyStatus,
    rules: params.rules,
    overrideStatus: params.overrideStatus || null,
    status: 'Queued',
    queuedAt: Date.now(),
    executedAt: null,
    completedAt: null,
  };
  STATE.commandQueue.unshift(queueItem);
  if (STATE.commandQueue.length > 50) STATE.commandQueue = STATE.commandQueue.slice(0, 50);
  return queueItem;
}

function startQueueProcessor() {
  if (queueInterval) clearInterval(queueInterval);
  queueInterval = setInterval(() => {
    const pending = STATE.commandQueue.find(q => q.status === 'Queued');
    if (!pending) return;

    pending.status = 'Executing';
    pending.executedAt = Date.now();
    renderCommandQueue();
    updatePipelineState('execute');

    setTimeout(() => {
      if (pending.status !== 'Executing') return; // E-stop may have cancelled
      executeQueuedCommand(pending);
      pending.status = 'Completed';
      pending.completedAt = Date.now();
      renderCommandQueue();
      updatePipelineState('done');
    }, 800);
  }, 1200);
}

function executeQueuedCommand(item) {
  const cmd = item.command;
  const targets = item.targets;
  const speed = item.speed;
  const overrideStatus = item.overrideStatus;
  const executionStatus = overrideStatus ? overrideStatus : 'EXECUTED';

  targets.forEach(id => {
    const robot = STATE.robots[id];
    if (!robot) return;
    switch (cmd) {
      case 'MOVE_FORWARD': robot.speed = speed; robot.movementState = 'Moving'; break;
      case 'MOVE_BACK':    robot.speed = speed; robot.movementState = 'Moving'; break;
      case 'TURN_LEFT':
      case 'TURN_RIGHT':   robot.movementState = 'Turning'; robot.speed = Math.min(speed, 30); break;
      case 'STOP':         robot.speed = 0; robot.movementState = 'Idle'; break;
      case 'START_AUTONOMY':   robot.mode = 'AUTONOMOUS'; robot.movementState = 'Moving'; break;
      case 'PAUSE_AUTONOMY':   robot.movementState = 'Idle'; break;
      case 'DISABLE_AUTONOMY': robot.mode = 'MANUAL'; robot.movementState = 'Idle'; robot.speed = 0; break;
    }
    robot.commands.unshift({ time: new Date().toLocaleTimeString(), cmd, speed });
    if (robot.commands.length > 10) robot.commands.pop();
  });

  // Build endpoint string for audit log
  const robotEndpoint = targets.map(id => {
    const r = STATE.robots[id];
    if (!r) return '—';
    const base = STATE.simMode ? '[sim]' : `http://${r.ipAddress}:${r.port || 80}`;
    return `${base}/command`;
  }).join(', ');

  // Audit entry with extended protocol fields
  const auditEntry = addAuditLogEntry({
    requestId: item.requestId, policyDecisionId: item.policyDecisionId,
    commandId: item.queueId,
    command: cmd, robots: targets.join(', '),
    validation: overrideStatus === 'WOULD_BLOCK' ? 'WOULD_BLOCK' : 'APPROVED',
    execution: executionStatus === 'WOULD_BLOCK' ? 'EXECUTED' : executionStatus,
    rule: item.rules.map(r => r.id).filter(Boolean).join(', ') || '—',
    notes: overrideStatus === 'WOULD_BLOCK' ? 'Training mode: would have blocked' : 'Command executed successfully',
    speed, mode: STATE.policyMode, environment: STATE.environment,
    safetyCheck: item.safetyStatus,
    handshakeVerified: targets.every(id => STATE.robots[id]?.handshakeStatus === 'verified'),
    dispatchStatus: 'SENT',
    ackState: 'received',
    ackTimestamp: Date.now(),
    robotEndpoint,
  });

  // Simulate ack state progression: received → executing → completed
  setTimeout(() => {
    auditEntry.ackState = 'executing';
    renderAuditLog(); renderFullAuditLog();
    setTimeout(() => {
      auditEntry.ackState = 'completed';
      renderAuditLog(); renderFullAuditLog();
    }, 600 + Math.random() * 400);
  }, 200 + Math.random() * 300);

  showBanner('approved', '<i class="fas fa-circle-check"></i>', 'Command Executed Successfully');
  addGovernanceEvent({ severity: 'INFO', category: 'Governance', title: 'Command Executed', description: `${cmd} completed on ${targets.join(', ')}` });
  showToast(`${cmd} → ${targets.join(', ')} executed`, 'approved');

  renderRobotList();
  updateTelemetryDisplay();
  saveState();
  renderAuditLog();
  renderFullAuditLog();
}

function renderCommandQueue() {
  const list = document.getElementById('queueList');
  if (!list) return;

  const pending   = STATE.commandQueue.filter(q => q.status === 'Queued').length;
  const executing = STATE.commandQueue.filter(q => q.status === 'Executing').length;
  const el1 = document.getElementById('queuePendingCount');
  const el2 = document.getElementById('queueExecCount');
  if (el1) el1.textContent = pending;
  if (el2) el2.textContent = executing;

  // On desktop the list is hidden (max-height:0), but we still populate it
  // so tablet/mobile can see it, and desktop shows an inline badge in the header.
  const recent = STATE.commandQueue.slice(0, 15);
  const isDesktop = window.innerWidth >= 1024;

  // ── Desktop inline active command badge ──
  let inlineBadge = document.getElementById('queueInlineBadge');
  if (!inlineBadge) {
    inlineBadge = document.createElement('div');
    inlineBadge.id = 'queueInlineBadge';
    inlineBadge.className = 'queue-inline-badge';
    const headerLeft = document.querySelector('.queue-header-left');
    if (headerLeft) headerLeft.after(inlineBadge);
  }

  if (isDesktop) {
    const active = STATE.commandQueue.find(q => q.status === 'Executing' || q.status === 'Queued');
    if (active) {
      const statusColor = active.status === 'Executing' ? 'var(--accent)' : 'var(--muted)';
      inlineBadge.innerHTML = `
        <span class="qib-cmd" style="color:${statusColor}">${active.command}</span>
        <span class="qib-arrow">→</span>
        <span class="qib-targets">${active.targets.join(', ')}</span>
        <span class="qib-status" style="color:${statusColor}">${active.status}</span>
      `;
      inlineBadge.style.display = 'flex';
    } else if (recent.length > 0) {
      const last = recent[0];
      inlineBadge.innerHTML = `
        <span class="qib-cmd" style="color:var(--success)">${last.command}</span>
        <span class="qib-arrow">→</span>
        <span class="qib-targets">${last.targets.join(', ')}</span>
        <span class="qib-status" style="color:var(--muted)">${last.status}</span>
      `;
      inlineBadge.style.display = 'flex';
    } else {
      inlineBadge.innerHTML = `<span style="color:var(--muted);font-size:11px;font-style:italic;">No commands queued</span>`;
      inlineBadge.style.display = 'flex';
    }
  } else {
    inlineBadge.style.display = 'none';
  }

  // ── List (visible on tablet/mobile) ──
  if (recent.length === 0) {
    list.innerHTML = '<div class="queue-empty"><i class="fas fa-inbox"></i><span>No commands queued</span></div>';
    updateDashboardPulse();
    return;
  }

  list.innerHTML = '';
  recent.forEach(item => {
    const el = document.createElement('div');
    const statusClass = {
      'Queued': 'q-queued', 'Executing': 'q-executing',
      'Completed': 'q-completed', 'Rejected': 'q-rejected',
    }[item.status] || 'q-queued';

    const timeStr = item.executedAt
      ? formatTimeAgo(item.executedAt)
      : formatTimeAgo(item.queuedAt);

    el.className = `queue-item ${statusClass}`;
    el.innerHTML = `
      <div class="qi-left">
        <span class="qi-cmd">${item.command}</span>
        <span class="qi-targets">${item.targets.join(', ')}</span>
      </div>
      <div class="qi-right">
        <span class="qi-status">${item.status}</span>
        <span class="qi-time">${timeStr}</span>
      </div>
    `;
    list.appendChild(el);
  });
  updateDashboardPulse();
}

function updatePipelineState(step) {
  document.querySelectorAll('.pipeline-step').forEach(el => el.classList.remove('active', 'done'));
  const steps = ['operator', 'policy', 'safety', 'handshake', 'execute'];
  const idx = steps.indexOf(step);
  steps.forEach((s, i) => {
    const el = document.querySelector(`.pipeline-step[data-step="${s}"]`);
    if (!el) return;
    if (i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
}

/* ═══════════════════════════════════════════════════════════════
   EXECUTE COMMAND (legacy direct — now used for E-Stop only)
═══════════════════════════════════════════════════════════════ */
function executeCommand(cmd, targets, speed, reqId, polId, rules, overrideStatus) {
  const executionStatus = overrideStatus || 'EXECUTED';
  targets.forEach(id => {
    const robot = STATE.robots[id];
    if (!robot) return;
    switch (cmd) {
      case 'MOVE_FORWARD': robot.speed = speed; robot.movementState = 'Moving'; break;
      case 'MOVE_BACK':    robot.speed = speed; robot.movementState = 'Moving'; break;
      case 'TURN_LEFT':
      case 'TURN_RIGHT':   robot.movementState = 'Turning'; robot.speed = Math.min(speed, 30); break;
      case 'STOP':         robot.speed = 0; robot.movementState = 'Idle'; break;
      case 'START_AUTONOMY':   robot.mode = 'AUTONOMOUS'; robot.movementState = 'Moving'; break;
      case 'PAUSE_AUTONOMY':   robot.movementState = 'Idle'; break;
      case 'DISABLE_AUTONOMY': robot.mode = 'MANUAL'; robot.movementState = 'Idle'; robot.speed = 0; break;
    }
    robot.commands.unshift({ time: new Date().toLocaleTimeString(), cmd, speed });
    if (robot.commands.length > 10) robot.commands.pop();
  });

  addAuditLogEntry({
    requestId: reqId, policyDecisionId: polId,
    command: cmd, robots: targets.join(', '),
    validation: overrideStatus === 'WOULD_BLOCK' ? 'WOULD_BLOCK' : 'APPROVED',
    execution: executionStatus,
    rule: rules.map(r => r.id).filter(Boolean).join(', ') || '—',
    notes: overrideStatus === 'WOULD_BLOCK' ? 'Training mode: would have blocked' : 'Command executed successfully',
    speed, mode: STATE.policyMode, environment: STATE.environment,
  });

  showBanner('approved', '<i class="fas fa-circle-check"></i>', 'Command Executed Successfully');
  addGovernanceEvent({ severity: 'INFO', category: 'Governance', title: 'Command Executed', description: `${cmd} completed on ${targets.join(', ')}` });
  showToast(`${cmd} → ${targets.join(', ')} executed`, 'approved');

  renderRobotList();
  updateTelemetryDisplay();
  saveState();
  renderAuditLog();
  renderFullAuditLog();
}

/* ═══════════════════════════════════════════════════════════════
   POLICY ENGINE (Dynamic Rules)
═══════════════════════════════════════════════════════════════ */
function getAllRules() {
  // Merge default rules with custom rules, sorted by priority desc
  const base = DEFAULT_RULES.map(r => ({
    ...r,
    threshold: r.id === 'rule-1' ? STATE.policies.maxSpeed
      : r.id === 'rule-2' ? STATE.policies.indoorSpeed
      : r.id === 'rule-6' ? 10
      : r.threshold,
    enabled: r.id === 'rule-1' ? true
      : r.id === 'rule-2' ? true
      : r.id === 'rule-3' ? STATE.policies.speedIndoorBlock
      : r.id === 'rule-4' ? STATE.policies.autonomyUnlock
      : r.id === 'rule-5' ? STATE.policies.disconnectedBlock
      : r.id === 'rule-6' ? STATE.policies.lowBattery
      : r.enabled,
  }));
  return [...base, ...STATE.customRules].sort((a, b) => b.priority - a.priority);
}

function runPolicyEngine(robot, cmd, speed) {
  const rulesApplied = [];
  const reasons = [];
  const rules = getAllRules();

  // Rule 5: Disconnected (always first — system rule)
  if (!robot.connected) {
    rulesApplied.push({ id: 'Rule 5', desc: 'Robot not connected', type: 'block' });
    return { status: 'BLOCKED', rulesApplied, reason: `${robot.id} is disconnected` };
  }

  const isAutonomy = ['START_AUTONOMY', 'PAUSE_AUTONOMY', 'DISABLE_AUTONOMY'].includes(cmd);
  const isMove = ['MOVE_FORWARD', 'MOVE_BACK', 'TURN_LEFT', 'TURN_RIGHT'].includes(cmd);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.system && rule.type === 'connected') continue; // Already checked above

    if (rule.type === 'unlock' && isAutonomy && !STATE.operatorUnlock) {
      rulesApplied.push({ id: rule.name, desc: rule.desc, type: 'block' });
      return { status: 'BLOCKED', rulesApplied, reason: 'Autonomy requires Operator Unlock' };
    }

    if (rule.type === 'battery' && cmd === 'START_AUTONOMY' && robot.battery < rule.threshold) {
      rulesApplied.push({ id: rule.name, desc: `Battery ${Math.round(robot.battery)}% below ${rule.threshold}%`, type: 'block' });
      return { status: 'BLOCKED', rulesApplied, reason: `Battery at ${Math.round(robot.battery)}% — too low for autonomy` };
    }

    if (rule.type === 'max_speed' && isMove) {
      if (rule.indoorOnly && STATE.environment !== 'indoor') continue;
      if (speed > rule.threshold) {
        if (rule.blockStrict || rule.id === 'rule-1') {
          rulesApplied.push({ id: rule.name, desc: `Speed ${speed} exceeds ${rule.threshold} cm/s`, type: 'block' });
          return {
            status: 'BLOCKED', rulesApplied,
            reason: `Speed ${speed} cm/s exceeds limit ${rule.threshold} cm/s`,
            fix: `Lower speed to ≤ ${rule.threshold} cm/s`,
          };
        } else {
          rulesApplied.push({ id: rule.name, desc: `Near speed limit (${speed}/${rule.threshold} cm/s)`, type: 'warn' });
        }
      }
    }
  }

  if (rulesApplied.length === 0) {
    rulesApplied.push({ id: '—', desc: 'All policies satisfied', type: 'pass' });
  }

  return { status: 'APPROVED', rulesApplied, reason: '' };
}

/* ═══════════════════════════════════════════════════════════════
   POLICY PANEL
═══════════════════════════════════════════════════════════════ */
function updatePolicyPanel(decision) {
  const badge = document.getElementById('policyStatusBadge');
  const rulesList = document.getElementById('rulesAppliedList');
  const blockReason = document.getElementById('policyBlockReason');
  const blockText = document.getElementById('blockReasonText');
  const suggestFix = document.getElementById('suggestedFix');

  badge.className = 'policy-status-badge';
  if (decision.status === 'APPROVED') {
    badge.classList.add('badge-approved');
    badge.innerHTML = '<i class="fas fa-circle-check"></i> APPROVED';
  } else if (decision.status === 'BLOCKED') {
    badge.classList.add('badge-blocked');
    badge.innerHTML = '<i class="fas fa-ban"></i> BLOCKED';
  } else if (decision.status === 'WOULD_BLOCK') {
    badge.classList.add('badge-pending');
    badge.innerHTML = '<i class="fas fa-triangle-exclamation"></i> WOULD BLOCK';
  }

  rulesList.innerHTML = '';
  decision.rulesApplied.forEach(rule => {
    const item = document.createElement('div');
    item.className = `rule-applied-item ${rule.type === 'block' ? 'block' : rule.type === 'warn' ? 'warn' : ''}`;
    item.innerHTML = `
      <i class="fas ${rule.type === 'block' ? 'fa-ban' : rule.type === 'warn' ? 'fa-triangle-exclamation' : 'fa-check'}" style="color:${rule.type === 'block' ? 'var(--danger)' : rule.type === 'warn' ? 'var(--accent)' : 'var(--success)'}"></i>
      <span>${rule.id}: ${rule.desc}</span>
    `;
    rulesList.appendChild(item);
  });

  if (decision.status === 'BLOCKED' || decision.status === 'WOULD_BLOCK') {
    blockReason.classList.remove('hidden');
    blockText.textContent = decision.reasons.join('; ');
    const fix = Object.values(decision.decisions).find(d => d.fix)?.fix;
    if (fix) {
      suggestFix.innerHTML = `<i class="fas fa-lightbulb" style="color:var(--accent)"></i> Suggested: ${fix}`;
      suggestFix.classList.remove('hidden');
    } else {
      suggestFix.classList.add('hidden');
    }
  } else {
    blockReason.classList.add('hidden');
  }
}

function bindPolicyPanel() {
  document.getElementById('viewDecisionBtn').addEventListener('click', () => {
    if (!STATE.lastDecision) {
      showToast('No decision available yet', 'info');
      return;
    }
    document.getElementById('decisionJson').textContent = JSON.stringify(STATE.lastDecision, null, 2);
    document.getElementById('decisionModal').classList.remove('hidden');
  });
}

function updateLastDecision(status, time) {
  const el = document.getElementById('lastDecisionStatus');
  if (status === 'APPROVED') {
    el.innerHTML = `<span style="color:var(--success)">Approved</span> ${time}`;
  } else if (status === 'BLOCKED') {
    el.innerHTML = `<span style="color:var(--danger)">Blocked</span> ${time}`;
  } else if (status === 'WOULD_BLOCK') {
    el.innerHTML = `<span style="color:var(--accent)">Would Block</span> ${time}`;
  } else if (status === 'PENDING') {
    el.innerHTML = `<span style="color:var(--info)">Pending…</span>`;
  } else {
    el.textContent = '—';
  }
}

/* ── BANNER ── */
function showBanner(type, iconHtml, text) {
  const banner = document.getElementById('validationBanner');
  banner.className = `validation-banner ${type}`;
  banner.innerHTML = `<div class="vb-icon">${iconHtml}</div><div class="vb-text">${text}</div>`;
  banner.classList.remove('hidden');
}
function hideBanner() {
  document.getElementById('validationBanner').classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   TELEMETRY
═══════════════════════════════════════════════════════════════ */
function renderTeleTabs() {
  const tabs = document.getElementById('teleTabs');
  tabs.innerHTML = '';
  Object.keys(STATE.robots).forEach(id => {
    const robot = STATE.robots[id];
    const tab = document.createElement('button');
    tab.className = `tele-tab${id === STATE.activeTeleRobot ? ' active' : ''}${!robot.connected ? ' offline' : ''}`;
    tab.textContent = id;
    tab.dataset.id = id;
    tab.addEventListener('click', () => {
      STATE.activeTeleRobot = id;
      document.querySelectorAll('.tele-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      updateTelemetryDisplay();
      updateCharts();
    });
    tabs.appendChild(tab);
  });
}

function updateTelemetryDisplay() {
  const robot = STATE.robots[STATE.activeTeleRobot];
  if (!robot) return;

  document.getElementById('metricBattery').textContent = `${Math.round(robot.battery)}%`;
  document.getElementById('metricRSSI').textContent = robot.connected ? `${Math.round(robot.rssi)} dBm` : '—';
  document.getElementById('metricSpeed').textContent = robot.connected ? `${robot.speed} cm/s` : '—';
  document.getElementById('metricState').textContent = robot.movementState;
  document.getElementById('metricUptime').textContent = formatUptime(robot.uptime);
  document.getElementById('lastTeleUpdate').textContent = new Date().toLocaleTimeString();

  const battCell = document.getElementById('teleBattery');
  battCell.style.borderColor = robot.battery < 20 ? 'rgba(209,75,75,0.4)' : 'var(--border)';
}

/* ── CHARTS ── */
function initCharts() {
  const chartOpts = (label, color) => ({
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        borderWidth: 1.5,
        backgroundColor: color.replace(')', ', 0.08)').replace('rgb', 'rgba'),
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1A1A20',
        borderColor: '#24242A',
        borderWidth: 1,
        titleColor: '#838792',
        bodyColor: '#F0F0F0',
        callbacks: { title: items => items[0].label }
      }},
      scales: {
        x: { display: false },
        y: {
          display: true,
          grid: { color: 'rgba(36,36,42,0.8)', drawBorder: false },
          ticks: { color: '#838792', font: { size: 9 }, maxTicksLimit: 4 },
          border: { display: false },
        },
      },
    },
  });

  const battCtx = document.getElementById('batteryChart').getContext('2d');
  batteryChartInst = new Chart(battCtx, chartOpts('Battery %', 'rgb(233,103,35)'));

  const sigCtx = document.getElementById('signalChart').getContext('2d');
  signalChartInst = new Chart(sigCtx, chartOpts('Signal dBm', 'rgb(60,203,127)'));

  updateCharts();
}

function updateCharts() {
  const hist = TELE_HISTORY[STATE.activeTeleRobot];
  if (!hist) return;

  batteryChartInst.data.labels = hist.labels;
  batteryChartInst.data.datasets[0].data = hist.battery;
  batteryChartInst.update('none');

  signalChartInst.data.labels = hist.labels;
  signalChartInst.data.datasets[0].data = hist.rssi.map(v => Math.abs(v));
  signalChartInst.update('none');
}

/* ═══════════════════════════════════════════════════════════════
   SIMULATION LOOP
═══════════════════════════════════════════════════════════════ */
function startSimulation() {
  stopSimulation();

  heartbeatInterval = setInterval(() => {
    Object.values(STATE.robots).forEach(robot => {
      if (!robot.connected) return;

      if (robot.movementState !== 'Idle') {
        robot.battery = Math.max(0, robot.battery - 0.05);
      } else {
        robot.battery = Math.max(0, robot.battery - 0.01);
      }

      robot.rssi = Math.max(-95, Math.min(-40, robot.rssi + (Math.random() * 2 - 1)));
      // Simulate latency variation
      if (robot.latency !== null && robot.latency !== undefined) {
        robot.latency = Math.max(5, Math.min(200, robot.latency + Math.round(Math.random() * 10 - 5)));
      }
      robot.lastHeartbeat = Date.now();
      robot.uptime += 2;

      const hist = TELE_HISTORY[robot.id];
      if (hist) {
        hist.battery.push(Math.round(robot.battery));
        hist.battery.shift();
        hist.rssi.push(Math.round(robot.rssi));
        hist.rssi.shift();
        const now = new Date();
        hist.labels.push(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        hist.labels.shift();
      }
    });

    updateTelemetryDisplay();
    updateCharts();
    document.querySelectorAll('.robot-card').forEach(card => {
      const id = card.dataset.robotId;
      const robot = STATE.robots[id];
      if (!robot) return;
      const hbEl = card.querySelector('.heartbeat-value');
      if (hbEl) hbEl.textContent = formatTimeAgo(robot.lastHeartbeat);
      const battBar = card.querySelector('.battery-bar');
      if (battBar) {
        const pct = Math.max(0, Math.min(100, robot.battery));
        battBar.style.width = pct + '%';
        battBar.className = 'battery-bar' + (pct < 20 ? ' low' : pct < 40 ? ' med' : '');
        const battValEl = card.querySelector('.robot-metric .val');
        if (battValEl) battValEl.textContent = Math.round(pct) + '%';
      }
    });
    // Refresh Robots page latency if open
    document.querySelectorAll('.reg-robot-row').forEach(row => {
      const id = row.dataset.robotId;
      const robot = STATE.robots[id];
      if (!robot) return;
      const latEl = row.querySelector('.rrr-latency');
      if (latEl) latEl.textContent = robot.latency ? `${robot.latency}ms` : '—';
    });
  }, 2000);
}

function stopSimulation() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (teleUpdateInterval) clearInterval(teleUpdateInterval);
  if (queueInterval) clearInterval(queueInterval);
}

/* ═══════════════════════════════════════════════════════════════
   ROBOTS PAGE
═══════════════════════════════════════════════════════════════ */
function bindRobotsPage() {
  document.getElementById('scanRobotsBtn')?.addEventListener('click', () => {
    showToast('Scanning network for ESP32 robots…', 'info');
    setTimeout(() => {
      showToast('Scan complete: 3 registered robots found', 'approved');
      renderRobotsPageList();
    }, 1800);
  });

  document.getElementById('testConnectionBtn')?.addEventListener('click', testRobotConnection);
  document.getElementById('saveRobotCfgBtn')?.addEventListener('click', saveRobotConfig);
  document.getElementById('cancelRobotCfgBtn')?.addEventListener('click', clearRobotConfigForm);
}

function renderRobotsPageList() {
  const list = document.getElementById('registeredRobotsList');
  if (!list) return;

  const robots = Object.values(STATE.robots);
  const connected = robots.filter(r => r.connected).length;
  const countEl = document.getElementById('robotsPageCount');
  if (countEl) countEl.textContent = `${connected} / ${robots.length} connected`;

  list.innerHTML = '';
  robots.forEach(robot => {
    const battPct = Math.round(robot.battery);
    const hsVerified = robot.handshakeStatus === 'verified';
    const row = document.createElement('div');
    row.className = `reg-robot-row${!robot.connected ? ' offline' : ''}`;
    row.dataset.robotId = robot.id;
    row.innerHTML = `
      <div class="rrr-left">
        <span class="conn-dot ${robot.connected ? 'connected' : 'disconnected'}"></span>
        <div class="rrr-info">
          <div class="rrr-name">${robot.id} <span class="muted" style="font-size:10px">${robot.name}</span></div>
          <div class="rrr-meta">
            <span>${robot.ipAddress ? `${robot.ipAddress}:${robot.port || 80}` : 'No endpoint configured'}</span>
            <span class="rrr-type">${robot.connectionType || 'wifi'}</span>
            <span class="rrr-status-badge ${robot.connected ? 'online' : 'offline'}">${robot.connected ? 'ONLINE' : 'OFFLINE'}</span>
            <span class="rrr-status-badge ${hsVerified ? 'verified' : 'unverified'}">${hsVerified ? 'HS OK' : 'HS WAIT'}</span>
          </div>
        </div>
      </div>
      <div class="rrr-stats">
        <span class="rrr-batt" title="Battery">${battPct}%</span>
        <span class="rrr-latency" title="Latency">${robot.latency ? robot.latency + 'ms' : '—'}</span>
        <span class="rrr-hs" style="color:${hsVerified ? 'var(--success)' : 'var(--muted)'}" title="Handshake">
          <i class="fas fa-${hsVerified ? 'handshake' : 'handshake-slash'}"></i>
        </span>
      </div>
      <div class="rrr-actions">
        <button class="btn-ghost btn-xs rrr-connect-btn" data-id="${robot.id}" title="${robot.connected ? 'Disconnect' : 'Connect'}">
          <i class="fas fa-${robot.connected ? 'unlink' : 'link'}"></i>
          ${robot.connected ? 'Disconnect' : 'Connect'}
        </button>
        <button class="btn-ghost btn-xs rrr-ping-btn" data-id="${robot.id}" title="Ping">
          <i class="fas fa-satellite-dish"></i>
        </button>
        <button class="btn-ghost btn-xs rrr-edit-btn" data-id="${robot.id}" title="Edit">
          <i class="fas fa-pen"></i>
        </button>
        <button class="btn-ghost btn-xs rrr-remove-btn" data-id="${robot.id}" title="Remove" style="color:var(--danger)">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;

    // Connect/Disconnect
    row.querySelector('.rrr-connect-btn').addEventListener('click', () => {
      const r = STATE.robots[robot.id];
      if (!r) return;
      if (r.connected) {
        r.connected = false;
        r.handshakeStatus = 'unverified';
        showToast(`${robot.id} disconnected`, 'info');
        addGovernanceEvent({ severity: 'CRITICAL', category: 'Robot', title: `${robot.id} Disconnected`, description: 'Robot link manually disconnected by operator.' });
      } else {
        showToast(`Connecting to ${robot.id}…`, 'info');
        setTimeout(() => {
          r.connected = true;
          r.lastHeartbeat = Date.now();
          r.handshakeStatus = 'verified';
          r.latency = Math.round(Math.random() * 30 + 10);
          showToast(`${robot.id} connected`, 'approved');
          addGovernanceEvent({ severity: 'INFO', category: 'Robot', title: `${robot.id} Connected`, description: `Round-trip latency ${r.latency}ms.` });
          renderRobotsPageList();
          renderRobotList();
          updateStatusStrip();
          saveState();
        }, 1200);
        return;
      }
      renderRobotsPageList();
      renderRobotList();
      updateStatusStrip();
      saveState();
    });

    // Ping
    row.querySelector('.rrr-ping-btn').addEventListener('click', async () => {
      const r = STATE.robots[robot.id];
      if (!r || !r.connected) { showToast(`${robot.id} is offline`, 'warning'); return; }
      showToast(`Pinging ${robot.id}…`, 'info');
      const hs = await simulateHandshake(r);
      r.latency = hs.latency;
      showToast(`${robot.id} responded in ${hs.latency}ms`, 'approved');
      addGovernanceEvent({ severity: hs.latency > 120 ? 'WARNING' : 'INFO', category: 'Robot', title: `${robot.id} Ping Response`, description: `Latency measured at ${hs.latency}ms.` });
      renderRobotsPageList();
      saveState();
    });

    // Edit
    row.querySelector('.rrr-edit-btn').addEventListener('click', () => {
      loadRobotIntoConfigForm(robot.id);
    });

    // Remove
    row.querySelector('.rrr-remove-btn').addEventListener('click', () => {
      if (!robot.id.startsWith('R-0')) {
        if (!confirm(`Remove ${robot.id}?`)) return;
        delete STATE.robots[robot.id];
        STATE.selectedRobots.delete(robot.id);
        renderRobotsPageList();
        renderRobotList();
        updateStatusStrip();
        saveState();
      } else {
        showToast('Cannot remove built-in robots. Reset Demo to restore.', 'warning');
      }
    });

    list.appendChild(row);
  });
}

function loadRobotIntoConfigForm(robotId) {
  const robot = STATE.robots[robotId];
  if (!robot) return;
  document.getElementById('cfgName').value = robot.name || '';
  document.getElementById('cfgId').value = robot.id || '';
  document.getElementById('cfgConnType').value = robot.connectionType || 'wifi';
  document.getElementById('cfgIp').value = robot.ipAddress || '';
  document.getElementById('cfgPort').value = robot.port || 80;
  document.getElementById('cfgApiKey').value = robot.apiKey || '';
  document.getElementById('cfgCameraUrl').value = robot.cameraUrl || '';
  document.getElementById('robotConfigTarget').textContent = `Editing: ${robot.id}`;
  document.getElementById('cfgId').dataset.editingId = robotId;
  // Clear test results
  document.getElementById('testResult').classList.add('hidden');
  document.getElementById('handshakeResult').classList.add('hidden');
}

function clearRobotConfigForm() {
  ['cfgName', 'cfgId', 'cfgIp', 'cfgApiKey', 'cfgCameraUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; delete el.dataset.editingId; }
  });
  document.getElementById('cfgPort').value = 80;
  document.getElementById('cfgConnType').value = 'wifi';
  document.getElementById('robotConfigTarget').textContent = 'New Robot';
  document.getElementById('testResult').classList.add('hidden');
  document.getElementById('handshakeResult').classList.add('hidden');
  const protoPanel = document.getElementById('protocolTestPanel');
  if (protoPanel) protoPanel.classList.add('hidden');
}

async function testRobotConnection() {
  const ip = document.getElementById('cfgIp').value.trim();
  const port = parseInt(document.getElementById('cfgPort').value) || 80;
  const connType = document.getElementById('cfgConnType').value;
  const testResultEl = document.getElementById('testResult');
  const iconEl = document.getElementById('testResultIcon');
  const textEl = document.getElementById('testResultText');
  const hsEl = document.getElementById('handshakeResult');
  const protoPanel = document.getElementById('protocolTestPanel');

  testResultEl.classList.remove('hidden');
  iconEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:var(--accent)"></i>';
  textEl.textContent = 'Testing connection…';
  hsEl.classList.add('hidden');
  if (protoPanel) {
    protoPanel.classList.remove('hidden');
    setProtoTestRow('ptHandshake', 'running', 'Testing…');
    setProtoTestRow('ptHeartbeat', 'pending', '—');
    setProtoTestRow('ptTelemetry', 'pending', '—');
    setProtoTestRow('ptLatency', 'pending', '—');
  }

  // Simulate connection test
  await delay(600);

  const editingId = document.getElementById('cfgId').dataset.editingId;
  const isSimMode = STATE.simMode || connType === 'sim';
  const baseUrl = `http://${ip}:${port}`;

  if (!isSimMode && !ip) {
    iconEl.innerHTML = '<i class="fas fa-circle-xmark" style="color:var(--danger)"></i>';
    textEl.textContent = 'IP address is required for non-sim connections';
    if (protoPanel) {
      setProtoTestRow('ptHandshake', 'fail', 'Missing IP address');
      setProtoTestRow('ptHeartbeat', 'fail', 'Not reached');
      setProtoTestRow('ptTelemetry', 'fail', 'Not reached');
      setProtoTestRow('ptLatency', 'fail', '—');
    }
    return;
  }

  if (isSimMode) {
    iconEl.innerHTML = '<i class="fas fa-circle-check" style="color:var(--success)"></i>';
    textEl.textContent = 'Simulation mode — connection accepted';

    const robot = editingId ? STATE.robots[editingId] : null;
    const hsData = robot ? await simulateHandshake(robot) : {
      success: true, firmware: 'v2.4.0-esp32',
      capabilities: ['move', 'turn', 'telemetry'],
      status: 'ready', latency: Math.round(Math.random() * 30 + 10),
    };

    hsEl.classList.remove('hidden');
    document.getElementById('hsStatus').innerHTML = `<span style="color:var(--success)">${hsData.status || 'ready'}</span>`;
    document.getElementById('hsFirmware').textContent = hsData.firmware || 'Unknown';
    document.getElementById('hsCapabilities').textContent = (hsData.capabilities || []).join(', ') || '—';
    document.getElementById('hsLatency').textContent = hsData.latency ? `${hsData.latency} ms` : '—';

    // Simulate protocol test steps
    if (protoPanel) {
      const hsLatency = hsData.latency || Math.round(Math.random() * 30 + 10);
      setProtoTestRow('ptHandshake', 'ok', `Verified — ${hsData.firmware}`);
      await delay(300);
      setProtoTestRow('ptHeartbeat', 'running', 'Checking…');
      await delay(500);
      const hbLatency = Math.round(Math.random() * 20 + 8);
      setProtoTestRow('ptHeartbeat', 'ok', `Alive — ${hbLatency} ms`);
      await delay(300);
      setProtoTestRow('ptTelemetry', 'running', 'Reading sensors…');
      await delay(500);
      setProtoTestRow('ptTelemetry', 'ok', `Battery ${robot?.battery || 75}%, RSSI ${robot?.rssi || -55} dBm`);
      await delay(200);
      setProtoTestRow('ptLatency', 'ok', `${hsLatency} ms avg`);
    }
  } else {
    // Real connection attempt
    try {
      const t0 = Date.now();
      const url = `${baseUrl}/handshake`;
      const res = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(document.getElementById('cfgApiKey').value.trim() ? { 'X-API-Key': document.getElementById('cfgApiKey').value.trim() } : {}),
          },
          body: JSON.stringify({ controller: 'RAL', version: '2.0.0', timestamp: Date.now() }),
          mode: 'cors',
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      const data = await res.json();
      const hsLatency = Date.now() - t0;
      iconEl.innerHTML = '<i class="fas fa-circle-check" style="color:var(--success)"></i>';
      textEl.textContent = `Connected to ${ip}:${port}`;
      hsEl.classList.remove('hidden');
      document.getElementById('hsStatus').innerHTML = `<span style="color:var(--success)">${data.status || 'ready'}</span>`;
      document.getElementById('hsFirmware').textContent = data.firmwareVersion || data.firmware || 'Unknown';
      document.getElementById('hsCapabilities').textContent = (data.capabilities || []).join(', ') || '—';
      document.getElementById('hsLatency').textContent = `${hsLatency} ms`;

      if (protoPanel) {
        setProtoTestRow('ptHandshake', 'ok', `Verified — ${data.firmwareVersion || data.firmware || 'OK'}`);
        // Try heartbeat
        try {
          const t1 = Date.now();
          const hbRes = await fetch(`${baseUrl}/heartbeat`, { mode: 'cors' });
          const hbData = await hbRes.json();
          const hbLatency = Date.now() - t1;
          setProtoTestRow('ptHeartbeat', hbData.alive ? 'ok' : 'fail', hbData.alive ? `Alive — ${hbLatency} ms` : 'Not alive');
        } catch { setProtoTestRow('ptHeartbeat', 'fail', 'No response'); }
        // Try telemetry
        try {
          const t2 = Date.now();
          const tlRes = await fetch(`${baseUrl}/telemetry`, { mode: 'cors' });
          const tlData = await tlRes.json();
          const tlLatency = Date.now() - t2;
          setProtoTestRow('ptTelemetry', 'ok', `Battery ${tlData.battery}%, RSSI ${tlData.rssi} dBm`);
          setProtoTestRow('ptLatency', 'ok', `${Math.round((hsLatency + tlLatency) / 2)} ms avg`);
        } catch { setProtoTestRow('ptTelemetry', 'fail', 'No telemetry'); setProtoTestRow('ptLatency', 'ok', `${hsLatency} ms`); }
      }
    } catch (err) {
      iconEl.innerHTML = '<i class="fas fa-circle-xmark" style="color:var(--danger)"></i>';
      textEl.textContent = `Connection failed: ${err.message}`;
      if (protoPanel) {
        setProtoTestRow('ptHandshake', 'fail', err.message);
        setProtoTestRow('ptHeartbeat', 'fail', 'Not reached');
        setProtoTestRow('ptTelemetry', 'fail', 'Not reached');
        setProtoTestRow('ptLatency', 'fail', '—');
      }
    }
  }
}

function setProtoTestRow(rowId, status, detail) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const statusEl = row.querySelector('.pt-status');
  const detailEl = row.querySelector('.pt-detail');
  if (statusEl) {
    statusEl.className = 'pt-status';
    if (status === 'ok') {
      statusEl.classList.add('pt-ok');
      statusEl.innerHTML = '<i class="fas fa-circle-check"></i> OK';
    } else if (status === 'fail') {
      statusEl.classList.add('pt-fail');
      statusEl.innerHTML = '<i class="fas fa-circle-xmark"></i> FAIL';
    } else if (status === 'running') {
      statusEl.classList.add('pt-running');
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> …';
    } else {
      statusEl.classList.add('pt-pending');
      statusEl.textContent = '—';
    }
  }
  if (detailEl) detailEl.textContent = detail || '';
}

function saveRobotConfig() {
  const name = document.getElementById('cfgName').value.trim();
  const id = document.getElementById('cfgId').value.trim().toUpperCase();
  const connType = document.getElementById('cfgConnType').value;
  const ip = document.getElementById('cfgIp').value.trim();
  const port = parseInt(document.getElementById('cfgPort').value) || 80;
  const apiKey = document.getElementById('cfgApiKey').value.trim();
  const cameraUrl = document.getElementById('cfgCameraUrl').value.trim();
  const editingId = document.getElementById('cfgId').dataset.editingId;

  if (!id || !name) { showToast('Name and ID are required', 'warning'); return; }

  if (editingId && STATE.robots[editingId]) {
    // Update existing robot
    const robot = STATE.robots[editingId];
    robot.name = name;
    robot.connectionType = connType;
    robot.ipAddress = ip;
    robot.port = port;
    robot.cameraUrl = cameraUrl;
    if (apiKey) robot.apiKey = apiKey;
    // If ID changed, re-key
    if (editingId !== id) {
      STATE.robots[id] = { ...robot, id };
      delete STATE.robots[editingId];
    }
    showToast(`${id} configuration saved`, 'approved');
  } else {
    // New robot
    if (STATE.robots[id]) { showToast(`Robot ID ${id} already exists`, 'warning'); return; }
    STATE.robots[id] = {
      id, name,
      connected: false, mode: 'MANUAL',
      battery: 100, rssi: -60,
      speed: 0, movementState: 'Idle',
      uptime: 0,
      lastHeartbeat: Date.now(),
      firmware: 'unknown',
      ipAddress: ip, port, connectionType: connType,
      cameraUrl,
      handshakeStatus: 'unverified',
      latency: null, capabilities: [],
      commands: [],
    };
    if (!TELE_HISTORY[id]) {
      TELE_HISTORY[id] = {
        battery: Array.from({ length: 20 }, () => 100),
        rssi: Array.from({ length: 20 }, () => -60),
        labels: Array.from({ length: 20 }, (_, i) => {
          const d = new Date(Date.now() - (19 - i) * 30000);
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }),
      };
    }
    showToast(`${id} added to fleet`, 'approved');
  }

  clearRobotConfigForm();
  renderRobotsPageList();
  renderRobotList();
  renderTeleTabs();
  updateStatusStrip();
  saveState();
}

/* ═══════════════════════════════════════════════════════════════
   AUDIT LOG
═══════════════════════════════════════════════════════════════ */
function addAuditLogEntry(data) {
  const cmdId = data.commandId || generateId();
  const entry = {
    id: generateId(),
    requestId: data.requestId || generateId(),
    policyDecisionId: data.policyDecisionId || generateId(),
    commandId: cmdId,
    time: new Date().toLocaleTimeString(),
    timestamp: Date.now(),
    robot: data.robots,
    command: data.command,
    validation: data.validation,
    execution: data.execution,
    rule: data.rule || '—',
    operator: STATE.operator,
    speed: data.speed,
    notes: data.notes || '',
    mode: data.mode || STATE.policyMode,
    environment: data.environment || STATE.environment,
    safetyCheck: data.safetyCheck || '—',
    // Extended protocol fields
    handshakeVerified: data.handshakeVerified !== undefined ? data.handshakeVerified : null,
    dispatchStatus: data.dispatchStatus || '—',
    ackState: data.ackState || 'Not Executed',
    ackTimestamp: data.ackTimestamp || null,
    robotEndpoint: data.robotEndpoint || '—',
  };
  STATE.auditLog.unshift(entry);
  if (STATE.auditLog.length > 500) STATE.auditLog = STATE.auditLog.slice(0, 500);
  addGovernanceEvent({
    severity: 'INFO',
    category: 'Audit',
    title: 'Entry Created',
    description: `${entry.command} · ${entry.validation} · ${entry.robot}`,
    relatedAuditId: entry.id,
    relatedTimeline: entry.validation === 'BLOCKED' ? 'Rule Triggered' : 'Governance Check',
    relatedAuthorityIndex: entry.validation === 'BLOCKED' ? 2 : 4,
  });
  return entry;
}

function renderAuditLog() {
  const filtered = getFilteredLogs('logFilterRobot', 'logFilterStatus', 'logFilterTime', 'logSearch');
  const entries = filtered.slice(0, 20);

  const cardList = document.getElementById('logCardList');
  if (cardList) {
    cardList.innerHTML = '';
    if (entries.length === 0) {
      cardList.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:12px;">No log entries</div>';
    } else {
      entries.forEach(entry => cardList.appendChild(createLogCard(entry)));
    }
  }

  const tbody = document.getElementById('logTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    entries.forEach(entry => tbody.appendChild(createLogRow(entry, false)));
  }
}

function renderFullAuditLog() {
  const filtered = getFilteredLogs('logFilterRobotFull', 'logFilterStatusFull', 'logFilterTimeFull', 'logSearchFull');

  const cardList = document.getElementById('fullLogCardList');
  if (cardList) {
    cardList.innerHTML = '';
    if (filtered.length === 0) {
      cardList.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:12px;">No log entries match the filters</div>';
    } else {
      filtered.forEach(entry => cardList.appendChild(createLogCard(entry)));
    }
  }

  const tbody = document.getElementById('fullLogTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    filtered.forEach(entry => tbody.appendChild(createLogRow(entry, true)));
  }
}

function createLogCard(entry) {
  const card = document.createElement('div');
  card.className = 'log-card';
  card.dataset.auditId = entry.id;
  card.style.minHeight = '48px';
  card.innerHTML = `
    <div class="log-card-left">
      <div class="log-card-time">${entry.time}</div>
      <div class="log-card-cmd">${entry.command}</div>
      <div class="log-card-robot" style="color:${getRobotColor(entry.robot)}">${entry.robot}</div>
    </div>
    <div class="log-card-right">
      ${validationPill(entry.validation)}
      ${executionPill(entry.execution)}
    </div>
    <i class="fas fa-chevron-right log-card-chevron"></i>
  `;
  card.addEventListener('click', () => openLogDetail(entry));
  return card;
}

function getFilteredLogs(robotFilterId, statusFilterId, timeFilterId, searchId) {
  const robotEl = document.getElementById(robotFilterId);
  const statusEl = document.getElementById(statusFilterId);
  const timeEl = document.getElementById(timeFilterId);
  const searchEl = document.getElementById(searchId);

  const robotFilter = robotEl ? robotEl.value : '';
  const statusFilter = statusEl ? statusEl.value : '';
  const timeFilter = timeEl ? parseInt(timeEl.value) || 0 : 0;
  const search = searchEl ? searchEl.value.toLowerCase() : '';

  return STATE.auditLog.filter(entry => {
    if (robotFilter && !entry.robot.includes(robotFilter)) return false;
    if (statusFilter && entry.validation !== statusFilter) return false;
    if (timeFilter && (Date.now() - entry.timestamp) > timeFilter * 60 * 1000) return false;
    if (search && !`${entry.command} ${entry.robot} ${entry.rule} ${entry.notes}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function createLogRow(entry, showRequestId) {
  const tr = document.createElement('tr');
  tr.dataset.auditId = entry.id;
  const cmdIdShort = entry.commandId ? entry.commandId.slice(0,7) + '…' : '—';
  const hsCell = entry.handshakeVerified === true
    ? '<span class="validation-pill pill-approved" style="font-size:9px;padding:.15rem .4rem"><i class="fas fa-handshake"></i> OK</span>'
    : entry.handshakeVerified === false
      ? '<span class="validation-pill pill-blocked" style="font-size:9px;padding:.15rem .4rem"><i class="fas fa-handshake-slash"></i> FAIL</span>'
      : '<span class="muted" style="font-size:10px">—</span>';
  const dispatchCell = entry.dispatchStatus === 'SENT'
    ? '<span class="validation-pill pill-executed" style="font-size:9px;padding:.15rem .4rem">SENT</span>'
    : entry.dispatchStatus === 'REJECTED'
      ? '<span class="validation-pill pill-blocked" style="font-size:9px;padding:.15rem .4rem">REJECTED</span>'
      : `<span class="muted" style="font-size:10px">${entry.dispatchStatus || '—'}</span>`;
  const ackCell = ackPill(entry.ackState);
  const endpointCell = entry.robotEndpoint && entry.robotEndpoint !== '—'
    ? `<span class="log-cmd" style="font-size:9px;color:var(--muted)">${entry.robotEndpoint}</span>`
    : '<span class="muted" style="font-size:10px">—</span>';

  if (showRequestId) {
    tr.innerHTML = `
      <td class="log-time">${entry.time}</td>
      <td class="log-time" style="font-size:9px;max-width:80px;overflow:hidden;text-overflow:ellipsis;" title="${entry.commandId}">${cmdIdShort}</td>
      <td><span class="log-robot" style="color:${getRobotColor(entry.robot)}">${entry.robot}</span></td>
      <td><span class="log-cmd">${entry.command}</span></td>
      <td>${validationPill(entry.validation)}</td>
      <td>${entry.safetyCheck && entry.safetyCheck !== '—' ? safetyPill(entry.safetyCheck) : '<span class="muted">—</span>'}</td>
      <td>${hsCell}</td>
      <td>${dispatchCell}</td>
      <td>${ackCell}</td>
      <td>${endpointCell}</td>
      <td><span class="rule-ref">${entry.rule}</span></td>
      <td><span class="log-operator">${entry.operator}</span></td>
    `;
  } else {
    tr.innerHTML = `
      <td class="log-time">${entry.time}</td>
      <td class="log-time" style="font-size:9px;max-width:70px;overflow:hidden;text-overflow:ellipsis;" title="${entry.commandId}">${cmdIdShort}</td>
      <td><span class="log-robot" style="color:${getRobotColor(entry.robot)}">${entry.robot}</span></td>
      <td><span class="log-cmd">${entry.command}</span></td>
      <td>${validationPill(entry.validation)}</td>
      <td>${entry.safetyCheck && entry.safetyCheck !== '—' ? safetyPill(entry.safetyCheck) : '<span class="muted">—</span>'}</td>
      <td>${hsCell}</td>
      <td>${dispatchCell}</td>
      <td>${ackCell}</td>
      <td><span class="rule-ref">${entry.rule}</span></td>
      <td><span class="log-operator">${entry.operator}</span></td>
    `;
  }
  tr.addEventListener('click', () => openLogDetail(entry));
  return tr;
}

function ackPill(state) {
  if (!state || state === 'Not Executed') return '<span class="muted" style="font-size:10px">—</span>';
  const map = {
    'received':  ['pill-pending', 'received'],
    'executing': ['pill-pending', 'executing'],
    'completed': ['pill-approved', 'completed'],
    'failed':    ['pill-blocked', 'failed'],
    'timeout':   ['pill-blocked', 'timeout'],
    'SIMULATED': ['pill-pending', 'simulated'],
  };
  const [cls, label] = map[state] || ['pill-pending', state];
  return `<span class="validation-pill ${cls}" style="font-size:9px;padding:.15rem .4rem">${label}</span>`;
}

function safetyPill(state) {
  if (state === 'PASSED') return '<span class="validation-pill pill-approved" style="font-size:9px;padding:.15rem .4rem">PASSED</span>';
  if (state === 'BLOCKED') return '<span class="validation-pill pill-blocked" style="font-size:9px;padding:.15rem .4rem">BLOCKED</span>';
  if (state === 'WARN') return '<span class="validation-pill pill-would-block" style="font-size:9px;padding:.15rem .4rem">WARN</span>';
  if (state === 'SKIPPED') return '<span class="muted" style="font-size:10px">SKIPPED</span>';
  return `<span class="validation-pill pill-pending" style="font-size:9px;padding:.15rem .4rem">${state}</span>`;
}

function validationPill(val) {
  if (val === 'APPROVED') return `<span class="validation-pill pill-approved"><i class="fas fa-check"></i> APPROVED</span>`;
  if (val === 'BLOCKED') return `<span class="validation-pill pill-blocked"><i class="fas fa-ban"></i> BLOCKED</span>`;
  if (val === 'WOULD_BLOCK') return `<span class="validation-pill pill-would-block"><i class="fas fa-triangle-exclamation"></i> WOULD BLOCK</span>`;
  return `<span class="validation-pill pill-pending">${val}</span>`;
}

function executionPill(val) {
  if (val === 'EXECUTED') return `<span class="validation-pill pill-executed">EXECUTED</span>`;
  if (val === 'NOT EXECUTED') return `<span class="validation-pill pill-not-executed">NOT EXECUTED</span>`;
  return `<span class="validation-pill pill-pending">${val}</span>`;
}

function getRobotColor(robots) {
  if (robots.includes('R-01')) return 'var(--accent)';
  if (robots.includes('R-02')) return 'var(--success)';
  if (robots.includes('R-03')) return 'var(--info)';
  return 'var(--muted)';
}

function bindLogsPage() {
  const filters = ['logFilterRobot', 'logFilterStatus', 'logFilterTime', 'logSearch',
    'logFilterRobotFull', 'logFilterStatusFull', 'logFilterTimeFull', 'logSearchFull'];
  filters.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => { renderAuditLog(); renderFullAuditLog(); });
      el.addEventListener('input', () => { renderAuditLog(); renderFullAuditLog(); });
    }
  });

  document.getElementById('exportLogBtn')?.addEventListener('click', exportCSV);
  document.getElementById('clearLogBtn')?.addEventListener('click', () => {
    if (confirm('Clear audit log?')) {
      STATE.auditLog = [];
      renderAuditLog();
      renderFullAuditLog();
      saveState();
    }
  });
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
}

function exportCSV() {
  const headers = ['Time','CmdID','Robot','Command','Validation','Safety','Handshake','Dispatch','Ack','Endpoint','Rule','Operator','Speed','Notes'];
  const rows = STATE.auditLog.map(e => [
    e.time, e.commandId || e.requestId, e.robot, e.command,
    e.validation, e.safetyCheck || '—',
    e.handshakeVerified === true ? 'OK' : e.handshakeVerified === false ? 'FAIL' : '—',
    e.dispatchStatus || '—', e.ackState || '—', e.robotEndpoint || '—',
    e.rule, e.operator, e.speed || '', e.notes || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `RAL_audit_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV exported', 'approved');
}

/* ═══════════════════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════════════════ */
function bindModals() {
  document.getElementById('closeDecisionModal').addEventListener('click', () => {
    document.getElementById('decisionModal').classList.add('hidden');
  });
  document.getElementById('closeLogModal').addEventListener('click', () => {
    document.getElementById('logDetailModal').classList.add('hidden');
  });
  document.getElementById('closeDrawerBtn').addEventListener('click', () => {
    document.getElementById('robotDrawer').classList.add('hidden');
  });
  document.querySelectorAll('.modal-overlay, .drawer-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });
}

function openRobotDrawer(robotId) {
  const robot = STATE.robots[robotId];
  if (!robot) return;
  const drawer = document.getElementById('robotDrawer');
  document.getElementById('drawerRobotTitle').textContent = `${robot.id} — ${robot.name}`;
  const body = document.getElementById('drawerBody');

  const hsColor = robot.handshakeStatus === 'verified' ? 'var(--success)' : 'var(--muted)';
  const hsIcon = robot.handshakeStatus === 'verified' ? 'fa-handshake' : 'fa-handshake-slash';

  body.innerHTML = `
    <div class="drawer-robot-header">
      <div>
        <div class="drawer-robot-id">${robot.id}</div>
        <div class="muted" style="font-size:12px">${robot.name}</div>
      </div>
      <div style="margin-left:auto">
        <span class="conn-dot ${robot.connected ? 'connected' : 'disconnected'}" style="width:10px;height:10px;display:inline-block;border-radius:50%;"></span>
        <span class="conn-label ${robot.connected ? 'connected' : 'disconnected'}" style="font-size:12px;margin-left:4px">${robot.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
      </div>
    </div>
    <div class="drawer-spec-grid">
      <div class="drawer-spec"><div class="ds-label">Firmware</div><div class="ds-val">${robot.firmware}</div></div>
      <div class="drawer-spec"><div class="ds-label">IP Address</div><div class="ds-val">${robot.ipAddress ? `${robot.ipAddress}:${robot.port || 80}` : 'Not configured'}</div></div>
      <div class="drawer-spec"><div class="ds-label">Connection</div><div class="ds-val">${robot.connectionType || 'wifi'}</div></div>
      <div class="drawer-spec"><div class="ds-label">Handshake</div>
        <div class="ds-val" style="color:${hsColor}"><i class="fas ${hsIcon}"></i> ${robot.handshakeStatus || 'unknown'}</div>
      </div>
      <div class="drawer-spec"><div class="ds-label">Mode</div><div class="ds-val">${robot.mode}</div></div>
      <div class="drawer-spec"><div class="ds-label">State</div><div class="ds-val">${robot.movementState}</div></div>
      <div class="drawer-spec"><div class="ds-label">Battery</div><div class="ds-val">${Math.round(robot.battery)}%</div></div>
      <div class="drawer-spec"><div class="ds-label">Signal</div><div class="ds-val">${robot.connected ? Math.round(robot.rssi) + ' dBm' : '—'}</div></div>
      <div class="drawer-spec"><div class="ds-label">Latency</div><div class="ds-val">${robot.latency ? robot.latency + ' ms' : '—'}</div></div>
      <div class="drawer-spec"><div class="ds-label">Speed</div><div class="ds-val">${robot.speed} cm/s</div></div>
      <div class="drawer-spec"><div class="ds-label">Uptime</div><div class="ds-val">${formatUptime(robot.uptime)}</div></div>
      <div class="drawer-spec"><div class="ds-label">Capabilities</div><div class="ds-val" style="font-size:10px">${(robot.capabilities || []).join(', ') || '—'}</div></div>
      <div class="drawer-spec"><div class="ds-label">Camera URL</div><div class="ds-val" style="font-size:10px;word-break:break-all">${robot.cameraUrl || '—'}</div></div>
    </div>
    <div>
      <div class="drawer-section-title">Last 10 Commands</div>
      <div class="drawer-cmd-list">
        ${robot.commands.length === 0
          ? '<div class="muted small">No commands issued yet</div>'
          : robot.commands.map(c => `
            <div class="drawer-cmd-item">
              <span class="dc-time">${c.time}</span>
              <span class="dc-cmd">${c.cmd}</span>
              ${c.speed ? `<span class="muted" style="font-size:10px">@ ${c.speed} cm/s</span>` : ''}
            </div>`).join('')
        }
      </div>
    </div>
    <div>
      <div class="drawer-section-title">Recent Policy Blocks</div>
      <div class="drawer-cmd-list">
        ${STATE.auditLog.filter(e => e.robot.includes(robotId) && e.validation === 'BLOCKED').slice(0, 5).map(e => `
          <div class="drawer-cmd-item">
            <span class="dc-time">${e.time}</span>
            <span class="dc-cmd" style="color:var(--danger)">${e.command}</span>
            <span class="muted" style="font-size:10px">${e.rule}</span>
          </div>`).join('') || '<div class="muted small">No blocks recorded</div>'
        }
      </div>
    </div>
  `;

  drawer.classList.remove('hidden');
}

function openLogDetail(entry) {
  const modal = document.getElementById('logDetailModal');
  const body = document.getElementById('logDetailBody');

  const timeline = [
    { time: entry.time, event: 'Command drafted by operator' },
    { time: entry.time, event: 'Policy Engine validation requested' },
    { time: entry.time, event: `Policy decision: ${entry.validation}` },
    { time: entry.time, event: `Safety Envelope: ${entry.safetyCheck || '—'}` },
    { time: entry.time, event: `Handshake: verified` },
    { time: entry.time, event: `Execution: ${entry.execution}` },
  ];

  body.innerHTML = `
    <div class="log-detail-grid">
      <div class="detail-section">
        <div class="detail-section-title">Command Payload</div>
        <div class="detail-field"><div class="df-label">Command</div><div class="df-val">${entry.command}</div></div>
        <div class="detail-field"><div class="df-label">Target Robot(s)</div><div class="df-val">${entry.robot}</div></div>
        <div class="detail-field"><div class="df-label">Speed</div><div class="df-val">${entry.speed ? entry.speed + ' cm/s' : '—'}</div></div>
        <div class="detail-field"><div class="df-label">Operator</div><div class="df-val">${entry.operator}</div></div>
        <div class="detail-field"><div class="df-label">Environment</div><div class="df-val">${entry.environment || '—'}</div></div>
        <div class="detail-field"><div class="df-label">Policy Mode</div><div class="df-val">${entry.mode || '—'}</div></div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Decision Result</div>
        <div class="detail-field"><div class="df-label">Validation</div><div class="df-val">${entry.validation}</div></div>
        <div class="detail-field"><div class="df-label">Safety Check</div><div class="df-val">${entry.safetyCheck || '—'}</div></div>
        <div class="detail-field"><div class="df-label">Execution</div><div class="df-val">${entry.execution}</div></div>
        <div class="detail-field"><div class="df-label">Rule Triggered</div><div class="df-val">${entry.rule}</div></div>
        <div class="detail-field"><div class="df-label">Notes</div><div class="df-val" style="white-space:normal">${entry.notes || '—'}</div></div>
      </div>
    </div>
    <div style="margin-top:1rem">
      <div class="detail-section-title">IDs</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.4rem">
        <div class="detail-field"><div class="df-label">Request ID</div><div class="df-val" style="font-size:10px">${entry.requestId}</div></div>
        <div class="detail-field"><div class="df-label">Policy Decision ID</div><div class="df-val" style="font-size:10px">${entry.policyDecisionId}</div></div>
        <div class="detail-field"><div class="df-label">Command ID</div><div class="df-val" style="font-size:10px">${entry.commandId}</div></div>
      </div>
    </div>
    <div style="margin-top:1rem">
      <div class="detail-section-title">Event Timeline</div>
      <div class="event-timeline" style="margin-top:.5rem">
        ${timeline.map(t => `
          <div class="timeline-item">
            <span class="ti-time">${t.time}</span>
            <span class="ti-event">${t.event}</span>
          </div>`).join('')}
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   POLICIES PAGE — Dynamic Rules
═══════════════════════════════════════════════════════════════ */
function bindPoliciesPage() {
  document.getElementById('policyModeStrict').addEventListener('click', () => setPolicyMode('strict'));
  document.getElementById('policyModeTraining').addEventListener('click', () => setPolicyMode('training'));

  document.getElementById('savePoliciesBtn').addEventListener('click', () => {
    saveState();
    showToast('Policies saved', 'approved');
  });

  document.getElementById('envIndoor').addEventListener('click', () => setEnvironment('indoor'));
  document.getElementById('envOutdoor').addEventListener('click', () => setEnvironment('outdoor'));

  document.getElementById('runSimBtn')?.addEventListener('click', runPolicySim);

  // Add Rule button
  document.getElementById('addRuleBtn')?.addEventListener('click', () => {
    document.getElementById('editRuleId').value = '';
    document.getElementById('editRuleName').value = '';
    document.getElementById('editRuleDesc').value = '';
    document.getElementById('editRuleThreshold').value = '';
    document.getElementById('editRulePriority').value = 5;
    document.getElementById('editRuleType').value = 'max_speed';
    document.getElementById('ruleEditTitle').textContent = 'New Rule';
    document.getElementById('ruleEditForm').classList.remove('hidden');
  });

  document.getElementById('cancelRuleEditBtn')?.addEventListener('click', () => {
    document.getElementById('ruleEditForm').classList.add('hidden');
  });

  document.getElementById('saveRuleEditBtn')?.addEventListener('click', saveCustomRule);

  syncPoliciesUI();
}

function saveCustomRule() {
  const editId = document.getElementById('editRuleId').value;
  const name = document.getElementById('editRuleName').value.trim();
  const desc = document.getElementById('editRuleDesc').value.trim();
  const type = document.getElementById('editRuleType').value;
  const threshold = parseFloat(document.getElementById('editRuleThreshold').value) || null;
  const priority = parseInt(document.getElementById('editRulePriority').value) || 5;

  if (!name) { showToast('Rule name is required', 'warning'); return; }

  if (editId) {
    const idx = STATE.customRules.findIndex(r => r.id === editId);
    if (idx >= 0) {
      STATE.customRules[idx] = { ...STATE.customRules[idx], name, desc, type, threshold, priority };
    }
  } else {
    STATE.customRules.push({
      id: 'custom-' + generateId(),
      name, desc, type, threshold, priority,
      enabled: true, system: false,
    });
  }
  document.getElementById('ruleEditForm').classList.add('hidden');
  renderRulesEditor();
  saveState();
  showToast(`Rule "${name}" saved`, 'approved');
}

function renderRulesEditor() {
  const container = document.getElementById('rulesEditorList');
  if (!container) return;
  const allRules = getAllRules();
  container.innerHTML = '';

  allRules.forEach((rule, idx) => {
    const isDefault = DEFAULT_RULES.some(r => r.id === rule.id);
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <div class="rule-info">
        <div class="rule-id-badge" style="background:${rule.system ? 'var(--danger-dim)' : 'var(--accent-dim)'};">
          P${rule.priority}
        </div>
        <div>
          <div class="rule-name">${rule.name}</div>
          <div class="muted small">${rule.desc}</div>
        </div>
      </div>
      <div class="rule-control">
        ${rule.threshold !== null && rule.threshold !== undefined
          ? `<span class="muted small">${rule.threshold}${rule.type === 'max_speed' ? ' cm/s' : rule.type === 'battery' ? '%' : ''}</span>`
          : `<span class="muted small">${rule.system ? 'Always on' : rule.type}</span>`
        }
      </div>
      <label class="toggle"><input type="checkbox" class="rule-dyn-toggle" data-rule-id="${rule.id}" ${rule.enabled ? 'checked' : ''} ${rule.system ? 'disabled' : ''}/><span class="toggle-slider"></span></label>
      <div class="rule-actions">
        ${!rule.system ? `<button class="icon-btn rule-edit-btn" data-rule-id="${rule.id}" title="Edit"><i class="fas fa-pen" style="font-size:9px"></i></button>` : ''}
        ${!isDefault ? `<button class="icon-btn rule-del-btn" data-rule-id="${rule.id}" title="Delete" style="color:var(--danger)"><i class="fas fa-trash" style="font-size:9px"></i></button>` : ''}
      </div>
    `;

    // Toggle enable
    row.querySelector('.rule-dyn-toggle').addEventListener('change', e => {
      const rid = e.target.dataset.ruleId;
      const custom = STATE.customRules.find(r => r.id === rid);
      if (custom) {
        custom.enabled = e.target.checked;
        saveState();
      }
    });

    // Edit button
    row.querySelector('.rule-edit-btn')?.addEventListener('click', () => {
      const custom = STATE.customRules.find(r => r.id === rule.id);
      if (!custom) return;
      document.getElementById('editRuleId').value = custom.id;
      document.getElementById('editRuleName').value = custom.name;
      document.getElementById('editRuleDesc').value = custom.desc;
      document.getElementById('editRuleType').value = custom.type;
      document.getElementById('editRuleThreshold').value = custom.threshold || '';
      document.getElementById('editRulePriority').value = custom.priority;
      document.getElementById('ruleEditTitle').textContent = 'Edit Rule';
      document.getElementById('ruleEditForm').classList.remove('hidden');
    });

    // Delete button
    row.querySelector('.rule-del-btn')?.addEventListener('click', () => {
      if (!confirm(`Delete rule "${rule.name}"?`)) return;
      STATE.customRules = STATE.customRules.filter(r => r.id !== rule.id);
      renderRulesEditor();
      saveState();
      showToast(`Rule "${rule.name}" deleted`, 'info');
    });

    container.appendChild(row);
  });
}

function setPolicyMode(mode) {
  STATE.policyMode = mode;
  document.getElementById('policyModeStrict').classList.toggle('active', mode === 'strict');
  document.getElementById('policyModeTraining').classList.toggle('active', mode === 'training');
  const info = document.getElementById('policyModeInfo');
  if (mode === 'strict') {
    info.innerHTML = '<i class="fas fa-lock"></i> <strong>Strict Mode:</strong> Commands that violate rules are blocked and do not execute.';
  } else {
    info.innerHTML = '<i class="fas fa-flask"></i> <strong>Training Mode:</strong> Commands execute but display "Would Block" warnings in the audit log.';
  }
  saveState();
  showToast(`Policy mode: ${mode}`, 'info');
}

function setEnvironment(env) {
  STATE.environment = env;
  document.getElementById('envIndoor').classList.toggle('active', env === 'indoor');
  document.getElementById('envOutdoor').classList.toggle('active', env === 'outdoor');
  saveState();
  showToast(`Environment set to: ${env}`, 'info');
}

function syncPoliciesUI() {
  renderRulesEditor();
  setPolicyMode(STATE.policyMode);
  setEnvironment(STATE.environment);
}

function runPolicySim() {
  const cmd = document.getElementById('simCommand').value;
  const speed = parseInt(document.getElementById('simSpeed').value) || 60;
  const robotId = document.getElementById('simRobot').value;
  const robot = STATE.robots[robotId];

  if (!robot) return;

  const decision = runPolicyEngine(robot, cmd, speed);
  const safetyResult = runSafetyEnvelope([robotId], cmd, speed);

  const resultEl = document.getElementById('simResult');
  const verdictEl = document.getElementById('simVerdict');
  const rulesEl = document.getElementById('simRulesList');

  resultEl.classList.remove('hidden');
  verdictEl.textContent = decision.status;
  verdictEl.className = `sim-verdict ${decision.status === 'APPROVED' ? 'badge-approved' : 'badge-blocked'}`;

  rulesEl.innerHTML = decision.rulesApplied.map(r => `
    <div class="rule-applied-item ${r.type === 'block' ? 'block' : r.type === 'warn' ? 'warn' : ''}">
      <i class="fas ${r.type === 'block' ? 'fa-ban' : r.type === 'warn' ? 'fa-triangle-exclamation' : 'fa-check'}"
         style="color:${r.type === 'block' ? 'var(--danger)' : r.type === 'warn' ? 'var(--accent)' : 'var(--success)'}"></i>
      <span>${r.id}: ${r.desc}</span>
    </div>
  `).join('');

  if (!safetyResult.passed) {
    rulesEl.innerHTML += `
      <div class="rule-applied-item block">
        <i class="fas fa-lock" style="color:var(--danger)"></i>
        <span>Safety Envelope: ${safetyResult.reason}</span>
      </div>`;
  }

  if (decision.reason) {
    rulesEl.innerHTML += `<div style="margin-top:.5rem;font-size:11px;color:var(--danger)"><i class="fas fa-circle-info"></i> ${decision.reason}</div>`;
  }
  if (decision.fix) {
    rulesEl.innerHTML += `<div style="margin-top:.25rem;font-size:11px;color:var(--accent)"><i class="fas fa-lightbulb"></i> ${decision.fix}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { approved: 'fa-circle-check', blocked: 'fa-ban', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || 'fa-circle-info'}"></i> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
function generateId() {
  return 'xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 5000) return 'Now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function formatUptime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ═══════════════════════════════════════════════════════════════
   LOG PANEL — RESIZE & EXPAND
═══════════════════════════════════════════════════════════════ */
function bindLogResizer() {
  const panel   = document.getElementById('panelLog');
  const handle  = document.getElementById('logResizeHandle');
  const expandBtn  = document.getElementById('logExpandBtn');
  const expandIcon = document.getElementById('logExpandIcon');
  const tableWrap  = document.getElementById('logTableWrap');

  if (!panel) return;

  /* ── EXPAND / COLLAPSE TOGGLE ── */
  let isExpanded = false;
  const COLLAPSED_HEIGHT = null;   // set on first collapse from expanded

  expandBtn?.addEventListener('click', () => {
    isExpanded = !isExpanded;

    if (isExpanded) {
      // Save current panel height then remove grid constraint
      panel.style.height = 'auto';
      panel.style.maxHeight = 'none';
      if (tableWrap) { tableWrap.style.maxHeight = 'none'; tableWrap.style.flex = '1'; }
      panel.classList.add('expanded');
      expandIcon.classList.remove('fa-expand-alt');
      expandIcon.classList.add('fa-compress-alt');
      expandBtn.title = 'Collapse log';
      showToast('Log expanded', 'info');
    } else {
      // Return to default constrained size
      panel.style.height = '';
      panel.style.maxHeight = '';
      if (tableWrap) { tableWrap.style.maxHeight = ''; tableWrap.style.flex = ''; }
      panel.classList.remove('expanded');
      expandIcon.classList.remove('fa-compress-alt');
      expandIcon.classList.add('fa-expand-alt');
      expandBtn.title = 'Expand / Collapse log';
    }
  });

  /* ── DRAG-TO-RESIZE (desktop / tablet) ── */
  if (!handle) return;

  let startY = 0;
  let startH = 0;
  let dragging = false;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    handle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  // Touch support
  handle.addEventListener('touchstart', e => {
    dragging = true;
    startY = e.touches[0].clientY;
    startH = panel.getBoundingClientRect().height;
    handle.classList.add('dragging');
  }, { passive: true });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const newH = Math.max(80, startH + delta);
    panel.style.height = newH + 'px';
    panel.style.maxHeight = newH + 'px';
    // Remove grid auto sizing
    if (tableWrap) {
      const headerH = panel.querySelector('.panel-header')?.getBoundingClientRect().height || 44;
      const resizeHandleH = 6;
      tableWrap.style.maxHeight = (newH - headerH - resizeHandleH - 8) + 'px';
    }
  });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const delta = e.touches[0].clientY - startY;
    const newH = Math.max(80, startH + delta);
    panel.style.height = newH + 'px';
    panel.style.maxHeight = newH + 'px';
    if (tableWrap) {
      const headerH = panel.querySelector('.panel-header')?.getBoundingClientRect().height || 44;
      tableWrap.style.maxHeight = (newH - headerH - 14) + 'px';
    }
  }, { passive: true });

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('touchend', stopDrag);

  /* ── Double-click handle to reset to auto ── */
  handle.addEventListener('dblclick', () => {
    panel.style.height = '';
    panel.style.maxHeight = '';
    if (tableWrap) { tableWrap.style.maxHeight = ''; }
    showToast('Log panel reset to default size', 'info');
  });
}

/* ── SEED DEMO LOG ── */
function seedDemoLog() {
  if (STATE.auditLog.length > 0) return;
  const baseTime = Date.now() - 5 * 60 * 1000;
  const entries = [
    { command: 'START_AUTONOMY', robots: 'R-01', validation: 'APPROVED', execution: 'EXECUTED', rule: 'Rule 1', notes: 'Autonomy started', speed: 0, safetyCheck: 'PASSED', handshakeVerified: true, dispatchStatus: 'SENT', ackState: 'completed' },
    { command: 'TURN_RIGHT',     robots: 'R-02', validation: 'APPROVED', execution: 'EXECUTED', rule: 'Rule 2', notes: '', speed: 30, safetyCheck: 'PASSED', handshakeVerified: true, dispatchStatus: 'SENT', ackState: 'completed' },
    { command: 'MOVE_FORWARD',   robots: 'R-02', validation: 'BLOCKED',  execution: 'NOT EXECUTED', rule: 'Rule 3', notes: 'Speed 66 cm/s exceeds indoor limit of 60 cm/s', speed: 66, safetyCheck: 'SKIPPED', handshakeVerified: null, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed' },
    { command: 'TURN_LEFT',      robots: 'R-02', validation: 'APPROVED', execution: 'EXECUTED', rule: '—', notes: '', speed: 30, safetyCheck: 'PASSED', handshakeVerified: true, dispatchStatus: 'SENT', ackState: 'completed' },
    { command: 'MOVE_FORWARD',   robots: 'R-02', validation: 'APPROVED', execution: 'EXECUTED', rule: '—', notes: '', speed: 55, safetyCheck: 'PASSED', handshakeVerified: true, dispatchStatus: 'SENT', ackState: 'completed' },
  ];
  [...entries].reverse().forEach((e, i) => {
    const entry = addAuditLogEntry({ ...e });
    entry.timestamp = baseTime + (i * 60000);
    const d = new Date(entry.timestamp);
    entry.time = d.toLocaleTimeString();
  });
  STATE.auditLog.sort((a, b) => b.timestamp - a.timestamp);
}

/* ═══════════════════════════════════════════════════════════════
   MANUAL COMMAND INPUT
═══════════════════════════════════════════════════════════════ */
function bindManualCommandInput() {
  const toggle = document.getElementById('manualCmdToggle');
  const body = document.getElementById('manualCmdBody');
  const icon = document.getElementById('manualToggleIcon');
  const sendBtn = document.getElementById('sendManualCmdBtn');
  const checksContainer = document.getElementById('manualRobotChecks');

  if (!toggle || !body) return;

  // Render robot checkboxes
  function renderManualRobotChecks() {
    if (!checksContainer) return;
    checksContainer.innerHTML = '';
    Object.values(STATE.robots).forEach(robot => {
      const label = document.createElement('label');
      label.className = 'manual-robot-check-label';
      label.innerHTML = `
        <input type="checkbox" class="manual-robot-check" value="${robot.id}"
          ${STATE.selectedRobots.has(robot.id) ? 'checked' : ''}
          ${!robot.connected ? 'data-offline="true"' : ''} />
        <span class="conn-dot ${robot.connected ? 'connected' : 'disconnected'}" style="width:7px;height:7px;margin-right:4px;"></span>
        ${robot.id} <span class="muted" style="font-size:10px;">(${robot.name})</span>
        ${!robot.connected ? '<span class="muted" style="font-size:10px;"> — offline</span>' : ''}
      `;
      checksContainer.appendChild(label);
    });
  }

  // Toggle open/close
  toggle.addEventListener('click', () => {
    const isOpen = !body.classList.contains('hidden');
    if (isOpen) {
      body.classList.add('hidden');
      icon.classList.remove('fa-chevron-up');
      icon.classList.add('fa-chevron-down');
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      body.classList.remove('hidden');
      icon.classList.remove('fa-chevron-down');
      icon.classList.add('fa-chevron-up');
      toggle.setAttribute('aria-expanded', 'true');
      renderManualRobotChecks();
    }
  });

  // Send button
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      await sendManualCommand();
    });
  }
}

async function sendManualCommand() {
  const nameInput = document.getElementById('manualCmdName');
  const paramsInput = document.getElementById('manualCmdParams');
  const statusEl = document.getElementById('manualCmdStatus');
  const checksContainer = document.getElementById('manualRobotChecks');

  const cmdName = nameInput?.value.trim().toUpperCase().replace(/\s+/g, '_');
  if (!cmdName) {
    showManualCmdStatus('error', 'Command name is required');
    return;
  }

  // Parse JSON params
  let params = {};
  const rawParams = paramsInput?.value.trim();
  if (rawParams) {
    try {
      params = JSON.parse(rawParams);
    } catch {
      showManualCmdStatus('error', 'Invalid JSON in parameters');
      return;
    }
  }

  // Get selected robots
  const checkedBoxes = checksContainer?.querySelectorAll('.manual-robot-check:checked') || [];
  const targets = [...checkedBoxes].map(cb => cb.value);
  if (targets.length === 0) {
    showManualCmdStatus('error', 'Select at least one target robot');
    return;
  }

  const speed = params.speed ? parseInt(params.speed) : parseInt(document.getElementById('speedSlider')?.value || 60);

  showManualCmdStatus('pending', `Validating ${cmdName} → ${targets.join(', ')}…`);

  const requestId = generateId();
  const policyDecisionId = generateId();

  await delay(400);

  // Run through policy engine
  const decisions = {};
  let allApproved = true;
  targets.forEach(id => {
    const robot = STATE.robots[id];
    const decision = runPolicyEngine(robot, cmdName, speed);
    decisions[id] = decision;
    if (decision.status !== 'APPROVED') allApproved = false;
  });

  const combinedRulesApplied = [];
  const blockReasons = [];
  targets.forEach(id => {
    decisions[id].rulesApplied.forEach(r => {
      if (!combinedRulesApplied.find(x => x.id === r.id)) combinedRulesApplied.push(r);
    });
    if (decisions[id].status === 'BLOCKED') blockReasons.push(`${id}: ${decisions[id].reason}`);
  });

  const policyStatus = allApproved ? 'APPROVED'
    : STATE.policyMode === 'training' ? 'WOULD_BLOCK' : 'BLOCKED';

  if (policyStatus === 'BLOCKED') {
    showManualCmdStatus('blocked', `Blocked: ${blockReasons[0] || 'Policy violation'}`);
    addAuditLogEntry({
      requestId, policyDecisionId,
      command: cmdName, robots: targets.join(', '),
      validation: 'BLOCKED', execution: 'NOT EXECUTED',
      rule: combinedRulesApplied.filter(r => r.type === 'block').map(r => r.id).join(', ') || '—',
      notes: `Manual input blocked: ${blockReasons.join('; ')}`,
      speed, safetyCheck: 'SKIPPED',
      handshakeVerified: null, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed',
    });
    saveState(); renderAuditLog(); renderFullAuditLog();
    return;
  }

  // Safety envelope
  const safetyResult = runSafetyEnvelope(targets, cmdName, speed);
  const safetyStatus = safetyResult.passed ? 'PASSED' : (STATE.policyMode === 'training' ? 'WARN' : 'BLOCKED');
  if (!safetyResult.passed && STATE.policyMode === 'strict') {
    showManualCmdStatus('blocked', `Safety block: ${safetyResult.reason}`);
    addAuditLogEntry({
      requestId, policyDecisionId,
      command: cmdName, robots: targets.join(', '),
      validation: policyStatus, execution: 'NOT EXECUTED',
      rule: 'SAFETY-ENV', notes: safetyResult.reason,
      speed, safetyCheck: 'BLOCKED',
      handshakeVerified: null, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed',
    });
    saveState(); renderAuditLog(); renderFullAuditLog();
    return;
  }

  // Handshake check
  const hsOk = targets.every(id => {
    const robot = STATE.robots[id];
    return robot && (robot.handshakeStatus === 'verified' || !robot.connected);
  });
  if (!hsOk) {
    const failedRobots = targets.filter(id => STATE.robots[id]?.handshakeStatus !== 'verified').join(', ');
    showManualCmdStatus('blocked', `Handshake not verified: ${failedRobots}`);
    addAuditLogEntry({
      requestId, policyDecisionId,
      command: cmdName, robots: targets.join(', '),
      validation: policyStatus, execution: 'NOT EXECUTED',
      rule: 'HANDSHAKE', notes: `Manual input: handshake failed for ${failedRobots}`,
      speed, safetyCheck: safetyStatus,
      handshakeVerified: false, dispatchStatus: 'NOT DISPATCHED', ackState: 'Not Executed',
    });
    saveState(); renderAuditLog(); renderFullAuditLog();
    return;
  }

  // Enqueue
  const queueItem = enqueueCommand({
    requestId, policyDecisionId,
    command: cmdName, targets, speed,
    policyStatus, safetyStatus,
    rules: combinedRulesApplied,
    overrideStatus: policyStatus === 'WOULD_BLOCK' ? 'WOULD_BLOCK' : null,
  });

  showManualCmdStatus('approved', `Queued [${queueItem.queueId.slice(0,6)}] — awaiting execution`);
  renderCommandQueue();
  showToast(`Manual: ${cmdName} → ${targets.join(', ')} queued`, 'approved');
}

function showManualCmdStatus(type, message) {
  const el = document.getElementById('manualCmdStatus');
  if (!el) return;
  el.classList.remove('hidden');
  el.className = `manual-cmd-status manual-status-${type}`;
  const icon = type === 'approved' ? 'fa-check-circle'
    : type === 'blocked' ? 'fa-ban'
    : type === 'pending' ? 'fa-spinner fa-spin'
    : 'fa-circle-xmark';
  el.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
}


function bindPasswordToggle() {
  const toggleBtn = document.getElementById('passwordToggleBtn');
  const pwInput = document.getElementById('password');
  const icon = document.getElementById('passwordToggleIcon');
  if (!toggleBtn || !pwInput || !icon) return;

  toggleBtn.addEventListener('click', () => {
    const showing = pwInput.type === 'text';
    pwInput.type = showing ? 'password' : 'text';
    icon.classList.toggle('fa-eye', showing);
    icon.classList.toggle('fa-eye-slash', !showing);
    toggleBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggleBtn.setAttribute('aria-pressed', String(!showing));
  });
}

const CONTRAST_SCENARIOS = {
  'Unsafe Speed': {
    standard: ['Received', 'Command mapped to control loop', 'Sent', 'Actuated'],
    governed: ['Authority check complete', 'Policy validation failed', 'Execution decision: blocked', 'Blocked + logged'],
    decision: 'BLOCKED',
    decisionReason: 'Rule R-01 max speed exceeded',
    operatorStatus: 'Alert',
    authorityLevel: 'Restricted',
    commandRestriction: 'Speed-limited',
    expectedPattern: 'Speed < 60 indoor',
    currentPattern: 'Speed request 90',
    deviationAlert: 'Critical',
    configChange: 'Motor limit override',
    approvalRequirement: 'Supervisor + policy',
    approvalResult: 'Denied',
    faultDetected: 'Overspeed risk',
    correction: 'Throttle to 55',
    updateStatus: 'Patch not required',
    riskLevel: 'Elevated',
    policyEngine: 'Online',
    authorityNote: 'Policy Engine BLOCKS command before Robot Execution.',
    timeline: [
      { t: '00:00', label: 'Command Issued' },
      { t: '00:01', label: 'Planner Request' },
      { t: '00:01', label: 'Governance Check', intervention: true },
      { t: '00:02', label: 'Rule Triggered', intervention: true },
      { t: '00:02', label: 'Command Blocked', badge: '⚠ POLICY BLOCK', intervention: true },
      { t: '00:02', label: 'Audit Logged' },
    ],
    badges: ['⚠ POLICY BLOCK']
  },
  'Operator Fatigue': {
    standard: ['Received', 'Planner active', 'Sent', 'Actuated'],
    governed: ['Authority check complete', 'Policy validation passed', 'Execution decision: safe stop', 'Safe stop + logged'],
    decision: 'SAFE STOP',
    decisionReason: 'Operator vigilance threshold failed',
    operatorStatus: 'Fatigued', authorityLevel: 'Restricted', commandRestriction: 'Manual-only',
    expectedPattern: 'Stable operator biometrics', currentPattern: 'High fatigue score', deviationAlert: 'Elevated',
    configChange: 'N/A', approvalRequirement: 'N/A', approvalResult: 'N/A',
    faultDetected: 'Human-factor risk', correction: 'Require relief operator', updateStatus: 'Pending reassignment',
    riskLevel: 'Elevated',
    policyEngine: 'Online',
    authorityNote: 'Operator state flagged, authority reduced, command restricted to safe stop.',
    timeline: [
      { t: '00:00', label: 'Command Issued' },
      { t: '00:01', label: 'Planner Request' },
      { t: '00:01', label: 'Governance Check', intervention: true },
      { t: '00:02', label: 'Rule Triggered', intervention: true },
      { t: '00:02', label: 'Safe Stop Triggered', badge: '🛑 SAFE STOP', intervention: true },
      { t: '00:02', label: 'Audit Logged' },
    ],
    badges: ['🛑 SAFE STOP']
  },
  'Sensor Glitch': {
    standard: ['Received', 'Planner active', 'Sent', 'Actuated'],
    governed: ['Authority check complete', 'Policy validation failed', 'Execution decision: blocked', 'Blocked + logged'],
    decision: 'BLOCKED', decisionReason: 'Sensor confidence dropped below baseline',
    operatorStatus: 'Normal', authorityLevel: 'Operator', commandRestriction: 'No autonomy',
    expectedPattern: 'Consistent IMU + lidar', currentPattern: 'Intermittent sensor spikes', deviationAlert: 'Elevated',
    configChange: 'Sensor recalibration', approvalRequirement: 'Policy check', approvalResult: 'Approved',
    faultDetected: 'IMU jitter', correction: 'Switch to fallback sensor fusion', updateStatus: 'Applied',
    riskLevel: 'Critical',
    policyEngine: 'Online',
    authorityNote: 'Anomaly monitor intervenes; unsafe execution path is blocked.',
    timeline: [
      { t: '00:00', label: 'Command Issued' },
      { t: '00:01', label: 'Planner Request' },
      { t: '00:01', label: 'Governance Check', intervention: true },
      { t: '00:02', label: 'Rule Triggered', badge: '🔍 ANOMALY DETECTED', intervention: true },
      { t: '00:02', label: 'Command Blocked', badge: '⚠ POLICY BLOCK', intervention: true },
      { t: '00:02', label: 'Audit Logged' },
    ],
    badges: ['🔍 ANOMALY DETECTED', '⚠ POLICY BLOCK']
  },
  'Fragile Object': {
    standard: ['Received', 'Planner active', 'Sent', 'Actuated'],
    governed: ['Authority check complete', 'Policy validation passed', 'Execution decision: approved', 'Approved + logged'],
    decision: 'APPROVED', decisionReason: 'Precision mode constraints satisfied',
    operatorStatus: 'Normal', authorityLevel: 'Operator', commandRestriction: 'Low-force only',
    expectedPattern: 'Soft trajectory profile', currentPattern: 'Within tolerance', deviationAlert: 'Nominal',
    configChange: 'Grip-force profile', approvalRequirement: 'Dual approval', approvalResult: 'Approved',
    faultDetected: 'No fault', correction: 'Maintain precision profile', updateStatus: 'Stable',
    riskLevel: 'Nominal',
    policyEngine: 'Online',
    authorityNote: 'Mission policy constrains motion profile and allows safe execution.',
    timeline: [
      { t: '00:00', label: 'Command Issued' },
      { t: '00:01', label: 'Planner Request' },
      { t: '00:01', label: 'Governance Check', intervention: true },
      { t: '00:02', label: 'Rule Triggered', intervention: true },
      { t: '00:02', label: 'Command Approved' },
      { t: '00:02', label: 'Audit Logged' },
    ],
    badges: []
  },
  'Config Change': {
    standard: ['Received', 'Planner active', 'Sent', 'Actuated'],
    governed: ['Authority check complete', 'Policy validation failed', 'Execution decision: blocked', 'Logged'],
    decision: 'BLOCKED', decisionReason: 'Unapproved configuration mutation',
    operatorStatus: 'Normal', authorityLevel: 'Supervisor', commandRestriction: 'No config writes',
    expectedPattern: 'Read-only operation', currentPattern: 'Config write request', deviationAlert: 'Elevated',
    configChange: 'Navigation stack edit', approvalRequirement: 'Supervisor sign-off', approvalResult: 'Rejected',
    faultDetected: 'Config drift attempt', correction: 'Rollback + lock config', updateStatus: 'Locked',
    riskLevel: 'Elevated',
    policyEngine: 'Online',
    authorityNote: 'Policy requires supervisor authority; change denied at policy checkpoint.',
    timeline: [
      { t: '00:00', label: 'Command Issued' },
      { t: '00:01', label: 'Planner Request' },
      { t: '00:01', label: 'Governance Check', intervention: true },
      { t: '00:02', label: 'Rule Triggered', intervention: true },
      { t: '00:02', label: 'Change Denied', badge: '⚠ POLICY BLOCK', intervention: true },
      { t: '00:02', label: 'Audit Logged' },
    ],
    badges: ['⚠ POLICY BLOCK']
  },
  'Diagnostic Fault': {
    standard: ['Received', 'Planner active', 'Sent', 'Actuation fault'],
    governed: ['Authority check complete', 'Policy validation passed', 'Execution decision: safe stop', 'Logged + repair suggested'],
    decision: 'SAFE STOP', decisionReason: 'Actuator fault confidence high',
    operatorStatus: 'Normal', authorityLevel: 'Restricted', commandRestriction: 'Diagnostics only',
    expectedPattern: 'Nominal motor current', currentPattern: 'Current spike burst', deviationAlert: 'Critical',
    configChange: 'Firmware patch', approvalRequirement: 'Maintenance approval', approvalResult: 'Approved',
    faultDetected: 'Motor controller fault', correction: 'Load fallback profile + reboot', updateStatus: 'In progress',
    riskLevel: 'Critical',
    policyEngine: 'Degraded',
    authorityNote: 'Safety envelope overrides command and moves system to safe stop path.',
    timeline: [
      { t: '00:00', label: 'Command Issued' },
      { t: '00:01', label: 'Planner Request' },
      { t: '00:01', label: 'Governance Check', intervention: true },
      { t: '00:02', label: 'Rule Triggered', badge: '🔍 ANOMALY DETECTED', intervention: true },
      { t: '00:02', label: 'Safe Stop Triggered', badge: '🛑 SAFE STOP', intervention: true },
      { t: '00:02', label: 'Audit Logged' },
    ],
    badges: ['🔍 ANOMALY DETECTED', '🛑 SAFE STOP']
  },
};

function bindContrastPage() {
  const switcher = document.getElementById('contrastScenarioSwitcher');
  if (switcher) {
    switcher.querySelectorAll('.contrast-segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        STATE.contrastScenario = btn.dataset.scenario;
        renderContrastPage();
      });
    });
  }

  document.getElementById('governanceOffBtn')?.addEventListener('click', () => {
    STATE.contrastGovernance = false;
    renderContrastPage();
  });
  document.getElementById('governanceOnBtn')?.addEventListener('click', () => {
    STATE.contrastGovernance = true;
    renderContrastPage();
  });

  document.getElementById('replayScenarioBtn')?.addEventListener('click', replayContrastScenario);
  renderContrastPage();
}

function renderContrastPage() {
  const scenario = CONTRAST_SCENARIOS[STATE.contrastScenario] || CONTRAST_SCENARIOS['Unsafe Speed'];
  const effectiveDecision = STATE.contrastGovernance ? scenario.decision : 'APPROVED';
  const effectiveReason = STATE.contrastGovernance ? scenario.decisionReason : 'Direct execution path active';

  document.querySelectorAll('.contrast-segment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scenario === STATE.contrastScenario);
  });
  document.getElementById('governanceOffBtn')?.classList.toggle('active', !STATE.contrastGovernance);
  document.getElementById('governanceOnBtn')?.classList.toggle('active', STATE.contrastGovernance);

  const standardRows = [
    ['Command Received', scenario.standard[0]],
    ['Planner Active', scenario.standard[1]],
    ['Execution Sent', scenario.standard[2]],
    ['Result', scenario.standard[3]],
  ];
  const governedRows = [
    ['Command Received', 'Queued for governance'],
    ['Pipeline State', scenario.governed[1]],
    ['Decision', effectiveDecision],
    ['Audit', scenario.governed[3]],
  ];
  renderStatusRows('standardStatusList', standardRows);
  renderStatusRows('governedStatusList', governedRows);

  renderInfoRows('decisionTraceability', [
    ['command ID', generateId().slice(0, 8)],
    ['rule triggered', effectiveReason],
    ['decision', effectiveDecision],
    ['timestamp', new Date().toLocaleTimeString()],
  ]);
  renderInfoRows('operatorStateCard', [
    ['operator status', scenario.operatorStatus],
    ['authority level', STATE.contrastGovernance ? scenario.authorityLevel : 'Operator'],
    ['command restriction', STATE.contrastGovernance ? scenario.commandRestriction : 'None'],
  ]);
  renderInfoRows('anomalyDetectionCard', [
    ['expected pattern', scenario.expectedPattern],
    ['current pattern', scenario.currentPattern],
    ['deviation alert', STATE.contrastGovernance ? scenario.deviationAlert : 'Bypassed'],
  ]);
  renderInfoRows('configurationGovernanceCard', [
    ['attempted config change', scenario.configChange],
    ['approval requirement', STATE.contrastGovernance ? scenario.approvalRequirement : 'Not required'],
    ['approval result', STATE.contrastGovernance ? scenario.approvalResult : 'Auto-applied'],
  ]);
  renderInfoRows('diagnosticRepairCard', [
    ['fault detected', scenario.faultDetected],
    ['suggested correction', scenario.correction],
    ['system update status', scenario.updateStatus],
  ]);

  renderInterventionBadges(scenario);
  renderDecisionTimeline(scenario, null);
  renderSystemBanner(scenario);
  renderAuthorityChain(scenario, null);
}

function renderStatusRows(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = rows.map(([k, v]) => `<div class="contrast-status-row"><span>${k}</span><span>${v}</span></div>`).join('');
}

function renderInfoRows(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = rows.map(([k, v]) => `<div class="contrast-info-row"><span>${k}</span><span>${v}</span></div>`).join('');
}

function renderInterventionBadges(scenario) {
  const el = document.getElementById('contrastInterventionBadges');
  if (!el) return;
  const badges = STATE.contrastGovernance ? scenario.badges : [];
  if (!badges.length) {
    el.innerHTML = '<span class="policy-status-badge badge-approved">NO INTERVENTION</span>';
    return;
  }
  el.innerHTML = badges.map(b => `<span class="contrast-intervention-badge">${b}</span>`).join('');
}

function renderDecisionTimeline(scenario, progress) {
  const el = document.getElementById('contrastTimeline');
  if (!el) return;
  const max = progress === null ? scenario.timeline.length - 1 : progress;
  el.innerHTML = scenario.timeline.map((item, idx) => {
    const active = idx <= max ? ' active' : '';
    const intervention = item.intervention ? ' intervention' : '';
    const badge = item.badge ? `<span class="contrast-timeline-badge">${item.badge}</span>` : '';
    return `<div class="contrast-timeline-event${active}${intervention}"><div class="contrast-timeline-time">${item.t}</div><div class="contrast-timeline-label">${item.label}</div>${badge}</div>`;
  }).join('');
}

function renderSystemBanner(scenario) {
  const mode = STATE.contrastGovernance ? 'Governed' : 'Direct';
  const authority = STATE.contrastGovernance ? scenario.authorityLevel : 'Operator';
  const risk = STATE.contrastGovernance ? scenario.riskLevel : 'Nominal';
  const policyEngine = STATE.contrastGovernance ? scenario.policyEngine : 'Bypassed';

  const modeEl = document.getElementById('contrastExecMode');
  const authEl = document.getElementById('contrastAuthority');
  const riskEl = document.getElementById('contrastRiskLevel');
  const policyEl = document.getElementById('contrastPolicyEngine');
  if (!modeEl || !authEl || !riskEl || !policyEl) return;

  modeEl.textContent = mode;
  authEl.textContent = authority;
  riskEl.textContent = risk;
  policyEl.textContent = policyEngine;

  riskEl.classList.remove('is-nominal', 'is-elevated', 'is-critical');
  riskEl.classList.add(risk === 'Critical' ? 'is-critical' : risk === 'Elevated' ? 'is-elevated' : 'is-nominal');
}

function renderAuthorityChain(scenario, highlightIndex) {
  const steps = [...document.querySelectorAll('.contrast-authority-step')];
  if (!steps.length) return;
  steps.forEach((step, i) => {
    step.classList.toggle('active', highlightIndex === i);
    step.classList.toggle('done', highlightIndex !== null && i < highlightIndex);
  });
  const note = document.getElementById('contrastAuthorityNote');
  if (note) note.textContent = STATE.contrastGovernance ? scenario.authorityNote : 'Direct path: operator command passes straight to robot execution.';
}

function replayContrastScenario() {
  if (STATE.contrastReplayTimer) {
    clearTimeout(STATE.contrastReplayTimer);
    STATE.contrastReplayTimer = null;
  }

  const scenario = CONTRAST_SCENARIOS[STATE.contrastScenario] || CONTRAST_SCENARIOS['Unsafe Speed'];
  const standardSteps = [...document.querySelectorAll('#standardPipeline .contrast-step')];
  const governedSteps = [...document.querySelectorAll('#governedPipeline .contrast-step')];
  [...standardSteps, ...governedSteps].forEach(step => step.classList.remove('active', 'done'));

  const setStepState = (steps, activeIndex) => {
    steps.forEach((step, i) => {
      step.classList.toggle('active', i === activeIndex);
      step.classList.toggle('done', i < activeIndex);
    });
  };

  renderDecisionTimeline(scenario, -1);
  renderAuthorityChain(scenario, 0);
  showToast('Step 1: Operator Command received', 'info');
  addGovernanceEvent({ severity: 'INFO', category: 'Governance', title: 'Scenario Replay Triggered', description: `${STATE.contrastScenario} replay initiated.`, relatedTimeline: 'Command Issued', relatedAuthorityIndex: 0 });

  // ~2s total timeline
  setTimeout(() => {
    let i = 0;
    const intv = setInterval(() => {
      setStepState(standardSteps, i);
      renderDecisionTimeline(scenario, Math.min(i + 1, scenario.timeline.length - 1));
      i += 1;
      if (i >= standardSteps.length) clearInterval(intv);
    }, 140);
  }, 120);

  setTimeout(() => {
    showToast('Step 3: Governance checks activating', 'info');
    addGovernanceEvent({ severity: 'WARNING', category: 'Governance', title: 'Governance Check', description: 'Policy and safety checkpoints engaged.', relatedTimeline: 'Governance Check', relatedAuthorityIndex: 2 });
    renderAuthorityChain(scenario, 1);
    if (STATE.contrastGovernance) {
      let g = 1;
      const intv = setInterval(() => {
        setStepState(governedSteps, g);
        renderDecisionTimeline(scenario, Math.min(g + 2, scenario.timeline.length - 1));
        if (g === 2) renderAuthorityChain(scenario, 1);
        if (g === 3) renderAuthorityChain(scenario, 2);
        if (g === 4) renderAuthorityChain(scenario, 2);
        g += 1;
        if (g >= governedSteps.length) clearInterval(intv);
      }, 120);
    } else {
      setStepState(governedSteps, governedSteps.length - 1);
    }
  }, 850);

  STATE.contrastReplayTimer = setTimeout(() => {
    const decision = STATE.contrastGovernance ? scenario.decision : 'APPROVED';
    const toastType = decision === 'APPROVED' ? 'approved' : decision === 'SAFE STOP' ? 'warning' : 'blocked';
    showToast(`Step 4: ${decision} · Audit logged`, toastType);
    addGovernanceEvent({ severity: decision === 'APPROVED' ? 'INFO' : decision === 'SAFE STOP' ? 'CRITICAL' : 'WARNING', category: decision === 'SAFE STOP' ? 'Safety' : 'Governance', title: `Execution ${decision}`, description: `${STATE.contrastScenario} completed with ${decision}.`, relatedTimeline: 'Rule Triggered', relatedAuthorityIndex: decision === 'APPROVED' ? 4 : 2 });
    renderDecisionTimeline(scenario, scenario.timeline.length - 1);
    renderAuthorityChain(scenario, decision === 'APPROVED' ? 4 : 2);
    renderSystemBanner(scenario);
    renderInterventionBadges(scenario);
  }, 2100);
}


/* ═══════════════════════════════════════════════════════════════
   GOVERNANCE EVENT FEED
═══════════════════════════════════════════════════════════════ */
const GOVERNANCE_EVENT_TEMPLATES = (() => {
  const robots = ['R-01', 'R-02', 'R-03'];
  const templates = [];

  const push = (severity, category, title, description) => templates.push({ severity, category, title, description });

  robots.forEach(id => {
    push('INFO', 'Robot', `${id} Connected`, `${id} accepted control handshake and heartbeat.`);
    push('WARNING', 'Robot', `${id} Link Degraded`, `${id} latency increased above nominal control threshold.`);
    push('CRITICAL', 'Robot', `${id} Disconnected`, `${id} heartbeat timeout detected by control station.`);
  });

  [45, 52, 58, 61, 67, 72, 79, 84, 91].forEach(speed => {
    push(speed > 80 ? 'CRITICAL' : 'WARNING', 'Governance', 'Policy Check Triggered', `Requested speed ${speed} cm/s evaluated against mission constraints.`);
  });

  [9, 12, 16, 22, 28, 34, 41, 48, 56, 63].forEach(battery => {
    push(battery < 15 ? 'CRITICAL' : 'WARNING', 'Safety', 'Battery Threshold Alert', `Battery at ${battery}% requires restricted operation profile.`);
  });

  [
    ['INFO', 'System', 'Policy Engine Online', 'Governance core responding within nominal latency window.'],
    ['WARNING', 'System', 'Policy Engine Degraded', 'Validation latency elevated, monitoring active.'],
    ['CRITICAL', 'System', 'Policy Engine Offline', 'Fallback safety interlocks active until recovery.'],
    ['INFO', 'Audit', 'Entry Created', 'Governance decision persisted to audit ledger.'],
    ['WARNING', 'Authority', 'Authority Restricted', 'Operator authority reduced by state guardrails.'],
    ['CRITICAL', 'Safety', 'Safe Stop Triggered', 'Command stream halted by safety envelope.'],
    ['INFO', 'Governance', 'Command Approved', 'Policy and safety checks passed for dispatch.'],
    ['WARNING', 'Governance', 'Policy Block', 'Command denied due to active mission policy.'],
    ['INFO', 'System', 'Simulation Feed Active', 'Governance Event Feed emitting structured demo events.'],
    ['INFO', 'System', 'Live Feed Active', 'Governance Event Feed switched to live operational signals.'],
  ].forEach(([sev, cat, title, desc]) => push(sev, cat, title, desc));

  // Build up to ~70 structured templates
  while (templates.length < 72) {
    const r = robots[templates.length % robots.length];
    const offset = templates.length % 7;
    push('INFO', 'Governance', `Policy Validation Cycle ${templates.length - 35}`, `${r} command validation pass completed (window ${offset + 1}).`);
  }

  return templates;
})();

function bindGovernanceEventFeed() {
  document.getElementById('feedModeDemoBtn')?.addEventListener('click', () => setGovernanceFeedMode('demo'));
  document.getElementById('feedModeLiveBtn')?.addEventListener('click', () => setGovernanceFeedMode('live'));
  document.getElementById('feedModeDemoBtnMobile')?.addEventListener('click', () => setGovernanceFeedMode('demo'));
  document.getElementById('feedModeLiveBtnMobile')?.addEventListener('click', () => setGovernanceFeedMode('live'));

  document.getElementById('eventsDrawerBtn')?.addEventListener('click', () => openEventsDrawer());
  document.getElementById('closeEventsDrawerBtn')?.addEventListener('click', () => closeEventsDrawer());
  document.getElementById('eventsDrawerOverlay')?.addEventListener('click', () => closeEventsDrawer());

  renderGovernanceEventFeed();
}

function setGovernanceFeedMode(mode) {
  STATE.governanceFeedMode = mode;
  document.getElementById('feedModeDemoBtn')?.classList.toggle('active', mode === 'demo');
  document.getElementById('feedModeLiveBtn')?.classList.toggle('active', mode === 'live');
  document.getElementById('feedModeDemoBtnMobile')?.classList.toggle('active', mode === 'demo');
  document.getElementById('feedModeLiveBtnMobile')?.classList.toggle('active', mode === 'live');

  addGovernanceEvent({
    severity: 'INFO',
    category: 'System',
    title: mode === 'demo' ? 'Demo Feed Enabled' : 'Live Feed Enabled',
    description: mode === 'demo' ? 'Simulation stream active (2–4s structured cadence).' : 'Only real operational events are displayed.',
  });

  startGovernanceEventStream();
  renderGovernanceEventFeed();
}

function startGovernanceEventStream() {
  stopGovernanceEventStream();
  if (STATE.governanceFeedMode !== 'demo') return;

  const tick = () => {
    if (STATE.governanceFeedMode !== 'demo') return;
    const tpl = GOVERNANCE_EVENT_TEMPLATES[Math.floor(Math.random() * GOVERNANCE_EVENT_TEMPLATES.length)];
    addGovernanceEvent({ ...tpl });
    const delay = 2000 + Math.floor(Math.random() * 2000);
    STATE.governanceFeedInterval = setTimeout(tick, delay);
  };

  STATE.governanceFeedInterval = setTimeout(tick, 1200);
}

function stopGovernanceEventStream() {
  if (STATE.governanceFeedInterval) {
    clearTimeout(STATE.governanceFeedInterval);
    STATE.governanceFeedInterval = null;
  }
}

function addGovernanceEvent(evt) {
  const now = new Date();
  const event = {
    id: `GE-${now.getTime()}-${Math.floor(Math.random() * 9999)}`,
    timestamp: now.getTime(),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    severity: evt.severity || 'INFO',
    category: evt.category || 'System',
    title: evt.title || 'Operational Event',
    description: evt.description || '',
    relatedTimeline: evt.relatedTimeline || null,
    relatedAuthorityIndex: evt.relatedAuthorityIndex ?? null,
    relatedAuditId: evt.relatedAuditId || null,
  };

  STATE.governanceEvents.unshift(event);
  if (STATE.governanceEvents.length > 50) STATE.governanceEvents = STATE.governanceEvents.slice(0, 50);
  renderGovernanceEventFeed(event.id);
}

function renderGovernanceEventFeed(newId = null) {
  const desktop = document.getElementById('governanceEventFeedList');
  const mobile = document.getElementById('governanceEventFeedListMobile');
  const count = document.getElementById('eventsCountBadge');
  if (count) count.textContent = String(Math.min(99, STATE.governanceEvents.length));

  const renderInto = (el) => {
    if (!el) return;
    if (!STATE.governanceEvents.length) {
      el.innerHTML = '<div class="event-feed-empty">No operational events yet.</div>';
      return;
    }
    el.innerHTML = '';
    STATE.governanceEvents.forEach(event => {
      const item = document.createElement('div');
      const sev = event.severity.toLowerCase();
      const icon = event.severity === 'CRITICAL' ? '🛑' : event.severity === 'WARNING' ? '⚠' : 'ℹ';
      item.className = `event-feed-item ${sev}${newId === event.id ? ' event-new' : ''}`;
      item.dataset.eventId = event.id;
      item.innerHTML = `
        <div class="event-feed-meta">
          <span class="event-feed-time">${event.time}</span>
          <span class="event-feed-severity ${sev}">${icon}</span>
          <span class="event-feed-category">${event.category}</span>
        </div>
        <div class="event-feed-title">${event.title}</div>
        <div class="event-feed-desc">${event.description}</div>
      `;
      item.addEventListener('click', () => handleGovernanceEventClick(event));
      el.appendChild(item);
    });
  };

  renderInto(desktop);
  renderInto(mobile);
}

function handleGovernanceEventClick(event) {
  if (event.relatedTimeline) {
    document.querySelectorAll('#contrastTimeline .contrast-timeline-event').forEach(node => {
      const label = node.querySelector('.contrast-timeline-label')?.textContent || '';
      node.classList.toggle('feed-focus', label.includes(event.relatedTimeline));
    });
  }
  if (event.relatedAuthorityIndex !== null && event.relatedAuthorityIndex !== undefined) {
    document.querySelectorAll('.contrast-authority-step').forEach((step, i) => {
      step.classList.toggle('feed-focus', i === event.relatedAuthorityIndex);
    });
  }

  navigateTo('dashboard');
  setTimeout(() => {
    const panel = document.getElementById('panelLog');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (event.relatedAuditId) {
      const target = document.querySelector(`[data-audit-id="${event.relatedAuditId}"]`);
      if (target) {
        target.classList.add('event-focus');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => target.classList.remove('event-focus'), 1800);
      }
    }
  }, 120);

  closeEventsDrawer();
}

function openEventsDrawer() {
  if (window.innerWidth >= 768) return;
  document.getElementById('eventsDrawerOverlay')?.classList.add('open');
  document.getElementById('eventsDrawer')?.classList.add('open');
}

function closeEventsDrawer() {
  document.getElementById('eventsDrawerOverlay')?.classList.remove('open');
  document.getElementById('eventsDrawer')?.classList.remove('open');
}
