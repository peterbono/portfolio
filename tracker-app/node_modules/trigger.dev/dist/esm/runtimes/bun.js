export function bunPlugin() {
    return {
        name: "bun",
        setup(build) {
            build.onResolve({ filter: /^bun:/ }, (args) => {
                return { path: args.path, external: true };
            });
        },
    };
}
//# sourceMappingURL=bun.js.map