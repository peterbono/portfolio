export class MetadataClient {
    url;
    constructor(url) {
        this.url = new URL(url);
    }
    async getEnvOverrides() {
        try {
            const response = await fetch(new URL("/env", this.url));
            if (!response.ok) {
                return [new Error(`Status ${response.status} ${response.statusText}`), null];
            }
            return [null, await response.json()];
        }
        catch (error) {
            return [error instanceof Error ? error : new Error(String(error)), null];
        }
    }
}
//# sourceMappingURL=overrides.js.map