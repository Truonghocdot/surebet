import {
  dashboardSnapshotSchema,
  opportunityBoardSchema
} from "@/features/dashboard/schemas/crm-schemas";
import { crmHttp } from "@/lib/http";

export async function fetchDashboardSnapshot() {
  const response = await crmHttp.get("/crm/dashboard");
  return dashboardSnapshotSchema.parse(response.data);
}

export async function fetchOpportunityBoard(signal?: AbortSignal) {
  const response = await crmHttp.get("/crm/opportunity-board", {
    signal,
    timeout: 3_000
  });
  return opportunityBoardSchema.parse(response.data);
}
