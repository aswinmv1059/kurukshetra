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
    return str.toString().split(/(\d)/).map(part => {
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
        const fragments = cleanSignal.split("-").map(f => f.trim()).filter(f => f);

        fragments.forEach(frag => {
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
    const parts = cleanSignal.split(" ").filter(x => x);
    if (parts.includes("CPN") || parts.includes("TURN")) {
        const hdPart = parts.find(p => /^\d{1,3}$/.test(p));
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
