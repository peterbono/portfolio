export function buildManifestToJSON(manifest) {
    const { deploy, build, externals, ...rest } = manifest;
    return {
        ...rest,
        // sort externals for deterministic builds
        externals: externals?.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
        deploy: {},
        build: {},
    };
}
//# sourceMappingURL=buildManifest.js.map