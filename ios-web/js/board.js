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
        names.forEach(n => {
            const s = SHIPS[n];
            const dx = s.x - (gShip ? gShip.x : 0);
            const dy = s.y - (gShip ? gShip.y : 0);
            proj[n] = {
                x: dx * cos - dy * sin,
                y: dx * sin + dy * cos
            };
        });

        const sorted = names.slice().sort((a, b) => proj[a].x - proj[b].x);
        const lines = [];
        if (sorted.length > 0) {
            let cur = [sorted[0]];
            for (let i = 1; i < sorted.length; i++) {
                if (Math.abs(proj[sorted[i]].x - proj[cur[0]].x) < TOLERANCE) {
                    cur.push(sorted[i]);
                } else {
                    cur.sort((a, b) => proj[a].y - proj[b].y);
                    lines.push(cur);
                    cur = [sorted[i]];
                }
            }
            if (cur.length > 0) {
                cur.sort((a, b) => proj[a].y - proj[b].y);
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
    const matchCount = names.filter(n => formationOneShips.includes(n)).length;

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
