import { create } from "zustand";

export type RealtimeStatus = "connecting" | "live" | "reconnecting";
export type OpportunityNotificationKind = "candidate" | "confirmed";

export type OpportunityNotification = {
  id: string;
  kind: OpportunityNotificationKind;
  opportunityID: string;
  fixtureID: string;
  marketName: string;
  profitPercentage: number;
};

type RealtimeNotificationState = {
  status: RealtimeStatus;
  notifications: OpportunityNotification[];
  seenNotificationIDs: Record<string, true>;
  setStatus: (status: RealtimeStatus) => void;
  pushNotification: (notification: Omit<OpportunityNotification, "id">) => void;
  dismissNotification: (id: string) => void;
};

export const useRealtimeNotificationStore = create<RealtimeNotificationState>((set) => ({
  status: "connecting",
  notifications: [],
  seenNotificationIDs: {},
  setStatus: (status) => set({ status }),
  pushNotification: (notification) => set((state) => {
    const id = `${notification.kind}:${notification.opportunityID}`;
    if (state.seenNotificationIDs[id]) {
      return state;
    }

    return {
      notifications: [{ ...notification, id }, ...state.notifications].slice(0, 4),
      seenNotificationIDs: { ...state.seenNotificationIDs, [id]: true }
    };
  }),
  dismissNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((notification) => notification.id !== id)
  }))
}));
