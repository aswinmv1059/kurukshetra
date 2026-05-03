console.log("COMBINED.JS LOADED");
// alert("DEBUG: SCRIPT LOADED");

const APP = {
    /* ---------- CONFIG ---------- */
    CONFIG: {
        DEBUG_LANES: false,
        LATERAL_TOLERANCE_PX: 40,
        FORMATION_TOLERANCE_PX: 45,
        MAX_HISTORY: 50,
        SHIP_NAME_REGEX: /^[A-Z0-9]{2,6}$/,
        COMMAND_MAX_LENGTH: 300
    },

    /* ---------- STATE ---------- */
    BOARD_STATES: {
        A: {
            id: "A", label: "FORMATION ONE", canvas: null, ctx: null,
            SHIPS: {}, GUIDE: null, SIDE_GUIDES: [],
            LINE_GUIDE_1: null, LINE_GUIDE_2: null, LINE_GUIDE_3: null,
            lastWidth: 0, lastHeight: 0
        },
        B: {
            id: "B", label: "FORMATION TWO", canvas: null, ctx: null,
            SHIPS: {}, GUIDE: null, SIDE_GUIDES: [],
            LINE_GUIDE_1: null, LINE_GUIDE_2: null, LINE_GUIDE_3: null,
            lastWidth: 0, lastHeight: 0
        }
    },

    activeBoard: "A",
    currentMode: "FORMATION",
    OWN_SHIP_NAME: "",
    isCombatMode: false,
    combatModeGrace: false,
    needsRedraw: true,
    AIServerFailed: false,
    globalAudioCtx: null,

    /* ---------- HISTORY ---------- */
    undoStack: { A: [], B: [] },
    redoStack: { A: [], B: [] }
};
/* ---------- BOARD RENDERING & MATH ---------- */

/**
 * Gets the state for a specific board or the active one.
 */
function getState(board = APP.activeBoard) {
    if (typeof board === 'string') return APP.BOARD_STATES[board];
    return board; // Handle snapshots
}

/**
 * Converts degrees to a 0-359 range.
 */
function normDeg(d) {
    return ((d % 360) + 360) % 360;
}

/**
 * Calculates pixels per NM based on current canvas size.
 */
function getPixelsPerNM(board = APP.activeBoard) {
    const s = getState(board);
    const canvas = s.canvas;
    if (!canvas) return 40;
    const minDim = Math.min(canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
    return (minDim / 2 - 30) / 4; // 4 rings = 4 NM
}

/**
 * Formation detection and line grouping logic.
 */
function getBoardLines(board = APP.activeBoard) {
    const state = getState(board);
    const SHIPS = state.SHIPS;
    const names = Object.keys(SHIPS);
    if (names.length === 0) return [];

    const gName = state.GUIDE || names[0];
    const gShip = SHIPS[gName];
    const baseCourse = gShip ? gShip.course : 0;
    const pxPerNM = getPixelsPerNM(board);
    const TOLERANCE = pxPerNM * 0.25;

    function solveLines(angle) {
        const rad = -angle * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const proj = {};
        names.forEach(function (n) {
            const s = SHIPS[n];
            const dx = s.x - (gShip ? gShip.x : 0);
            const dy = s.y - (gShip ? gShip.y : 0);
            proj[n] = {
                x: dx * cos - dy * sin,
                y: dx * sin + dy * cos
            };
        });

        const sorted = names.slice().sort(function (a, b) { return proj[a].x - proj[b].x; });
        const lines = [];
        if (sorted.length > 0) {
            let cur = [sorted[0]];
            for (let i = 1; i < sorted.length; i++) {
                if (Math.abs(proj[sorted[i]].x - proj[cur[0]].x) < TOLERANCE) {
                    cur.push(sorted[i]);
                } else {
                    cur.sort(function (a, b) { return proj[a].y - proj[b].y; });
                    lines.push(cur);
                    cur = [sorted[i]];
                }
            }
            if (cur.length > 0) {
                cur.sort(function (a, b) { return proj[a].y - proj[b].y; });
                lines.push(cur);
            }
        }
        return lines;
    }

    let bestLines = [];
    let minCount = Infinity;
    let bestAngle = baseCourse;
    const angles = [baseCourse, baseCourse + 90];
    for (let a = 0; a < 180; a += 5) angles.push(a);

    for (let a of angles) {
        const res = solveLines(a);
        if (res.length < minCount) {
            minCount = res.length;
            bestLines = res;
            bestAngle = a;
        } else if (res.length === minCount) {
            if (Math.abs(normDeg(a - baseCourse)) < 1) {
                bestLines = res; bestAngle = a;
            }
            else if (Math.abs(normDeg(a - (baseCourse + 90))) < 1 && Math.abs(normDeg(bestAngle - baseCourse)) > 1) {
                bestLines = res; bestAngle = a;
            }
        }
    }

    const formationOneShips = ["RNV", "RVY", "KNJ", "DLI", "KRC", "KVT", "MYS", "SHK", "GHL", "KMT", "MBI", "KLN"];
    const matchCount = names.filter(function (n) { return formationOneShips.includes(n); }).length;

    if (bestLines.length === 1 && names.length === 12 && matchCount >= 10) {
        const group = bestLines[0];
        return [group.slice(0, 4), group.slice(4, 8), group.slice(8, 12)];
    }
    return bestLines;
}

/**
 * Resizes the canvas and handles relative ship scaling.
 */
function resizeCanvas(board = APP.activeBoard) {
    const state = getState(board);
    const canvas = state.canvas;
    const ctx = state.ctx;
    if (!canvas || !ctx) return;

    const prevWidth = state.lastWidth || 0;
    const prevHeight = state.lastHeight || 0;

    const wrapper = canvas.parentElement;
    const rect = wrapper.getBoundingClientRect();
    const visualWidth = rect.width;
    const visualHeight = rect.height;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(visualWidth * dpr);
    canvas.height = Math.floor(visualHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (prevWidth > 0 && prevHeight > 0 && (prevWidth !== visualWidth || prevHeight !== visualHeight)) {
        const oldCx = prevWidth / 2;
        const oldCy = prevHeight / 2;
        const newCx = visualWidth / 2;
        const newCy = visualHeight / 2;
        const oldRad = Math.min(prevWidth, prevHeight) / 2 - 30;
        const newRad = Math.min(visualWidth, visualHeight) / 2 - 30;
        const scale = (oldRad > 0) ? newRad / oldRad : 1;

        for (let n in state.SHIPS) {
            const s = state.SHIPS[n];
            const ox = s.x - oldCx;
            const oy = s.y - oldCy;
            s.x = newCx + (ox * scale);
            s.y = newCy + (oy * scale);
        }
    }
    state.lastWidth = visualWidth;
    state.lastHeight = visualHeight;
    APP.needsRedraw = true;
}

/**
 * Draws the manoeuvring board grid, rings, and spokes.
 */
function drawBoard(board = APP.activeBoard) {
    const state = getState(board);
    const ctx = state.ctx;
    const cvs = state.canvas;
    if (!ctx || !cvs) return;

    const w = cvs.width / (window.devicePixelRatio || 1);
    const h = cvs.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) - 30;

    ctx.clearRect(0, 0, w, h);

    const isDark = document.body.classList.contains("dark");
    const gridColor = isDark ? "rgba(0, 255, 153, 0.15)" : "rgba(0, 121, 107, 0.1)";
    const textColor = isDark ? "#6b8c82" : "#7f8c8d";

    // Spokes
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridColor;
    for (let a = 0; a < 360; a += 10) {
        const rad = (a - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
        ctx.stroke();

        // Degrees labels
        if (a % 30 === 0) {
            ctx.fillStyle = textColor;
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            const lx = cx + Math.cos(rad) * (maxR + 15);
            const ly = cy + Math.sin(rad) * (maxR + 15) + 4;
            ctx.fillText(a.toString().padStart(3, '0'), lx, ly);
        }
    }

    // Rings (4 rings = 4 NM center of formation)
    for (let i = 1; i <= 4; i++) {
        const r = (maxR / 4) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // NM labels
        ctx.fillStyle = textColor;
        ctx.font = "9px monospace";
        ctx.fillText(i + "NM", cx + 5, cy - r - 5);
    }
}

/**
 * Draws all ships on a board.
 */
function drawShips(board = APP.activeBoard) {
    const state = getState(board);
    const ctx = state.ctx;
    if (!ctx) return;

    const SHIPS = state.SHIPS;
    const GUIDE = state.GUIDE;

    for (let name in SHIPS) {
        const s = SHIPS[name];
        const isGuide = (name === GUIDE);
        const isOwn = (name === APP.OWN_SHIP_NAME);

        // Ship Icon
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.course * Math.PI / 180);

        // Glow for Guide
        if (isGuide) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#ff3333";
        }

        ctx.fillStyle = isGuide ? "#ff3333" : (isOwn ? "#00ccff" : "#00ff99");

        // Triangle shape
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(7, 8);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fill();

        // Direction indicator
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(0, -25);
        ctx.stroke();

        ctx.restore();

        // Label
        ctx.fillStyle = isGuide ? "#ff3333" : "#fff";
        ctx.font = "bold 12px Rajdhani";
        ctx.textAlign = "center";
        ctx.fillText(name, s.x, s.y + 25);
    }
}

/**
 * Main draw loop using requestAnimationFrame.
 */
function renderLoop() {
    if (APP.needsRedraw) {
        drawBoard("A");
        drawShips("A");
        drawBoard("B");
        drawShips("B");
        APP.needsRedraw = false;
    }
    requestAnimationFrame(renderLoop);
}
/* ---------- TACTICAL SIGNAL ENGINE ---------- */

/**
 * Normalizes degrees to 0-359.
 */
function normDeg(d) {
    return ((d % 360) + 360) % 360;
}

/**
 * Digitizes numbers for tactical voice readout (e.g. 090 -> ZERO NINER ZERO).
 */
function digitizeRaw(str) {
    return str.toString().split(/(\d)/).map(function (part) {
        const n = parseInt(part, 10);
        if (part.length === 1 && !isNaN(n)) return ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINER"][n];
        return part;
    }).join(' ').replace(/\s+/g, ' ').trim();
}

function digitize(n) {
    return digitizeRaw(n.toString().padStart(3, '0'));
}

/**
 * Main Command Interpreter.
 */
function processCommand() {
    const inp = document.getElementById("commandInput");
    const rawInp = inp.value.trim().replace(/\r?\n|\r/g, " ");
    if (!rawInp) return;

    if (typeof showCommandFeedback === "function") showCommandFeedback();

    const board = APP.activeBoard;
    const state = APP.BOARD_STATES[board];
    const SHIPS = state.SHIPS;

    const signalPart = rawInp.toUpperCase();

    // Command Validation
    if (rawInp.length > APP.CONFIG.COMMAND_MAX_LENGTH) {
        alert("SIGNAL EXCEEDS MAXIMUM LENGTH");
        return;
    }

    // Capture Undo
    if (typeof pushUndo === "function") pushUndo(board);

    // 1. SIGNAL PARSING (NATO INTP-1D SPEC)
    let cleanSignal = signalPart;

    // Execution Modifiers
    const hasIX = signalPart.includes(" IX ");
    const hasRIX = signalPart.includes(" RIX ");
    const hasSB_IX = (signalPart.includes("SB") && signalPart.includes("IX"));
    const pendingExecution = hasIX && !hasRIX && !hasSB_IX;

    // Remove Execution Codes for Logic
    cleanSignal = cleanSignal.replace(/\bRIX\b/g, "").replace(/\bIX\b/g, "").replace(/\bSB\b/g, "").split("...").join(" ").trim();

    // 2. BULK / COLLECTIVE MANEUVERS
    if (cleanSignal.includes("STN") || cleanSignal.includes("-") || cleanSignal.includes("COLL")) {
        const fragments = cleanSignal.split("-").map(function (f) { return f.trim(); }).filter(function (f) { return f; });

        fragments.forEach(function (frag) {
            // Speed logic
            if (frag.match(/^SPD\s+H\s+(\d+)$/)) {
                const m = frag.match(/^SPD\s+H\s+(\d+)$/);
                const g = state.GUIDE || Object.keys(SHIPS)[0];
                if (g && SHIPS[g]) SHIPS[g].speed = parseInt(m[1], 10);
            }
            // Course logic
            else if (frag.match(/CPN\s+(?:A\s+)?(\d{1,3})/)) {
                const m = frag.match(/CPN\s+(?:A\s+)?(\d{1,3})/);
                const newHd = parseInt(m[1], 10);
                const g = state.GUIDE || Object.keys(SHIPS)[0];
                if (g && SHIPS[g]) {
                    SHIPS[g].course = normDeg(newHd);
                    for (let n in SHIPS) SHIPS[n].course = SHIPS[g].course;
                }
            }
        });

        // Stationing Loop
        const stnRegex = /\/(\S+)\s+STN\s+(\d{1,3})\s*-\s*\/(\S+)\s*-\s*([^-]+?)(?:-|$)/gi;
        let m;
        while ((m = stnRegex.exec(cleanSignal)) !== null) {
            const shipName = m[1];
            const refName = m[3];
            let distNM = parseFloat(m[4].replace("ANS", "."));
            if (isNaN(distNM)) distNM = 0;

            executeStationSignal(shipName, parseInt(m[2], 10), refName, distNM, board);
        }

        // Voice Feedback (Header only for briefness in prototype)
        if (typeof speakCommand === "function") {
            speakCommand("PROCEEDING WITH COLLECTIVE MANEUVER. SHIPS ALTERING TO STATIONS.");
        }
    }

    // 3. CORPEN / TURN LOGIC
    const parts = cleanSignal.split(" ").filter(function (x) { return x; });
    if (parts.includes("CPN") || parts.includes("TURN")) {
        const hdPart = parts.find(function (p) { return /^\d{1,3}$/.test(p); });
        if (hdPart) {
            const hd = parseInt(hdPart, 10);
            const g = state.GUIDE || Object.keys(SHIPS)[0];
            if (g && SHIPS[g]) SHIPS[g].course = normDeg(hd);
            if (parts.includes("TURN")) {
                for (let n in SHIPS) SHIPS[n].course = normDeg(hd);
            }
        }
    }

    APP.needsRedraw = true;
    if (typeof refreshUI === "function") refreshUI(board);
}

/**
 * Execution portal for external triggers.
 */
APP.executeSignal = function () {
    processCommand();
};

/**
 * Logic for stationing a ship relative to a guide.
 */
function executeStationSignal(shipName, bearing, refName, distanceNM, board = APP.activeBoard) {
    const state = APP.BOARD_STATES[board];
    const SHIPS = state.SHIPS;

    if (!SHIPS[shipName]) {
        SHIPS[shipName] = { x: state.lastWidth / 2, y: state.lastHeight / 2, course: 0, speed: 10, color: "#00ff99" };
    }
    const refShip = SHIPS[refName];
    if (!refShip) return;

    const pxPerNM = getPixelsPerNM(board);
    const distPx = distanceNM * pxPerNM;
    const absBearing = (refShip.course + bearing) % 360;
    const radAngle = (absBearing * Math.PI) / 180;

    SHIPS[shipName].x = refShip.x + Math.sin(radAngle) * distPx;
    SHIPS[shipName].y = refShip.y - Math.cos(radAngle) * distPx;
    SHIPS[shipName].course = refShip.course;
}

/**
 * Validates a callsign against official military prototype rules.
 */
function validateCallsign(name) {
    if (!name) return { valid: false, error: "CALLSIGN CANNOT BE EMPTY" };
    const upName = name.trim().toUpperCase();
    if (!APP.CONFIG.SHIP_NAME_REGEX.test(upName)) return { valid: false, error: "INVALID FORMAT (2-6 ALPHANUMERIC)" };

    // Check reserved words
    const reserved = ["IX", "RIX", "SB", "CPN", "STN", "FORM", "SPD", "DE", "INFO", "COLL"];
    if (reserved.includes(upName)) return { valid: false, error: "RESERVED TACTICAL OPERATOR" };

    return { valid: true, name: upName };
}
/* ---------- UI LOGIC & EVENT LISTENERS ---------- */

/**
 * Initializes all UI components and listeners.
 */
APP.initUI = function () {
    function addSafeListener(id, event, fn) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    }

    // Mode Switchers
    addSafeListener("modeToggle", "change", function (e) {
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

    addSafeListener("modeSelect", "change", function (e) {
        APP.currentMode = e.target.value;
        applyModeLayout();
    });

    addSafeListener("boardSelect", "change", function (e) {
        APP.activeBoard = e.target.value;
        refreshUI();
        APP.needsRedraw = true;
    });

    // Action Buttons
    addSafeListener("btnUndo", "click", function () { undo(); });
    addSafeListener("btnRedo", "click", function () { redo(); });
    addSafeListener("btnCenter", "click", function () { centerMainBody(); });
    addSafeListener("btnDelete", "click", function () { deleteShip(); });
    addSafeListener("btnAddShip", "click", function () { addShipFromUI(); });
    addSafeListener("executeBtn", "click", handleCommandAndCombat);

    // Input Handling
    addSafeListener("commandInput", "keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleCommandAndCombat();
        }
    });

    addSafeListener("commandInput", "input", function (e) {
        if (e.target.value.length > APP.CONFIG.COMMAND_MAX_LENGTH) {
            e.target.value = e.target.value.substring(0, APP.CONFIG.COMMAND_MAX_LENGTH);
        }
    });

    // Rename Interaction
    ["boardCanvasA", "boardCanvasB"].forEach(function (id) {
        const cvs = document.getElementById(id);
        if (!cvs) return;
        cvs.addEventListener("dblclick", function (e) { handleCanvasDoubleClick(e, id); });
    });

    // Intro & Start
    addSafeListener("bootBtn", "click", startBootSequence);
    addSafeListener("btnStart", "click", startApp);
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
        const intro = document.getElementById("introLayer");
        if (intro) {
            intro.style.transition = "opacity 1.5s";
            intro.style.opacity = "0";
            setTimeout(() => {
                intro.remove();
                if (typeof showNameInput === "function") showNameInput();
            }, 1500);
        }
    }, 500);
}

/**
 * Handle mode layout changes.
 */
function applyModeLayout() {
    const area = document.getElementById("boardArea");
    const boardB = document.getElementById("boardWrapperB");
    if (APP.currentMode === "FORMATION") {
        boardB.style.display = "none";
    } else {
        boardB.style.display = "flex";
    }
    resizeCanvas("A");
    resizeCanvas("B");
}

/**
 * Handle double click for renaming.
 */
function handleCanvasDoubleClick(e, canvasId) {
    const state = (canvasId === "boardCanvasA") ? APP.BOARD_STATES.A : APP.BOARD_STATES.B;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (let name in state.SHIPS) {
        const s = state.SHIPS[name];
        const dist = Math.hypot(s.x - x, s.y - y);
        if (dist < 30) {
            const newName = prompt(`RENAME ${name}:`, name);
            if (newName && newName !== name) {
                const res = validateCallsign(newName);
                if (res.valid) {
                    state.SHIPS[res.name] = state.SHIPS[name];
                    delete state.SHIPS[name];
                    if (state.GUIDE === name) state.GUIDE = res.name;
                    refreshUI();
                    APP.needsRedraw = true;
                } else {
                    alert(res.error);
                }
            }
            break;
        }
    }
}

function showNameInput() {
    document.getElementById("initOverlay").style.display = "flex";
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

/**
 * Undo functionality.
 */
function undo(board = APP.activeBoard) {
    const stack = APP.undoStack[board];
    if (!stack || stack.length === 0) return;

    const current = JSON.parse(JSON.stringify({ SHIPS: APP.BOARD_STATES[board].SHIPS, GUIDE: APP.BOARD_STATES[board].GUIDE }));
    APP.redoStack[board].push(current);

    const prev = stack.pop();
    APP.BOARD_STATES[board].SHIPS = prev.SHIPS;
    APP.BOARD_STATES[board].GUIDE = prev.GUIDE;

    refreshUI();
    APP.needsRedraw = true;
}

/**
 * Redo functionality.
 */
function redo(board = APP.activeBoard) {
    const stack = APP.redoStack[board];
    if (!stack || stack.length === 0) return;

    const current = JSON.parse(JSON.stringify({ SHIPS: APP.BOARD_STATES[board].SHIPS, GUIDE: APP.BOARD_STATES[board].GUIDE }));
    APP.undoStack[board].push(current);

    const next = stack.pop();
    APP.BOARD_STATES[board].SHIPS = next.SHIPS;
    APP.BOARD_STATES[board].GUIDE = next.GUIDE;

    refreshUI();
    APP.needsRedraw = true;
}

/**
 * Pushes state to undo.
 */
function pushUndo(board = APP.activeBoard) {
    const state = APP.BOARD_STATES[board];
    const snapshot = JSON.parse(JSON.stringify({ SHIPS: state.SHIPS, GUIDE: state.GUIDE }));
    APP.undoStack[board].push(snapshot);
    if (APP.undoStack[board].length > APP.CONFIG.MAX_HISTORY) APP.undoStack[board].shift();
    APP.redoStack[board] = [];
}

/**
 * Starts the application.
 */
function startApp() {
    const input = document.getElementById("ownShipInput");
    const name = input.value.trim().toUpperCase();
    if (!name) { alert("ENTER OWN SHIP CALLSIGN"); return; }

    APP.OWN_SHIP_NAME = name;
    const loader = document.getElementById("pageLoader");
    if (loader) {
        loader.style.opacity = "0";
        setTimeout(() => {
            loader.remove();
            speakCommand(`WELCOME ${name} TO KURUKSHETRA`);
        }, 800);
    }
}

/**
 * Tactical voice output.
 */
function speakCommand(msg) {
    if (!msg) return;
    
    // Syllable Emphasis and Case-Insensitive ANS replacement
    let clarifiedMsg = msg
        .replace(/\bANS\b/gi, "ANSWER");

    const utter = new SpeechSynthesisUtterance(clarifiedMsg);
    utter.rate = 0.9;
    utter.pitch = 0.8;
    window.speechSynthesis.speak(utter);

    const log = document.getElementById("commLog");
    if (log) {
        const entry = document.createElement("div");
        entry.style.color = "#00ff99";
        entry.style.marginBottom = "5px";
        entry.textContent = `> ${msg}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }
}
/* ---------- APP BOOTSTRAP ---------- */

APP.init = function () {
    try {
        console.log("Initializing KURUKSHETRA System...");

        // Initialize Canvas Contexts
        APP.BOARD_STATES.A.canvas = document.getElementById("boardCanvasA");
        if (APP.BOARD_STATES.A.canvas) APP.BOARD_STATES.A.ctx = APP.BOARD_STATES.A.canvas.getContext("2d");

        APP.BOARD_STATES.B.canvas = document.getElementById("boardCanvasB");
        if (APP.BOARD_STATES.B.canvas) APP.BOARD_STATES.B.ctx = APP.BOARD_STATES.B.canvas.getContext("2d");

        // Initialize UI and Event Listeners
        APP.initUI();

        // Initial Layout Setup
        window.addEventListener("resize", function () {
            resizeCanvas("A");
            resizeCanvas("B");
            APP.needsRedraw = true;
        });

        // Handle initial sizing
        resizeCanvas("A");
        resizeCanvas("B");

        // Start Rendering Loop
        renderLoop();

        // Trigger Initial UI Refresh
        refreshUI();

        // Show Intro animations
        setTimeout(function () {
            const bg = document.getElementById("introBg");
            const title = document.getElementById("titleGroup");
            const btn = document.getElementById("bootBtn");

            if (bg) {
                bg.style.opacity = "0.7";
                bg.classList.add("pan-zoom-anim");
            }
            setTimeout(function () {
                if (title) title.classList.add("title-reveal");
                setTimeout(function () {
                    if (btn) btn.classList.add("show-btn");
                }, 1000);
            }, 1200);
        }, 500);
    } catch (err) {
        console.error("CRITICAL BOOT ERROR:", err);
        alert("SYSTEM ERROR: UNABLE TO INITIALIZE KURUKSHETRA. SEE CONSOLE.");
    }
};

// Start the application when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", APP.init);
} else {
    APP.init();
}
