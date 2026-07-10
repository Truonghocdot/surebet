import {
  dashboardSnapshotSchema,
  opportunitySchema
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
