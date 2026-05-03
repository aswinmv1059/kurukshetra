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
