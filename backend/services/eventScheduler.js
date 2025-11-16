const { getAutoEndDurationMs } = require('../utils/eventTiming');
const DEFAULT_INTERVAL_MS = 60 * 1000;

function normalizeStatus(status) {
    const value = String(status || 'scheduled').toLowerCase();
    if (value === 'live' || value === 'paused' || value === 'ended') return value;
    return 'scheduled';
}

function parseIso(value) {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
}

function startEventScheduler(db) {
    if (!db) return;
    const intervalMs = Number.parseInt(process.env.EVENT_SCHEDULER_INTERVAL_MS || '', 10);
    const tickInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;

    const processEvents = () => {
        db.all(`SELECT id, status, scheduled_start_at, auto_end_at FROM events`, [], (err, rows) => {
            if (err) {
                // eslint-disable-next-line no-console
                console.error('[eventScheduler] Failed to query events:', err);
                return;
            }

            const now = Date.now();
            const durationMs = getAutoEndDurationMs();

            (rows || []).forEach((row) => {
                const status = normalizeStatus(row.status);
                if (status === 'ended') {
                    return;
                }

                const startMs = parseIso(row.scheduled_start_at);
                const endMs = parseIso(row.auto_end_at);

                if (endMs && now >= endMs) {
                    db.run(
                        `UPDATE events SET status = 'ended', auto_end_at = ? WHERE id = ? AND status != 'ended'`,
                        [new Date(endMs).toISOString(), row.id],
                        (updateErr) => {
                            if (updateErr) {
                                // eslint-disable-next-line no-console
                                console.error('[eventScheduler] Failed to auto-stop event', row.id, updateErr);
                            }
                        }
                    );
                    return;
                }

                if (status === 'live' && (!endMs || endMs <= now)) {
                    const autoEndIso = new Date(now + durationMs).toISOString();
                    db.run(
                        `UPDATE events SET auto_end_at = ? WHERE id = ?`,
                        [autoEndIso, row.id],
                        (updateErr) => {
                            if (updateErr) {
                                // eslint-disable-next-line no-console
                                console.error('[eventScheduler] Failed to extend auto end for event', row.id, updateErr);
                            }
                        }
                    );
                    return;
                }

                if (startMs && startMs + durationMs <= now && status === 'scheduled') {
                    const endIso = new Date(startMs + durationMs).toISOString();
                    db.run(
                        `UPDATE events SET status = 'ended', auto_end_at = ? WHERE id = ? AND status != 'ended'`,
                        [endIso, row.id],
                        (updateErr) => {
                            if (updateErr) {
                                // eslint-disable-next-line no-console
                                console.error('[eventScheduler] Failed to close expired scheduled event', row.id, updateErr);
                            }
                        }
                    );
                    return;
                }

                const shouldAutoStart = startMs && now >= startMs && (status === 'scheduled' || status === 'paused');

                if (shouldAutoStart) {
                    const baseMs = startMs;
                    const autoEndIso = endMs && endMs > now
                        ? new Date(endMs).toISOString()
                        : new Date(baseMs + durationMs).toISOString();
                    const scheduledIso = new Date(startMs).toISOString();

                    db.run(
                        `UPDATE events SET status = 'live', scheduled_start_at = COALESCE(scheduled_start_at, ?), auto_end_at = ? WHERE id = ? AND status != 'ended'`,
                        [scheduledIso, autoEndIso, row.id],
                        (updateErr) => {
                            if (updateErr) {
                                // eslint-disable-next-line no-console
                                console.error('[eventScheduler] Failed to auto-start event', row.id, updateErr);
                            }
                        }
                    );
                }
            });
        });
    };

    setInterval(processEvents, tickInterval);
    processEvents();
}

module.exports = { startEventScheduler };

