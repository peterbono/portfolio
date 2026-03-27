export class RunNotifier {
    runFriendlyId;
    socket;
    onNotify;
    logger;
    lastNotificationAt = null;
    notificationCount = 0;
    lastInvalidNotificationAt = null;
    invalidNotificationCount = 0;
    constructor(opts) {
        this.runFriendlyId = opts.runFriendlyId;
        this.socket = opts.supervisorSocket;
        this.onNotify = opts.onNotify;
        this.logger = opts.logger;
    }
    start() {
        this.sendDebugLog("start");
        this.socket.on("run:notify", async ({ version, run }) => {
            // Generate a unique ID for the notification
            const notificationId = Math.random().toString(36).substring(2, 15);
            // Use this to track the notification incl. any processing
            const notification = {
                id: notificationId,
                runId: run.friendlyId,
                version,
            };
            if (run.friendlyId !== this.runFriendlyId) {
                this.sendDebugLog("run:notify received invalid notification", { notification });
                this.invalidNotificationCount++;
                this.lastInvalidNotificationAt = new Date();
                return;
            }
            this.sendDebugLog("run:notify received by runner", { notification });
            this.notificationCount++;
            this.lastNotificationAt = new Date();
            await this.onNotify(`notifier:${notificationId}`);
        });
        return this;
    }
    stop() {
        this.sendDebugLog("stop");
        this.socket.removeAllListeners("run:notify");
    }
    get metrics() {
        return {
            lastNotificationAt: this.lastNotificationAt,
            notificationCount: this.notificationCount,
            lastInvalidNotificationAt: this.lastInvalidNotificationAt,
            invalidNotificationCount: this.invalidNotificationCount,
        };
    }
    sendDebugLog(message, properties) {
        this.logger.sendDebugLog({
            runId: this.runFriendlyId,
            message: `[notifier] ${message}`,
            properties: {
                ...properties,
                ...this.metrics,
            },
        });
    }
}
//# sourceMappingURL=notifier.js.map