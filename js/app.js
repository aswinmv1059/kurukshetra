/* ---------- APP BOOTSTRAP ---------- */

APP.init = function () {
    console.log("Initializing KURUKSHETRA System...");

    // Initialize Canvas Contexts
    APP.BOARD_STATES.A.canvas = document.getElementById("boardCanvasA");
    APP.BOARD_STATES.A.ctx = APP.BOARD_STATES.A.canvas.getContext("2d");
    APP.BOARD_STATES.B.canvas = document.getElementById("boardCanvasB");
    APP.BOARD_STATES.B.ctx = APP.BOARD_STATES.B.canvas.getContext("2d");

    // Initialize UI and Event Listeners
    APP.initUI();

    // Initial Layout Setup
    window.addEventListener("resize", () => {
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
    setTimeout(() => {
        document.getElementById("introBg").style.opacity = "0.7";
        document.getElementById("introBg").classList.add("pan-zoom-anim");
        setTimeout(() => {
            document.getElementById("titleGroup").classList.add("title-reveal");
            setTimeout(() => {
                document.getElementById("bootBtn").classList.add("show-btn");
            }, 1000);
        }, 1200);
    }, 500);
};

// Start the application when DOM is ready
document.addEventListener("DOMContentLoaded", APP.init);
