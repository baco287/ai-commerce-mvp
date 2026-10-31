// Supplier Scout Agent – öffentliche Schnittstelle. Dokumentation: docs/SUPPLIER-AGENT.md

export * from "./model";
export * from "./adapter";
export * from "./rules";
export * from "./eligibility";
export * from "./financing";
export * from "./funding";
export * from "./scoring";
export * from "./compare";
export * from "./scout";
export * from "./purchase-bridge";
export * from "./legacy";
export * from "./dashboard";
export * from "./links";
export {
  DEMO_ADAPTERS,
  DEMO_DOC_TYPES,
  DEMO_QUERIES,
  DEMO_REQUIRED_DOCUMENTS,
  DEMO_SUPPLIER_QUOTES,
  createDemoAdapter,
  demoQuotesFor,
  type DemoProductId,
} from "./demo/demo-suppliers";
export * from "./identity";
export * from "./documents";
export * from "./liquidity";
export * from "./variant-match";
