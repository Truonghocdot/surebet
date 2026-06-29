import {
  accountSchema,
  bookmakerSettingsResponseSchema,
  dashboardSnapshotSchema,
  featureFlagSchema,
  opportunitySchema,
  orderSchema,
  riskCheckpointSchema
} from "@/features/dashboard/schemas/crm-schemas";
import { crmHttp } from "@/lib/http";

export async function fetchDashboardSnapshot() {
  const response = await crmHttp.get("/crm/dashboard");
  return dashboardSnapshotSchema.parse(response.data);
}

export async function fetchOpportunities() {
  const response = await crmHttp.get("/crm/opportunities");
  return response.data.map((item: unknown) => opportunitySchema.parse(item));
}

export async function fetchOrders() {
  const response = await crmHttp.get("/crm/orders");
  return response.data.map((item: unknown) => orderSchema.parse(item));
}

export async function fetchAccounts() {
  const response = await crmHttp.get("/crm/accounts");
  return response.data.map((item: unknown) => accountSchema.parse(item));
}

export async function fetchRiskCheckpoints() {
  const response = await crmHttp.get("/crm/risk");
  return response.data.map((item: unknown) => riskCheckpointSchema.parse(item));
}

export async function fetchFeatureFlags() {
  const response = await crmHttp.get("/crm/feature-flags");
  return response.data.map((item: unknown) => featureFlagSchema.parse(item));
}

export async function fetchBookmakerSettings() {
  const response = await crmHttp.get("/crm/settings");
  const parsed = bookmakerSettingsResponseSchema.parse(response.data);
  return parsed.data;
}

export async function updateBookmakerSetting(payload: unknown) {
  const response = await crmHttp.put("/crm/settings", payload);
  return response.data;
}
