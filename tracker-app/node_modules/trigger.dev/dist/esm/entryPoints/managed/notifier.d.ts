import type { SupervisorSocket } from "./controller.js";
import type { RunLogger } from "./logger.js";
type OnNotify = (source: string) => Promise<void>;
type RunNotifierOptions = {
    runFriendlyId: string;
    supervisorSocket: SupervisorSocket;
    onNotify: OnNotify;
    logger: RunLogger;
};
export declare class RunNotifier {
    private runFriendlyId;
    private socket;
    private onNotify;
    private logger;
    private lastNotificationAt;
    private notificationCount;
    private lastInvalidNotificationAt;
    private invalidNotificationCount;
    constructor(opts: RunNotifierOptions);
    start(): RunNotifier;
    stop(): void;
    get metrics(): {
        lastNotificationAt: Date | null;
        notificationCount: number;
        lastInvalidNotificationAt: Date | null;
        invalidNotificationCount: number;
    };
    private sendDebugLog;
}
export {};
