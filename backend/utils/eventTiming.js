const DEFAULT_AUTO_END_MS = 3 * 60 * 1000; // 3 minutes for testing

function getAutoEndDurationMs() {
    const raw = process.env.EVENT_AUTO_END_DURATION_MS;
    if (!raw) return DEFAULT_AUTO_END_MS;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return DEFAULT_AUTO_END_MS;
}

module.exports = {
    DEFAULT_AUTO_END_MS,
    getAutoEndDurationMs
};

