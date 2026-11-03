(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------------------------ toast */
  let toastTimer = null;
  function toast(message, isError = false) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("err", Boolean(isError));
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
  }

  /* -------------------------------------------------------------------- nav */
  function setView(name) {
    $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    $(".content").scrollTop = 0;
  }
  $("#nav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (btn) setView(btn.dataset.view);
  });

  /* ------------------------------------------------------------- host facts */
  function parseMacOS(ua) {
    const m = ua.match(/Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/);
    if (!m) return null;
    return [m[1], m[2], m[3]].filter(Boolean).join(".");
  }

  function paintFacts(facts) {
    $("#host-facts").innerHTML = facts
      .map(
        (f) => `
        <div class="fact">
          <span>${esc(f.label)}</span>
          <strong class="${f.available ? "" : "muted"}">${esc(f.value)}</strong>
        </div>`
      )
      .join("");
  }

  async function renderHostFacts() {
    const ua = navigator.userAgent;
    const mem = navigator.deviceMemory;
    let arch = null;
    let os = parseMacOS(ua);
    let model = null;

    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        const he = await navigator.userAgentData.getHighEntropyValues([
          "architecture", "platformVersion", "model",
        ]);
        arch = he.architecture || null;
        os = he.platformVersion || os;
        model = he.model || null;
      }
    } catch (_) {
      /* browser refused; keep approximations */
    }

    const facts = [
      { label: "Model", value: model || "Unavailable", available: Boolean(model) },
      { label: "Chip", value: "Unavailable", available: false },
      { label: "Architecture", value: arch || "Unavailable", available: Boolean(arch) },
      { label: "macOS", value: os || "Unavailable", available: Boolean(os) },
      { label: "Memory", value: mem ? `~${mem} GiB` : "Unavailable", available: Boolean(mem) },
      { label: "CPU", value: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical cores` : "Unavailable", available: Boolean(navigator.hardwareConcurrency) },
      { label: "Display", value: `${screen.width} × ${screen.height}`, available: true },
      { label: "Language", value: navigator.language || "Unavailable", available: Boolean(navigator.language) },
      { label: "Time zone", value: Intl.DateTimeFormat().resolvedOptions().timeZone || "Unavailable", available: true },
      { label: "Network", value: navigator.onLine ? "Online" : "Offline", available: true },
    ];
    paintFacts(facts);
  }

  /* ------------------------------------------------------------------ guest */
  const STAGES = [
    { id: "kernel", label: "Linux kernel started" },
    { id: "system", label: "/system mounted" },
    { id: "data", label: "/data mounted" },
    { id: "apex", label: "APEX packages restored" },
    { id: "zygote", label: "zygote started" },
    { id: "gralloc", label: "graphics allocator (gralloc) available" },
    { id: "surfaceflinger", label: "surfaceflinger stable" },
    { id: "complete", label: "sys.boot_completed=1" },
  ];

  const DOCUMENTED = new Set(["kernel", "system", "data", "apex", "zygote"]);

  const BOOT_STEPS = [
    { t: 500, stage: "kernel", text: "[    0.000000] Booting Linux on physical CPU 0x0", cls: "sys" },
    { t: 250, text: "[    0.000000] Linux version 4.14.175-android (arm64)", cls: "sys" },
    { t: 420, stage: "system", text: "[    0.624102] EXT4-fs (vda): mounted filesystem /system", cls: "" },
    { t: 280, text: "[    0.981441] EXT4-fs (vdb): mounted filesystem /vendor", cls: "" },
    { t: 280, stage: "data", text: "[    1.204556] EXT4-fs (vdc): mounted filesystem /data", cls: "" },
    { t: 420, stage: "apex", text: "[    2.318902] apexd: restored 2 APEX packages (com.android.apex.runtime)", cls: "" },
    { t: 620, stage: "zygote", text: "[    3.104881] init: starting service 'zygote'", cls: "" },
    { t: 480, text: "[    3.612004] init: Failed to bind socket 'pdx/system/vr/display/client': No such file or directory", cls: "err" },
    { t: 240, text: "[    3.614220] init: Service 'vendor.gralloc-2-0' (pid 2286) exited with status 1", cls: "err" },
    { t: 240, text: "[    3.618771] init: updatable process 'vendor.gralloc-2-0' exited 4 times before boot completed", cls: "err" },
    { t: 360, text: "[    3.620113] surfaceflinger: onrestart restart zygote — core service group restarting", cls: "err" },
    { t: 360, text: "Pickle: guest stopped before sys.boot_completed=1 (display blocker)", cls: "dim" },
  ];

  let guestState = "idle";
  let bootToken = 0;
  let booting = false;
  let previewOn = true;
  const reached = new Set();
  const logLines = [];

  const STATE_LABEL = {
    idle: "Idle",
    ready: "Ready",
    starting: "Starting",
    blocked: "Blocked",
    stopped: "Stopped",
  };

  const STATE_PILL = {
    idle: "", ready: "busy", starting: "busy", blocked: "bad", stopped: "",
  };

  const STATE_DETAIL = {
    idle: "No prepared system image. Press Prepare, then Boot.",
    ready: "Image ready: android-29, arm64, 8 components. Booting starts a real Android guest (simulated on this page).",
    starting: "Starting the guest. The guest's own output appears as it is reported.",
    blocked: "The guest booted its kernel and userspace, then stopped before sys.boot_completed=1. See the blocker in Guest.",
    stopped: "The guest stopped by operator. Stages above are what it reported on its console.",
  };

  function renderStages() {
    $("#stages").innerHTML = STAGES.map((s) => {
      const on = reached.has(s.id);
      return `
        <div class="stage ${on ? "reached" : "pending"}">
          <span class="marker">${on ? "✓" : "·"}</span>
          <span>${esc(s.label)}</span>
          <span class="verdict">${on ? "reached" : "not reached"}</span>
        </div>`;
    }).join("");
  }

  function renderLog() {
    const pre = $("#console-log");
    pre.innerHTML = logLines
      .map((l) => `<span class="${l.cls || ""}">${esc(l.text)}</span>`)
      .join("\n");
    pre.scrollTop = pre.scrollHeight;
  }

  function appendLog(text, cls = "") {
    logLines.push({ text, cls });
    renderLog();
  }

  function updateOverlay() {
    const overlay = $("#phone-overlay");
    const spinner = $(".boot-spinner", overlay);
    const text = $("p", overlay);
    if (booting) {
      overlay.hidden = false;
      spinner.hidden = false;
      text.textContent = "Booting Android…";
    } else if (!previewOn) {
      overlay.hidden = false;
      spinner.hidden = true;
      text.textContent = "Display unavailable — the image expects goldfish, the framework exposes virtio.";
    } else {
      overlay.hidden = true;
    }
  }

  function renderGuest() {
    const label = STATE_LABEL[guestState] || "Idle";
    [ $("#guest-state"), $("#guest-state-2") ].forEach((pill) => {
      pill.textContent = label;
      pill.className = `pill ${STATE_PILL[guestState] || ""}`;
    });
    $("#title-state").textContent = label;
    $("#guest-detail").textContent = STATE_DETAIL[guestState] || "";
    $("#status-left").textContent =
      guestState === "blocked" ? "Blocked: display stack" : label;

    $("#btn-prepare").disabled = booting;
    $("#btn-boot").disabled = booting;
    $("#btn-stop").disabled = !booting;
    renderStages();
    updateOverlay();
  }

  function resetGuest() {
    reached.clear();
    logLines.length = 0;
    renderLog();
    renderStages();
  }

  function prepare(silent = false) {
    if (booting) return;
    resetGuest();
    guestState = "ready";
    appendLog("Pickle: validating android-29 arm64 system image…", "dim");
    appendLog("Pickle: image ready — android-29, arm64, 8 components", "sys");
    renderGuest();
    if (!silent) toast("Image prepared (simulated)");
  }

  async function boot() {
    if (booting) return;
    bootToken += 1;
    const token = bootToken;
    resetGuest();
    booting = true;
    guestState = "starting";
    appendLog("Pickle: preparing Android 10 arm64 system image", "sys");
    renderGuest();

    for (const step of BOOT_STEPS) {
      await sleep(step.t);
      if (token !== bootToken) return;
      if (step.stage) reached.add(step.stage);
      appendLog(step.text, step.cls);
      renderStages();
    }

    await sleep(350);
    if (token !== bootToken) return;

    booting = false;
    guestState = "blocked";
    renderGuest();
    toast("Guest stopped before Android boot completed — display blocker");
  }

  function stop() {
    if (!booting) return;
    bootToken += 1;
    booting = false;
    guestState = "stopped";
    appendLog("Pickle: guest stopped by operator", "dim");
    renderGuest();
    toast("Guest stopped");
  }

  $("#btn-prepare").addEventListener("click", () => prepare());
  $("#btn-boot").addEventListener("click", boot);
  $("#btn-stop").addEventListener("click", stop);

  $("#btn-preview").addEventListener("click", () => {
    previewOn = !previewOn;
    $("#btn-preview").textContent = previewOn ? "Hide preview" : "Show preview";
    updateOverlay();
    toast(previewOn ? "Simulated display shown" : "Simulated display hidden");
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "boot") boot();
    if (btn.dataset.action === "stop") stop();
  });

  $$(".android-app").forEach((btn) => {
    btn.addEventListener("click", () => {
      toast(`Simulated: ${btn.dataset.app} would open in the Android guest`);
    });
  });

  function renderMilestoneStages() {
    $("#milestone-stages").innerHTML = STAGES.slice(0, 5)
      .map((s) => `<span class="${DOCUMENTED.has(s.id) ? "on" : ""}">${esc(s.label)}</span>`)
      .join("");
  }

  /* ------------------------------------------------------------------- apps */
  const APPS = [
    { name: "Sample Game", pkg: "com.pickle.samplegame", size: "48 MB", icon: "ic-game", glyph: "▶", blurb: "Placeholder action title used to show the install/launch flow." },
    { name: "Browser", pkg: "com.pickle.browser", size: "22 MB", icon: "ic-browser", glyph: "◎", blurb: "Stand-in for an Android browser. Nothing is downloaded." },
    { name: "Gallery", pkg: "com.pickle.gallery", size: "9 MB", icon: "ic-gallery", glyph: "▤", blurb: "Shows where per-app storage and media would live." },
    { name: "Files", pkg: "com.pickle.files", size: "6 MB", icon: "ic-files", glyph: "▣", blurb: "Represents the package manager's view of app data." },
    { name: "Music", pkg: "com.pickle.music", size: "14 MB", icon: "ic-clock", glyph: "♪", blurb: "Audio apps need working audioserver routing from the guest." },
    { name: "Notes", pkg: "com.pickle.notes", size: "4 MB", icon: "ic-settings", glyph: "✎", blurb: "A tiny app to show launch state and windowing later on." },
  ];

  const installed = new Set();

  function renderApps() {
    $("#apps-grid").innerHTML = APPS.map((a) => {
      const isInstalled = installed.has(a.name);
      return `
        <article class="app-card">
          <div class="app-top">
            <div class="app-icon ${a.icon}">${esc(a.glyph)}</div>
            <div class="app-meta">
              <strong>${esc(a.name)}</strong>
              <small>${esc(a.pkg)} · ${esc(a.size)}</small>
            </div>
          </div>
          <p>${esc(a.blurb)}</p>
          <div class="app-actions">
            ${
              isInstalled
                ? `<span class="badge-installed">installed</span>
                   <button class="btn" data-open="${esc(a.name)}">Open</button>`
                : `<button class="btn primary" data-install="${esc(a.name)}">Install</button>`
            }
            <div class="progress"><i></i></div>
          </div>
        </article>`;
    }).join("");
  }

  $("#apps-grid").addEventListener("click", (e) => {
    const installBtn = e.target.closest("[data-install]");
    if (installBtn) {
      installApp(installBtn.dataset.install, installBtn);
      return;
    }
    const openBtn = e.target.closest("[data-open]");
    if (openBtn) {
      toast(`Simulated: launching ${openBtn.dataset.open} in the Android guest`);
    }
  });

  function installApp(name, btn) {
    if (installed.has(name)) return;
    btn.disabled = true;
    btn.textContent = "Installing…";
    const bar = $(".progress > i", btn.closest(".app-card"));
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(100, pct + 9);
      bar.style.width = `${pct}%`;
      if (pct >= 100) {
        clearInterval(timer);
        installed.add(name);
        renderApps();
        toast(`Simulated install complete: ${name}`);
      }
    }, 90);
  }

  /* --------------------------------------------------------------- profiles */
  const PRESETS = {
    battery: { label: "Battery", ram: 1024, vcpu: 2, blurb: "Leave the 8 GiB host room to breathe." },
    balanced: { label: "Balanced", ram: 1536, vcpu: 2, blurb: "Default on this Mac." },
    performance: { label: "Performance", ram: 2048, vcpu: 4, blurb: "Upper preference while the host stays usable." },
  };

  const DEFAULT_SETTINGS = { profile: "balanced", ram: 1536, vcpu: 2, autoboot: false };
  const STORAGE_KEY = "pickle.demo.settings";

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return {
        profile: PRESETS[parsed.profile] ? parsed.profile : DEFAULT_SETTINGS.profile,
        ram: Number(parsed.ram) || DEFAULT_SETTINGS.ram,
        vcpu: Number(parsed.vcpu) || DEFAULT_SETTINGS.vcpu,
        autoboot: Boolean(parsed.autoboot),
      };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  let settings = loadSettings();

  function renderProfiles() {
    $("#profile-cards").innerHTML = Object.entries(PRESETS)
      .map(([key, p]) => {
        const active = settings.profile === key;
        return `
          <article class="card" style="${active ? "border-color: rgba(10,132,255,.5);" : ""}">
            <div class="card-head">
              <h3>${esc(p.label)}</h3>
              <span class="tag ${active ? "ok" : ""}">${active ? "active" : "select"}</span>
            </div>
            <p>${esc(p.blurb)}</p>
            <p class="mono muted">${p.ram} MiB · ${p.vcpu} vCPU</p>
            <button class="btn ${active ? "" : "primary"}" data-profile="${esc(key)}" ${active ? "disabled" : ""}>
              ${active ? "Selected" : "Use profile"}
            </button>
          </article>`;
      })
      .join("");
  }

  $("#profile-cards").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-profile]");
    if (!btn) return;
    const key = btn.dataset.profile;
    settings.profile = key;
    settings.ram = PRESETS[key].ram;
    settings.vcpu = PRESETS[key].vcpu;
    saveSettings();
    syncForm();
    renderProfiles();
    toast(`Profile: ${PRESETS[key].label} (${settings.ram} MiB · ${settings.vcpu} vCPU)`);
  });

  /* --------------------------------------------------------------- settings */
  function syncForm() {
    const radio = $(`input[name="profile"][value="${settings.profile}"]`);
    if (radio) radio.checked = true;
    $("#ram").value = settings.ram;
    $("#ram-value").textContent = `${settings.ram} MiB`;
    $("#vcpu").value = String(settings.vcpu);
    $("#autoboot").checked = settings.autoboot;
    let note = "Not saved yet";
    try {
      if (localStorage.getItem(STORAGE_KEY)) note = "Saved";
    } catch (_) {}
    $("#settings-note").textContent = note;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {
      /* private mode */
    }
  }

  $$('input[name="profile"]').forEach((input) => {
    input.addEventListener("change", () => {
      settings.profile = input.value;
      settings.ram = PRESETS[input.value].ram;
      settings.vcpu = PRESETS[input.value].vcpu;
      syncForm();
    });
  });

  $("#ram").addEventListener("input", (e) => {
    settings.ram = Number(e.target.value);
    $("#ram-value").textContent = `${settings.ram} MiB`;
  });

  $("#vcpu").addEventListener("change", (e) => {
    settings.vcpu = Number(e.target.value);
  });

  $("#autoboot").addEventListener("change", (e) => {
    settings.autoboot = e.target.checked;
  });

  $("#settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettings();
    $("#settings-note").textContent = "Saved just now";
    renderProfiles();
    toast("Settings saved in this browser");
  });

  $("#btn-reset").addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    syncForm();
    renderProfiles();
    toast("Settings reset");
  });

  /* -------------------------------------------------------------- instances */
  const INSTANCES = [
    { name: "Android 10 ARM64 (goldfish)", backend: "Virtualization.framework", status: "Boots; display blocked", kind: "warn", evidence: "Kernel 4.14.175 starts, system/vendor/data mount, gralloc fails under virtio." },
    { name: "Cuttlefish ARM64", backend: "Virtualization.framework", status: "Planned", kind: "", evidence: "Built for virtio + DRM; unverified on this host, no patching required." },
    { name: "Android Emulator + ADB", backend: "Google emulator", status: "Blocked on this host", kind: "bad", evidence: "HVF does not engage; device stays offline. Cannot be used for a working demo here." },
    { name: "iOS Simulator builds", backend: "Apple Simulator", status: "Future / constrained", kind: "", evidence: "Simulator-compatible builds only; arbitrary iOS apps are not supported." },
  ];

  function renderInstances() {
    $("#instances-body").innerHTML = INSTANCES.map(
      (i) => `
      <tr>
        <td><strong>${esc(i.name)}</strong></td>
        <td class="mono">${esc(i.backend)}</td>
        <td><span class="tag ${i.kind}">${esc(i.status)}</span></td>
        <td>${esc(i.evidence)}</td>
      </tr>`
    ).join("");
  }

  /* ------------------------------------------------------------------- game */
  let gameMove = null;
  let gameClock = null;
  let gameScore = 0;
  let gameLeft = 0;

  function placeTarget() {
    const game = $("#game");
    const target = $("#pickle-target");
    const w = game.clientWidth;
    const h = game.clientHeight;
    const size = 46;
    const x = Math.max(4, Math.random() * (w - size - 8) + 4);
    const y = Math.max(4, Math.random() * (h - size - 8) + 4);
    target.style.left = `${x}px`;
    target.style.top = `${y}px`;
  }

  function startGame() {
    stopGame();
    gameScore = 0;
    gameLeft = 15;
    $("#game-status").textContent = `Score 0 · 15s`;
    $("#pickle-target").classList.add("live");
    placeTarget();
    gameMove = setInterval(placeTarget, 650);
    gameClock = setInterval(() => {
      gameLeft -= 1;
      $("#game-status").textContent = `Score ${gameScore} · ${Math.max(0, gameLeft)}s`;
      if (gameLeft <= 0) stopGame(true);
    }, 1000);
  }

  function stopGame(showScore = false) {
    clearInterval(gameMove);
    clearInterval(gameClock);
    gameMove = null;
    gameClock = null;
    $("#pickle-target").classList.remove("live");
    if (showScore) {
      $("#game-status").textContent = `Done · score ${gameScore}`;
      toast(`Mini game finished — ${gameScore} taps`);
    }
  }

  $("#btn-game").addEventListener("click", startGame);
  $("#pickle-target").addEventListener("click", () => {
    if (!gameMove) return;
    gameScore += 1;
    $("#game-status").textContent = `Score ${gameScore} · ${Math.max(0, gameLeft)}s`;
    placeTarget();
  });

  /* ------------------------------------------------------------------ clock */
  function tickClock() {
    const now = new Date();
    $("#android-time").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  /* ------------------------------------------------------------------- init */
  renderMilestoneStages();
  renderGuest();
  renderApps();
  renderInstances();
  renderProfiles();
  syncForm();
  renderHostFacts();
  tickClock();
  setInterval(tickClock, 30000);

  appendLog("Pickle: idle. Press Prepare to validate the image.", "dim");
  appendLog("Pickle: this page simulates the guest; no Android VM runs in the browser.", "dim");
})();
