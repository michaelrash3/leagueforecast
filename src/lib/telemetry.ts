export type TelemetryEvent = "simulation_runtime";

export type TelemetryPayload = {
  simulation_runtime: { runtime: "worker" | "inline" };
};

export const telemetry = {
  track<E extends TelemetryEvent>(_event: E, _payload: TelemetryPayload[E]) {
    // Intentionally no-op for now. Centralized wrapper keeps instrumentation structured + testable.
  },
};
