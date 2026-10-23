/**
 * Realtime signals that are UI state rather than server data: unseen new-post
 * counts, typing indicators, which DM threads are on screen, and the latest live stage
 * change of the viewer's applications (the status timeline animates it).
 */
import { create } from "zustand";
import { typingReducer, type TypingState } from "../realtime/reducers";

/** Key for the home feed's new-posts counter. */
export const HOME_FEED = "__home__";

interface SignalsStore {
  newPosts: Record<string, number>;
  addNewPosts: (key: string, count: number) => void;
  clearNewPosts: (key: string) => void;
  typing: TypingState;
  setTyping: (e: { roomId: string; userId: string; name: string; typing: boolean }) => void;
  visibleThreads: Record<string, number>;
  showThread: (id: string) => () => void;
  modOpenCases: number | null;
  setModOpenCases: (n: number) => void;
  /** applicationId -> the stage it just moved to (live, from application:stage). */
  liveStages: Record<string, string>;
  noteApplicationStage: (applicationId: string, stage: string) => void;
}

export const useSignals = create<SignalsStore>((set) => ({
  newPosts: {},
  addNewPosts: (key, count) => set((s) => ({ newPosts: { ...s.newPosts, [key]: (s.newPosts[key] ?? 0) + Math.max(1, count) } })),
  clearNewPosts: (key) => set((s) => ({ newPosts: { ...s.newPosts, [key]: 0 } })),
  typing: {},
  setTyping: (e) => set((s) => ({ typing: typingReducer(s.typing, e, Date.now()) })),
  visibleThreads: {},
  showThread: (id) => {
    set((s) => ({ visibleThreads: { ...s.visibleThreads, [id]: (s.visibleThreads[id] ?? 0) + 1 } }));
    return () =>
      set((s) => {
        const n = (s.visibleThreads[id] ?? 1) - 1;
        const next = { ...s.visibleThreads };
        if (n <= 0) delete next[id];
        else next[id] = n;
        return { visibleThreads: next };
      });
  },
  modOpenCases: null,
  setModOpenCases: (n) => set({ modOpenCases: n }),
  liveStages: {},
  noteApplicationStage: (applicationId, stage) => set((s) => ({ liveStages: { ...s.liveStages, [applicationId]: stage } })),
}));
