import { resolveDotEnvVars } from "./dotEnv.js";
import { sanitizeEnvVars } from "./sanitizeEnvVars.js";
export function resolveLocalEnvVars(envFile, additionalVariables) {
    const processEnv = gatherProcessEnv();
    const dotEnvVars = resolveDotEnvVars(undefined, envFile);
    return {
        ...sanitizeEnvVars(processEnv),
        ...sanitizeEnvVars(additionalVariables ?? {}),
        ...sanitizeEnvVars(dotEnvVars),
    };
}
function gatherProcessEnv() {
    const $env = {
        ...process.env,
    };
    // Filter out undefined values
    return Object.fromEntries(Object.entries($env).filter(([key, value]) => value !== undefined));
}
//# sourceMappingURL=localEnvVars.js.map