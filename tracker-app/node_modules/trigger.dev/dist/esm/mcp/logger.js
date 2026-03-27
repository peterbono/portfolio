import { appendFileSync } from "node:fs";
import util from "node:util";
export class FileLogger {
    filePath;
    server;
    constructor(filePath, server) {
        this.filePath = filePath;
        this.server = server;
    }
    log(message, ...args) {
        const logMessage = `[${new Date().toISOString()}][${this.formatServerInfo()}] ${message} - ${util.inspect(args, {
            depth: null,
            colors: false,
        })}\n`;
        appendFileSync(this.filePath, logMessage);
    }
    formatServerInfo() {
        return `${this.formatClientName()} ${this.formatClientVersion()} ${this.formatClientCapabilities()}`;
    }
    formatClientName() {
        const clientName = this.server.server.getClientVersion()?.name;
        return `client=${clientName ?? "unknown"}`;
    }
    formatClientVersion() {
        const clientVersion = this.server.server.getClientVersion();
        return `version=${clientVersion?.version ?? "unknown"}`;
    }
    formatClientCapabilities() {
        const clientCapabilities = this.server.server.getClientCapabilities();
        const keys = Object.keys(clientCapabilities ?? {});
        return `capabilities=${keys.join(",")}`;
    }
}
//# sourceMappingURL=logger.js.map