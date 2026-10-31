// Supplier Scout Agent – öffentliche Schnittstelle. Dokumentation: docs/SUPPLIER-AGENT.md

export * from "./model";
export * from "./adapter";
export * from "./rules";
export * from "./eligibility";
export * from "./financing";
export * from "./scoring";
export * from "./compare";
export * from "./scout";
export * from "./purchase-bridge";
export * from "./evidence";
export { DEMO_ADAPTERS, DEMO_QUERIES, createDemoAdapter } from "./demo/demo-suppliers";
