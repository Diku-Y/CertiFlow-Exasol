import { env } from "../config/env";
import { AppError } from "../utils/httpError";
import { bump } from "./redis/primitives";
import type { Features } from "./featureEngine";
import type { MlResult } from "./riskEngine";

/** Simple in-process circuit breaker so a dead ML service does not add its timeout to every payment. */
const breaker = { failures: 0, openUntil: 0 };
const FAILURE_LIMIT = 3;
const OPEN_MS = 15000;

const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(env.mlApiKey ? { "X-Service-Key": env.mlApiKey } : {})
});

export const mlRequest = async <T = any>(path: string, method: "GET" | "POST" = "GET", body?: unknown, timeoutMs = env.mlTimeoutMs): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
        response = await fetch(`${env.mlUrl}${path}`, {
            method, headers: headers(), signal: controller.signal,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (error) {
        throw new AppError(503, "The ML service is unreachable right now", "ML_UNAVAILABLE", (error as Error).message);
    } finally {
        clearTimeout(timer);
    }
    const text = await response.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 200) }; }
    if (!response.ok) {
        if (response.status >= 400 && response.status < 500) throw new AppError(response.status === 409 ? 409 : 400, json.message || "ML service rejected the request", "ML_REJECTED");
        throw new AppError(502, json.message || `ML service error (${response.status})`, "ML_ERROR");
    }
    return json as T;
};

/** Score a payment. Returns null (never throws) when the model cannot be reached. */
export const predictRisk = async (features: Features): Promise<MlResult | null> => {
    if (Date.now() < breaker.openUntil) return null;
    bump("ml_calls");
    try {
        const result = await mlRequest<MlResult>("/predict", "POST", { features });
        breaker.failures = 0;
        return result;
    } catch (error) {
        bump("ml_failures");
        breaker.failures += 1;
        if (breaker.failures >= FAILURE_LIMIT) {
            breaker.openUntil = Date.now() + OPEN_MS;
            console.warn(`ML circuit opened for ${OPEN_MS / 1000}s: ${(error as Error).message}`);
        }
        return null;
    }
};

export const mlHealth = async (): Promise<{ up: boolean; latencyMs: number | null; version: number | null; breakerOpen: boolean; error?: string }> => {
    const started = Date.now();
    try {
        const h = await mlRequest("/health", "GET", undefined, 2000);
        return { up: h.status === "ok", latencyMs: Date.now() - started, version: h.model_version ?? null, breakerOpen: Date.now() < breaker.openUntil };
    } catch (error) {
        return { up: false, latencyMs: null, version: null, breakerOpen: Date.now() < breaker.openUntil, error: (error as Error).message };
    }
};

/** Verify at start-up that the model and the backend agree on the feature contract. */
export const checkFeatureContract = async (expected: readonly string[]): Promise<void> => {
    try {
        const info = await mlRequest("/features", "GET", undefined, 4000);
        const same = JSON.stringify(info.features) === JSON.stringify(expected);
        if (!same) console.error("!! ML feature contract differs from the backend feature engine - predictions will be wrong. Retrain / redeploy.");
        else console.log(`ML feature contract verified (${expected.length} features)`);
    } catch {
        console.warn("ML service not reachable at start-up; payments will use rules only until it is.");
    }
};
