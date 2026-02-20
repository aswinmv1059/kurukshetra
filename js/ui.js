/* ---------- UI LOGIC & EVENT LISTENERS ---------- */

/**
 * Initializes all UI components and listeners.
 */
APP.initUI = function () {
    // Mode Switchers
    document.getElementById("modeToggle").addEventListener("change", (e) => {
        const body = document.body;
        if (e.target.checked) {
            body.classList.remove("light");
            body.classList.add("dark");
        } else {
            body.classList.remove("dark");
            body.classList.add("light");
        }
        resizeCanvas("A");
        resizeCanvas("B");
        APP.needsRedraw = true;
    });

    document.getElementById("modeSelect").addEventListener("change", (e) => {
        APP.currentMode = e.target.value;
        applyModeLayout();
    });

    document.getElementById("boardSelect").addEventListener("change", (e) => {
        APP.activeBoard = e.target.value;
        refreshUI();
        APP.needsRedraw = true;
    });

    // Action Buttons
    document.getElementById("btnUndo").addEventListener("click", () => undo());
    document.getElementById("btnRedo").addEventListener("click", () => redo());
    document.getElementById("btnCenter").addEventListener("click", () => centerMainBody());
    document.getElementById("btnDelete").addEventListener("click", () => deleteShip());
    document.getElementById("btnAddShip").addEventListener("click", () => addShipFromUI());
    document.getElementById("executeBtn").addEventListener("click", handleCommandAndCombat);

    // Input Handling
    const cmdInput = document.getElementById("commandInput");
    cmdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleCommandAndCombat();
        }
    });

    cmdInput.addEventListener("input", (e) => {
        if (e.target.value.length > APP.CONFIG.COMMAND_MAX_LENGTH) {
            e.target.value = e.target.value.substring(0, APP.CONFIG.COMMAND_MAX_LENGTH);
        }
    });

    // Rename Interaction
    ["boardCanvasA", "boardCanvasB"].forEach(id => {
        const cvs = document.getElementById(id);
        if (!cvs) return;
        cvs.addEventListener("dblclick", (e) => handleCanvasDoubleClick(e, id));
    });

    // Intro & Start
    document.getElementById("bootBtn").addEventListener("click", startBootSequence);
    document.getElementById("btnStart").addEventListener("click", startApp);
};

/**
 * Refreshes the ship list, dropdowns, and status labels.
 */
function refreshUI(board = APP.activeBoard) {
    const state = APP.BOARD_STATES[board];
    const shipList = document.getElementById("shipList");
    const shipSelect = document.getElementById("mainBodySelect");

    shipList.innerHTML = "";
    shipSelect.innerHTML = "";

    const ships = state.SHIPS;
    for (const name in ships) {
        const s = ships[name];

        // Populate Dropdown
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        shipSelect.appendChild(opt);

        // Populate List
        const item = document.createElement("div");
        item.className = "shipItem";
        item.innerHTML = `
            <span class="shipName">${name}</span>
            <span class="shipMeta">${s.course.toString().padStart(3, '0')}° / ${s.speed}KT</span>
        `;
        shipList.appendChild(item);
    }

    updateGuideLabel();
}

/**
 * Updates the guide name label in top bar.
 */
function updateGuideLabel(board = APP.activeBoard) {
    const state = APP.BOARD_STATES[board];
    const lbl = document.getElementById("guideName");
    lbl.textContent = state.GUIDE ? `/${state.GUIDE}` : "/NONE";
    lbl.style.color = state.GUIDE ? "var(--alert)" : "var(--primary)";
}

/**
 * Displays feedback when command is executed.
 */
function showCommandFeedback() {
    const inp = document.getElementById("commandInput");
    const original = inp.placeholder;
    inp.placeholder = "EXECUTING SIGNAL...";
    setTimeout(() => { inp.placeholder = original; }, 2000);
}

/**
 * Transition into Combat Mode.
 */
function enterCombatMode(callback) {
    if (APP.isCombatMode) {
        if (callback) callback();
        return;
    }
    APP.isCombatMode = true;
    document.body.classList.add("combat-mode");
    setTimeout(() => {
        resizeCanvas("A");
        resizeCanvas("B");
        if (callback) callback();
    }, 400);
}

/**
 * Start the cinematic sequence.
 */
function startBootSequence() {
    const btn = document.getElementById("bootBtn");
    const title = document.getElementById("titleGroup");
    btn.classList.remove("show-btn");

    setTimeout(() => {
        document.getElementById("introLayer").style.transition = "opacity 1.5s";
        document.getElementById("introLayer").style.opacity = "0";
        setTimeout(() => {
            document.getElementById("introLayer").remove();
            showNameInput();
        }, 1500);
    }, 500);
}

/**
 * Checks for combat mode entry and executes command.
 */
function handleCommandAndCombat() {
    if (!APP.isCombatMode) {
        enterCombatMode(() => {
            APP.executeSignal();
        });
    } else {
        APP.executeSignal();
    }
}

/**
 * Centering logic for the main guide.
 */
function centerMainBody(board = APP.activeBoard) {
    const state = APP.BOARD_STATES[board];
    const guide = state.GUIDE || Object.keys(state.SHIPS)[0];
    if (!guide || !state.SHIPS[guide]) return;

    const s = state.SHIPS[guide];
    const dx = state.lastWidth / 2 - s.x;
    const dy = state.lastHeight / 2 - s.y;

    for (let n in state.SHIPS) {
        state.SHIPS[n].x += dx;
        state.SHIPS[n].y += dy;
    }
    APP.needsRedraw = true;
}

/**
 * Ship deletion from UI.
 */
function deleteShip() {
    const name = document.getElementById("mainBodySelect").value;
    if (!name) return;
    if (confirm(`PERMANENTLY DELETE TRACK ${name}?`)) {
        pushUndo();
        delete APP.BOARD_STATES[APP.activeBoard].SHIPS[name];
        refreshUI();
        APP.needsRedraw = true;
    }
}

/**
 * Adds a new ship via callsign input.
 */
function addShipFromUI() {
    const input = document.getElementById("newShipName");
    const res = validateCallsign(input.value);
    if (!res.valid) {
        alert(res.error);
        return;
    }

    const state = APP.BOARD_STATES[APP.activeBoard];
    if (state.SHIPS[res.name]) {
        alert("SHIP ALREADY EXISTS");
        return;
    }

    pushUndo();
    state.SHIPS[res.name] = {
        x: state.lastWidth / 2,
        y: state.lastHeight / 2,
        course: 0,
        speed: 10,
        color: "#00ff99"
    };
    input.value = "";
    refreshUI();
    APP.needsRedraw = true;
}
