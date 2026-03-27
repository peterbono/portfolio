export function safeJsonParse(json) {
    if (!json) {
        return undefined;
    }
    try {
        return JSON.parse(json);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=safeJsonParse.js.map