const DB_NAME = 'gespropec_db';
const DB_VERSION = 1;

let dbInstance = null;

export function initDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database failed to open:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Leads store
      if (!db.objectStoreNames.contains('leads')) {
        const leadStore = db.createObjectStore('leads', { keyPath: 'id' });
        leadStore.createIndex('status', 'status', { unique: false });
        leadStore.createIndex('email', 'email', { unique: false });
        leadStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 2. Logs / Activity store
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('leadId', 'leadId', { unique: false });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // 3. Reminders / Tasks / Calendar store
      if (!db.objectStoreNames.contains('reminders')) {
        const reminderStore = db.createObjectStore('reminders', { keyPath: 'id', autoIncrement: true });
        reminderStore.createIndex('leadId', 'leadId', { unique: false });
        reminderStore.createIndex('date', 'date', { unique: false });
        reminderStore.createIndex('status', 'status', { unique: false });
      }
    };
  });
}

// Helper to run transactions
function getStore(storeName, mode = 'readonly') {
  return initDB().then((db) => {
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  });
}

/* ==========================================================================
   LEADS OPERATIONS
   ========================================================================== */

export async function getAllLeads() {
  const store = await getStore('leads');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getLeadById(id) {
  const store = await getStore('leads');
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addLead(lead) {
  const store = await getStore('leads', 'readwrite');
  const timestamp = new Date().toISOString();
  const newLead = {
    ...lead,
    createdAt: lead.createdAt || timestamp,
    updatedAt: timestamp,
    status: lead.status || 'new'
  };

  return new Promise((resolve, reject) => {
    const request = store.add(newLead);
    request.onsuccess = () => resolve(newLead);
    request.onerror = () => reject(request.error);
  });
}

export async function updateLead(lead) {
  const store = await getStore('leads', 'readwrite');
  const updatedLead = {
    ...lead,
    updatedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const request = store.put(updatedLead);
    request.onsuccess = () => resolve(updatedLead);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteLead(id) {
  // Delete the lead
  const leadStore = await getStore('leads', 'readwrite');
  await new Promise((resolve, reject) => {
    const request = leadStore.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Cascade delete logs
  const logsStore = await getStore('logs', 'readwrite');
  const index = logsStore.index('leadId');
  const logRequest = index.openCursor(IDBKeyRange.only(id));
  logRequest.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  // Cascade delete reminders
  const reminderStore = await getStore('reminders', 'readwrite');
  const remIndex = reminderStore.index('leadId');
  const remRequest = remIndex.openCursor(IDBKeyRange.only(id));
  remRequest.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}

/* ==========================================================================
   LOGS / ACTIVITIES OPERATIONS
   ========================================================================== */

export async function getLogsForLead(leadId) {
  const store = await getStore('logs');
  const index = store.index('leadId');
  
  return new Promise((resolve, reject) => {
    const request = index.getAll(IDBKeyRange.only(leadId));
    request.onsuccess = () => {
      // Sort chronologically by timestamp descending
      const sorted = request.result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      resolve(sorted);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addLog(leadId, type, content) {
  const store = await getStore('logs', 'readwrite');
  const logEntry = {
    leadId,
    type, // 'call', 'email', 'whatsapp', 'meeting', 'note', 'system'
    content,
    timestamp: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const request = store.add(logEntry);
    request.onsuccess = () => resolve(logEntry);
    request.onerror = () => reject(request.error);
  });
}

/* ==========================================================================
   REMINDERS / EVENTS OPERATIONS
   ========================================================================== */

export async function getAllReminders() {
  const store = await getStore('reminders');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getRemindersForLead(leadId) {
  const store = await getStore('reminders');
  const index = store.index('leadId');
  
  return new Promise((resolve, reject) => {
    const request = index.getAll(IDBKeyRange.only(leadId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addReminder(reminder) {
  const store = await getStore('reminders', 'readwrite');
  const newReminder = {
    ...reminder,
    status: reminder.status || 'pending', // 'pending', 'completed'
    createdAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const request = store.add(newReminder);
    request.onsuccess = (e) => {
      newReminder.id = e.target.result;
      resolve(newReminder);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateReminder(reminder) {
  const store = await getStore('reminders', 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(reminder);
    request.onsuccess = () => resolve(reminder);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteReminder(id) {
  const store = await getStore('reminders', 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/* ==========================================================================
   DATA EXPORT & IMPORT (JSON BACKUP)
   ========================================================================== */

export async function exportDatabase() {
  const leads = await getAllLeads();
  
  // Get all logs
  const logStore = await getStore('logs');
  const logs = await new Promise((resolve, reject) => {
    const req = logStore.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Get all reminders
  const reminders = await getAllReminders();

  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      leads,
      logs,
      reminders
    }
  };
}

export async function importDatabase(backupData) {
  if (!backupData || !backupData.data) {
    throw new Error('Invalid backup data format');
  }

  const { leads = [], logs = [], reminders = [] } = backupData.data;

  // Clear existing databases
  const db = await initDB();
  
  // Create a transaction for clearing and loading all stores
  const transaction = db.transaction(['leads', 'logs', 'reminders'], 'readwrite');
  
  const clearStore = (storeName) => {
    return new Promise((resolve, reject) => {
      const req = transaction.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  };

  const populateStore = (storeName, items) => {
    return Promise.all(items.map(item => {
      return new Promise((resolve, reject) => {
        const req = transaction.objectStore(storeName).put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }));
  };

  await clearStore('leads');
  await clearStore('logs');
  await clearStore('reminders');

  await populateStore('leads', leads);
  await populateStore('logs', logs);
  await populateStore('reminders', reminders);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve({
        leadsCount: leads.length,
        logsCount: logs.length,
        remindersCount: reminders.length
      });
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ==========================================================================
   AGENT FILTER OPERATIONS
   ========================================================================== */

export async function getLeadsFilteredByAgent() {
  const allLeads = await getAllLeads();
  
  // Retrieve active agents list from LocalStorage, default to all if not set
  let activeAgents = ['jordan', 'sandra', 'unassigned'];
  const saved = localStorage.getItem('gespropec_active_agents');
  if (saved) {
    try {
      activeAgents = JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }

  // If no filters are active, treat as "show all" or "none". Let's show all for a better UX,
  // or show empty list if they explicitly deselected everything.
  // Wait, let's treat it as: if the array is empty, show nothing.
  if (!activeAgents || activeAgents.length === 0) {
    return [];
  }

  return allLeads.filter(lead => {
    // Normalize agent names. E.g. lead.agent can be 'jordan', 'sandra', or undefined/empty (unassigned)
    const agent = (lead.agent || 'unassigned').toLowerCase().trim();
    return activeAgents.includes(agent);
  });
}

export async function getFilteredReminders() {
  const reminders = await getAllReminders();
  const leads = await getLeadsFilteredByAgent();
  const validLeadIds = new Set(leads.map(l => l.id));
  
  return reminders.filter(rem => validLeadIds.has(rem.leadId));
}
