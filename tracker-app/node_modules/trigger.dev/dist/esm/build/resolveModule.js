// @ts-ignore
import { resolvePath } from "mlly";
export function resolveModule(moduleName, url) {
    return resolvePath(moduleName, {
        // @ts-ignore
        url: url ?? import.meta.url,
    });
}
//# sourceMappingURL=resolveModule.js.map