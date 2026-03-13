import { db, collection, addDoc, serverTimestamp } from '../firebase';

export interface QueuedNote {
  id: string;
  reportTitle: string;
  caseNotes: string;
  caseType: string;
  childInfo: string;
  state: string;
  timestamp: number;
}

const OFFLINE_QUEUE_KEY = 'cps_offline_queue';

export const offlineQueueService = {
  getQueue(): QueuedNote[] {
    const queue = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return queue ? JSON.parse(queue) : [];
  },

  addToQueue(note: Omit<QueuedNote, 'id' | 'timestamp'>) {
    const queue = this.getQueue();
    const newNote: QueuedNote = {
      ...note,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    queue.push(newNote);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    return newNote;
  },

  removeFromQueue(id: string) {
    const queue = this.getQueue();
    const filtered = queue.filter(item => item.id !== id);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
  },

  async processQueue(userId: string, onProgress?: (id: string) => void) {
    const queue = this.getQueue();
    if (queue.length === 0) return;

    for (const item of queue) {
      try {
        // Attempt to save to Firestore first as a record
        await addDoc(collection(db, 'reports'), {
          userId,
          reportTitle: item.reportTitle,
          caseNotes: item.caseNotes,
          caseType: item.caseType,
          childInfo: item.childInfo,
          state: item.state,
          status: 'pending_offline_sync',
          createdAt: serverTimestamp(),
          isOfflineGenerated: true
        });
        
        if (onProgress) onProgress(item.id);
        this.removeFromQueue(item.id);
      } catch (error) {
        console.error("Failed to sync offline note:", error);
        // Stop processing if we're still offline
        if (!navigator.onLine) break;
      }
    }
  }
};
