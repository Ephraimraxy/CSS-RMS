import localforage from 'localforage';
import { toast } from 'react-hot-toast';
import React from 'react';
import api, { deptAPI, reqAPI, auditAPI, iccAPI, userAPI, forwardAPI, vettingAPI, hrAPI, kivAPI } from './api';

// ── Configure storage namespaces ──
const requisitionStore = localforage.createInstance({ name: 'CSS_RMS', storeName: 'requisitions' });
const activityStore = localforage.createInstance({ name: 'CSS_RMS', storeName: 'activity' });
const workflowStore = localforage.createInstance({ name: 'CSS_RMS', storeName: 'workflows' });
const departmentStore = localforage.createInstance({ name: 'CSS_RMS', storeName: 'departments' });
const syncQueueStore    = localforage.createInstance({ name: 'CSS_RMS', storeName: 'sync_queue' });
const notificationStore = localforage.createInstance({ name: 'CSS_RMS', storeName: 'notifications' });
const fileUploadStore   = localforage.createInstance({ name: 'CSS_RMS', storeName: 'file_uploads' });
const reqDetailStore    = localforage.createInstance({ name: 'CSS_RMS', storeName: 'req_details' });

// ── HR offline stores ──
const hrEmployeeStore   = localforage.createInstance({ name: 'CSS_RMS', storeName: 'hr_employees' });
const hrLeaveStore      = localforage.createInstance({ name: 'CSS_RMS', storeName: 'hr_leaves' });
const hrAttendanceStore = localforage.createInstance({ name: 'CSS_RMS', storeName: 'hr_attendance' });
const hrPayrollStore    = localforage.createInstance({ name: 'CSS_RMS', storeName: 'hr_payroll' });
const hrJobStore        = localforage.createInstance({ name: 'CSS_RMS', storeName: 'hr_jobs' });
const hrStatsStore      = localforage.createInstance({ name: 'CSS_RMS', storeName: 'hr_stats' });

// ── File blob helpers for offline queuing ──
const OFFLINE_FILE_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB total guard

async function storeFileBlob(file) {
  const key = `file_${generateClientId()}`;
  const buffer = await file.arrayBuffer();
  await fileUploadStore.setItem(key, { name: file.name, type: file.type, size: file.size, buffer });
  return key;
}

async function restoreFile(key) {
  const stored = await fileUploadStore.getItem(key);
  if (!stored) return null;
  return new File([stored.buffer], stored.name, { type: stored.type });
}

async function cleanupFileBlobs(keys) {
  await Promise.all(keys.map(k => fileUploadStore.removeItem(k)));
}

// ── Seed data ──
const SEED_REQUISITIONS = [];

const getRecordType = (recordOrType) => {
  const rawType = typeof recordOrType === 'string' ? recordOrType : recordOrType?.type;
  return String(rawType || '').trim().toLowerCase();
};

export const isMemoRecord = (recordOrType) => {
  const type = getRecordType(recordOrType);
  return type.includes('memo') || type.includes('memorandum');
};

export const isOperationalRequisition = (recordOrType) => {
  const type = getRecordType(recordOrType);
  return type.startsWith('cash') || type.startsWith('material');
};

const normalizeRequisitionList = (rawList) => rawList.map(r => ({
  ...r,
  department:       r.department?.name || r.department || r.departmentName,
  isFromSubAccount: r.department?.isSubAccount === true, // preserve before department is flattened to string
  deptHeadName:     r.department?.headName ?? '',
  parentDeptId:     r.department?.parentId ?? null,     // parent dept ID for sub-accounts
  parentDeptName:   r.parentDeptName ?? r.department?.parent?.name ?? '', // parent dept name for sub-accounts
  refCode:          r.refCode ?? null,
  creator:          r.creator?.name || r.creator || r.creatorName,
  currentStageName: r.currentStage?.name || r.currentStageName
}));

const filterRecordsForScope = (records, scope) => {
  if (scope === 'requisitions') return records.filter(isOperationalRequisition);
  if (scope === 'memos') return records.filter(isMemoRecord);
  return records;
};

const getScopeCacheKey = (scope) => scope && scope !== 'all' ? `all:${scope}` : 'all';

// ── Initialize store with seed data ──
let _initialized = false;
const generateClientId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};
async function ensureInitialized() {
  if (_initialized) return;

  // CRITICAL: Clear out old mock data from previous sessions if they exist
  const dbVersion = await localforage.getItem('rms_db_version');
  if (dbVersion !== '3.0') {
    await requisitionStore.clear();
    await activityStore.clear();
    await workflowStore.clear();
    await departmentStore.clear();
    await localforage.setItem('rms_db_version', '3.0');
  }

  const existingActivity = await activityStore.getItem('log');
  if (!existingActivity) {
    await activityStore.setItem('log', []);
  }
  _initialized = true;
}

// ── Cache management ──
export async function clearAllCaches() {
  _initialized = false;
  await Promise.allSettled([
    requisitionStore.clear(),
    activityStore.clear(),
    workflowStore.clear(),
    departmentStore.clear(),
    reqDetailStore.clear(),
    notificationStore.clear(),
  ]);
}

// ── Requisition Logic ──
export async function getRequisitions(options = {}) {
  await ensureInitialized();
  const scope = typeof options === 'string' ? options : (options.scope || 'all');
  const cacheKey = getScopeCacheKey(scope);
  try {
    const remote = await reqAPI.getRequisitions(scope && scope !== 'all' ? { scope } : {});
    // Handle both paginated { data, total } and legacy plain-array responses
    const rawList = Array.isArray(remote) ? remote : (Array.isArray(remote?.data) ? remote.data : []);
    const normalized = filterRecordsForScope(normalizeRequisitionList(rawList), scope);
    await requisitionStore.setItem(cacheKey, normalized);
    if (scope === 'all') await requisitionStore.setItem('all', normalized);
    return normalized;
  } catch (err) {
    console.warn("Offline: Fetching cached requisitions", err);
    const scoped = await requisitionStore.getItem(cacheKey);
    if (Array.isArray(scoped)) return scoped;
    const local = await requisitionStore.getItem('all');
    return Array.isArray(local) ? filterRecordsForScope(local, scope) : [];
  }
}

export async function getOperationalRequisitions() {
  return getRequisitions({ scope: 'requisitions' });
}

export async function getMemoRecords() {
  return getRequisitions({ scope: 'memos' });
}

export async function addRequisition(data) {
  await ensureInitialized();
  const items = Array.isArray(data) ? data : [data];
  const withClientIds = items.map(item => ({
    ...item,
    clientId: item.clientId || generateClientId()
  }));
  try {
    const result = await reqAPI.addRequisition(withClientIds);
    window.dispatchEvent(new CustomEvent('requisitionUpdated'));
    return result;
  } catch (err) {
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500) {
      // Auth/validation errors should not be queued as offline work.
      throw err;
    }
    console.warn("Offline: Saving to local sync queue");
    const queue = (await syncQueueStore.getItem('pending')) || [];
    withClientIds.forEach(payload => {
      queue.push({
        clientId: payload.clientId,
        payload,
        retryCount: 0,
        nextAttemptAt: Date.now(),
        lastError: null
      });
    });
    await syncQueueStore.setItem('pending', queue);
    toast("Offline: Requisition saved locally for sync");
    return null;
  }
}

export async function flushSyncQueue({ force = false } = {}) {
  const queue = (await syncQueueStore.getItem('pending')) || [];
  if (queue.length === 0) return { synced: 0, pending: 0 };

  const now = Date.now();
  const remaining = [];
  let synced = 0;

  for (const entry of queue) {
    if (!force && entry.nextAttemptAt && entry.nextAttemptAt > now) {
      remaining.push(entry);
      continue;
    }
    try {
      const type = entry.type || 'addRequisition';
      if (type === 'addRequisition') {
        await reqAPI.addRequisition(entry.payload);
      } else if (type === 'forward') {
        await forwardAPI.forward(entry.reqId, entry.payload);
      } else if (type === 'finalApprove') {
        await vettingAPI.finalApprove(entry.reqId, entry.payload.note);
      } else if (type === 'sendToVetting') {
        await vettingAPI.sendToVetting(entry.reqId, entry.payload.vettingDeptId);
      } else if (type === 'vettingAction') {
        await vettingAPI.vettingAction(entry.reqId, entry.payload);
      } else if (type === 'updateStatus') {
        const { newStatus, remarks } = entry.payload;
        if (newStatus === 'approved') await reqAPI.approveRequisition(entry.reqId, remarks);
        else if (newStatus === 'rejected') await reqAPI.rejectRequisition(entry.reqId, remarks);
      } else if (type === 'uploadAttachment') {
        const done = new Set(entry.uploadedKeys || []);
        const { stageName, stageKey, uploaderDept } = entry.meta || {};
        for (const key of entry.fileKeys) {
          if (done.has(key)) continue;
          const file = await restoreFile(key);
          if (file) {
            const formData = new FormData();
            formData.append('files', file);
            if (stageName) formData.append('stageName', stageName);
            if (stageKey) formData.append('stageKey', stageKey);
            if (uploaderDept) formData.append('uploaderDept', uploaderDept);
            await api.post(`/requisitions/${entry.requisitionId}/attachments`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
          }
          done.add(key);
          await cleanupFileBlobs([key]);
          // Persist progress so a crash here resumes from the next file
          entry.uploadedKeys = [...done];
          const liveQueue = (await syncQueueStore.getItem('pending')) || [];
          const idx = liveQueue.findIndex(e => e.clientId === entry.clientId);
          if (idx !== -1) { liveQueue[idx] = { ...entry }; await syncQueueStore.setItem('pending', liveQueue); }
        }
      } else if (type === 'vettingActionWithFile') {
        const file = await restoreFile(entry.fileKey);
        await vettingAPI.vettingAction(entry.reqId, { ...entry.payload, file });
        await cleanupFileBlobs([entry.fileKey]);
      }
      synced += 1;
    } catch (err) {
      const retryCount = (entry.retryCount || 0) + 1;
      const delay = Math.min(60000, 2000 * Math.pow(2, retryCount));
      remaining.push({
        ...entry,
        retryCount,
        nextAttemptAt: now + delay,
        lastError: err?.message || 'Sync failed'
      });
    }
  }

  await syncQueueStore.setItem('pending', remaining);
  if (synced > 0) {
    toast.success(`Synced ${synced} pending action(s) to server!`);
    window.dispatchEvent(new CustomEvent('requisitionUpdated'));
  }
  return { synced, pending: remaining.length };
}

export async function getSyncQueueStatus() {
  const queue = (await syncQueueStore.getItem('pending')) || [];
  return { pending: queue.length };
}

export async function uploadAttachments(requisitionId, files, { stageName, stageKey, uploaderDept, onProgress } = {}) {
  if (!navigator.onLine) {
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    if (totalSize > OFFLINE_FILE_SIZE_LIMIT) {
      toast.error('Files too large to queue offline (max 50 MB total)');
      throw new Error('Offline — files exceed 50 MB limit');
    }
    const fileKeys = await Promise.all(files.map(storeFileBlob));
    const queue = (await syncQueueStore.getItem('pending')) || [];
    queue.push({
      type: 'uploadAttachment',
      clientId: generateClientId(),
      requisitionId,
      fileKeys,
      uploadedKeys: [],
      meta: { stageName, stageKey, uploaderDept },
      retryCount: 0,
      nextAttemptAt: Date.now(),
      lastError: null
    });
    await syncQueueStore.setItem('pending', queue);
    toast('Offline: Files saved locally — will upload when reconnected.');
    return null;
  }

  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  if (stageName) formData.append('stageName', stageName);
  if (stageKey) formData.append('stageKey', stageKey);
  if (uploaderDept) formData.append('uploaderDept', uploaderDept);

  try {
    const response = await api.post(`/requisitions/${requisitionId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    return response;
  } catch (err) {
    console.error("Upload failed:", err);
    throw err;
  }
}

export async function getAttachments(requisitionId) {
  try {
    return await api.get(`/requisitions/${requisitionId}/attachments`);
  } catch (err) {
    return [];
  }
}

export async function updateRequisitionStatus(id, newStatus, remarks = '') {
  if (!['approved', 'rejected'].includes(newStatus)) return;

  try {
    const updated = newStatus === 'approved'
      ? await reqAPI.approveRequisition(id, remarks)
      : await reqAPI.rejectRequisition(id, remarks);

    const all = await requisitionStore.getItem('all') || [];
    const idx = all.findIndex(r => r.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...updated, status: updated.status || newStatus };
      await requisitionStore.setItem('all', all);
    }
    await logActivity(`${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)} Requisition`, `${id} status changed to ${newStatus}`);
    window.dispatchEvent(new CustomEvent('requisitionUpdated'));
    toast.success(`${id} has been ${newStatus}`, {
      icon: <img src="/CSS_Group.png" className="w-8 h-5 object-cover rounded" alt="" />
    });
  } catch (err) {
    if (!isNetworkError(err)) throw err;

    // Optimistically update local cache so UI reflects the action immediately
    const all = await requisitionStore.getItem('all') || [];
    const idx = all.findIndex(r => r.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], status: newStatus };
      await requisitionStore.setItem('all', all);
    }
    await queueOfflineAction('updateStatus', id, { newStatus, remarks });
    await logActivity(`${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)} Requisition (offline)`, `${id} queued for sync`);
    window.dispatchEvent(new CustomEvent('requisitionUpdated'));
    toast(`Offline: ${newStatus === 'approved' ? 'Approval' : 'Rejection'} queued — will sync when reconnected.`);
  }
}

export async function downloadSignedPdf(id) {
  const blob = await reqAPI.getSignedPdf(id);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `requisition-${id}.pdf`;
  link.click();
  window.URL.revokeObjectURL(url);
}

export async function downloadDynamicPdf(id, upToEventId = null) {
  try {
    const blob = await reqAPI.getDynamicPdf(id, upToEventId);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CSS-REPORT-${id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to download dynamic PDF', err);
    throw err;
  }
}

// ── Stats Computation ──
export async function getDashboardStats(user) {
  const all = await getRequisitions({ scope: 'all' });
  return computeDashboardStats(all, user);
}

// Pure computation half of getDashboardStats, split out so it's unit-testable with a
// hand-built fixture list instead of needing to mock the network fetch above. This is
// also exactly the function that had the "admin dashboard always reads zero" bug — Super
// Admin's login is backed by a real Department row, so gating on `!userDeptId` to detect
// "is this admin" was wrong and silently fell through to the narrow per-department branch.
export function computeDashboardStats(all, user) {
  const emptyStats = { pending: 0, approved: 0, rejected: 0, totalSpent: 0, memos: 0, memoPending: 0, memoPublished: 0, treated: 0, approvedByMe: 0 };
  if (!user) return emptyStats;

  const userDeptId = user.deptId ? Number(user.deptId) : null;
  const userDeptName = user.departmentName || '';
  const isAdmin = (user.role || '').toLowerCase().replace(/\s+/g, '_') === 'global_admin';
  if (!userDeptId && !isAdmin) return emptyStats;
  const isExecutive = isAdmin ||
    /ceo|chairman/i.test(userDeptName) ||
    /general\s*manager|\bgm\b/i.test(userDeptName);
  const isAccountDept = /\baccount\b/i.test(userDeptName);

  const DONE_STATES = ['treated', 'published'];
  // "Pending" on dashboard means items still awaiting this dept's action
  const pendingActions = all.filter(r => {
    if (DONE_STATES.includes(r.finalApprovalStatus)) return false; // fully processed
    // Admin gets total oversight regardless of deptId — Super Admin's login is itself
    // backed by a real Department row ("Super Admin"), so userDeptId is NOT null/falsy
    // for admin; gating this branch on `!userDeptId` silently fell through to the narrow
    // per-department filter below and made every admin stat read zero.
    if (isAdmin) {
      return r.status === 'pending' || r.finalApprovalStatus === 'vetting' ||
        (r.status === 'approved' && (!r.finalApprovalStatus || r.finalApprovalStatus === 'none'));
    }
    const isTargeted = Number(r.targetDepartmentId) === userDeptId &&
      r.status === 'pending' &&
      (!r.finalApprovalStatus || r.finalApprovalStatus === 'none');
    const needsFinal = isExecutive && r.status === 'approved' && (!r.finalApprovalStatus || r.finalApprovalStatus === 'none');
    const isVetting = Number(r.currentVettingDeptId) === userDeptId && r.finalApprovalStatus === 'vetting';
    // Partial payment: Account keeps the request open — must still show as pending for them
    const isPartialBalance = isAccountDept && userDeptId && r.finalApprovalStatus === 'partial' &&
      (Number(r.currentVettingDeptId) === userDeptId || Number(r.targetDepartmentId) === userDeptId);
    return isTargeted || needsFinal || isVetting || isPartialBalance;
  });

  const operational = all.filter(isOperationalRequisition);
  const memos = all.filter(isMemoRecord);
  const approved = operational.filter(r => r.status === 'approved' || r.finalApprovalStatus === 'treated').length;
  const rejected = operational.filter(r => r.status === 'rejected').length;
  const memoPending = memos.filter(r => r.status === 'pending' && r.finalApprovalStatus !== 'published').length;
  const memoPublished = memos.filter(r => r.finalApprovalStatus === 'published').length;

  // Account totalSpent = actual disbursed amounts; others = approved/treated amounts
  const totalSpent = isAccountDept && userDeptId
    ? operational
      .filter(r => !!r.amountDisbursed && (
        (r.finalApprovalStatus === 'treated' && Number(r.treatedByDeptId) === userDeptId) ||
        (r.finalApprovalStatus === 'partial' && Number(r.currentVettingDeptId) === userDeptId)
      ))
      .reduce((sum, r) => sum + parseFloat(r.amountDisbursed || 0), 0)
    : operational
      .filter(r => (r.status === 'approved' || r.finalApprovalStatus === 'treated') && r.amount)
      .reduce((sum, r) => sum + r.amount, 0);

  // How many requests has this dept treated (fully paid/issued)
  const treated = userDeptId
    ? operational.filter(r =>
        r.finalApprovalStatus === 'treated' && Number(r.treatedByDeptId) === userDeptId
      ).length
    : 0;

  // How many requests has this dept given final approval on
  const approvedByMe = userDeptId
    ? operational.filter(r => Number(r.finalApprovedByDeptId) === userDeptId).length
    : 0;

  return {
    pending: pendingActions.length,
    approved,
    rejected,
    totalSpent,
    memos: memos.length,
    memoPending,
    memoPublished,
    treated,
    approvedByMe,
  };
}

// ── Activity Log ──
export async function logActivity(action, detail) {
  await ensureInitialized();
  const log = (await activityStore.getItem('log')) || [];
  log.unshift({ id: Date.now(), action, detail, timestamp: new Date().toISOString() });
  // Keep last 100 entries
  if (log.length > 100) log.length = 100;
  await activityStore.setItem('log', log);
}

export async function getActivityLog() {
  await ensureInitialized();
  try {
    const remote = await auditAPI.getAuditLogs();
    // Handle both paginated { data, total } and legacy plain-array responses
    const rawList = Array.isArray(remote) ? remote : (Array.isArray(remote?.data) ? remote.data : []);
    const normalized = rawList.map(a => ({
      ...a,
      detail: a.detail || a.details
    }));
    await activityStore.setItem('log', normalized);
    return normalized;
  } catch (err) {
    console.warn("Offline: Fetching cached activity log", err);
    const local = await activityStore.getItem('log');
    return Array.isArray(local) ? local : [];
  }
}

// My Activity — returns only the current user's own logs
export async function getMyActivityLog() {
  await ensureInitialized();
  try {
    const remote = await auditAPI.getMyActivity();
    const rawList = Array.isArray(remote) ? remote : (Array.isArray(remote?.data) ? remote.data : []);
    return rawList.map(a => ({ ...a, detail: a.detail || a.details }));
  } catch (err) {
    console.warn("Offline: Fetching cached activity log", err);
    const local = await activityStore.getItem('log');
    return Array.isArray(local) ? local : [];
  }
}

import { workflowAPI, typeAPI, notificationAPI } from './api';

// ── Requisition Types ──
export async function getRequisitionTypes() {
  await ensureInitialized();
  try {
    return await typeAPI.getTypes();
  } catch (err) {
    console.warn("Offline: Using fallback types");
    return [
      { id: 1, name: 'Cash Requisition' },
      { id: 2, name: 'Material Request' },
      { id: 3, name: 'Memorandum' }
    ];
  }
}

export async function addRequisitionType(data) {
  try {
    const result = await typeAPI.addType(data);
    toast.success(`Type "${data.name}" added`);
    return result;
  } catch (err) {
    toast.error("Failed to add type");
  }
}

export async function deleteRequisitionType(id) {
  try {
    await typeAPI.deleteType(id);
    toast.error("Type removed");
  } catch (err) {
    toast.error("Failed to remove type");
  }
}

export async function getNotifications() {
  await ensureInitialized();
  try {
    const remote = await notificationAPI.getNotifications();
    const data = Array.isArray(remote) ? remote : [];
    const mapped = data.map(n => ({ ...n, message: n.message || n.content }));
    await notificationStore.setItem('all', mapped);
    return mapped;
  } catch (err) {
    console.warn("Offline: Could not fetch notifications", err);
    return (await notificationStore.getItem('all')) || [];
  }
}

export async function markNotificationRead(id) {
  try {
    return await notificationAPI.markRead(id);
  } catch (err) {
    console.warn("Could not mark notification read:", err);
  }
}

export async function markAllNotificationsRead() {
  try {
    return await notificationAPI.markAllRead();
  } catch (err) {
    console.warn("Could not mark all notifications read:", err);
  }
}

export async function clearNotifications() {
  try {
    const res = await notificationAPI.clearAll();
    toast.success('Cleared all read notifications');
    return res;
  } catch (err) {
    console.warn("Could not clear notifications:", err);
    toast.error('Failed to clear notifications');
  }
}

export async function getRequisitionDetail(id) {
  try {
    const data = await reqAPI.getRequisition(id);
    // Cache the full detail so it's readable offline later
    await reqDetailStore.setItem(String(id), data);
    return data;
  } catch (err) {
    // Network failure — serve from cache if available
    const cached = await reqDetailStore.getItem(String(id));
    if (cached) {
      console.warn(`Offline: Serving cached detail for requisition #${id}`);
      return cached;
    }
    console.warn("Could not fetch requisition detail and no cache exists:", err);
    return null;
  }
}

// Invalidate a single cached detail (call this after any mutation on that req)
export async function invalidateRequisitionDetail(id) {
  await reqDetailStore.removeItem(String(id));
}

// ── Workflow CRUD ──
export async function getWorkflows() {
  await ensureInitialized();
  try {
    const remote = await workflowAPI.getStages();
    await workflowStore.setItem('all', remote);
    return remote;
  } catch (err) {
    console.warn("Offline: Fetching cached workflows", err);
    return (await workflowStore.getItem('all')) || [];
  }
}

export async function updateWorkflows(stages) {
  await ensureInitialized();
  try {
    await workflowAPI.updateStages(stages);
    await workflowStore.setItem('all', stages);
    await logActivity('Workflow Updated', `Cloud-sync: Reconfigured chain with ${stages.length} stages`);
  } catch (err) {
    console.error("Offline: Workflow update failed", err);
    throw err;
  }
}

// ── Department Logic ──
export async function getDepartments() {
  await ensureInitialized();
  try {
    const remote = await deptAPI.getDepartments();
    await departmentStore.setItem('all', remote);
    return remote;
  } catch (err) {
    console.warn("Offline: Fetching cached departments", err);
    return (await departmentStore.getItem('all')) || [];
  }
}

export async function getDepartmentById(id) {
  await ensureInitialized();
  try {
    return await deptAPI.getDepartment(id);
  } catch (err) {
    const all = await getDepartments();
    return all.find(d => d.id === id) || null;
  }
}

export async function addDepartment(dept) {
  await ensureInitialized();
  try {
    const result = await deptAPI.addDepartment(dept);
    toast.success(`${dept.name} added to cloud`);
    return result;
  } catch (err) {
    // Only fall back to offline-local-save for a genuine connectivity failure
    // (no response at all). A real server error (e.g. 409 name clash, 400 validation)
    // must propagate to the caller — silently "succeeding" locally would hide it.
    if (err?.response) throw err;
    console.warn("Offline: Department saved locally ONLY", err);
    const all = await getDepartments();
    const newDept = { id: Date.now(), ...dept };
    all.push(newDept);
    await departmentStore.setItem('all', all);
    return newDept;
  }
}

export async function deleteDepartment(id) {
  await ensureInitialized();
  try {
    await deptAPI.deleteDepartment(id);
    toast.success("Department removed from cloud");
  } catch (err) {
    console.warn("Offline: Department removed locally ONLY", err);
    const all = await getDepartments();
    const filtered = all.filter(d => d.id !== id);
    await departmentStore.setItem('all', filtered);
  }
}

export async function validateDepartmentLogin(deptName, code) {
  await ensureInitialized();
  const all = await getDepartments();
  const dept = all.find(d => d.name === deptName && d.accessCode === code);
  return dept || null;
}

export async function updateDepartmentHead(deptId, payload) {
  try {
    const result = await deptAPI.updateHead(deptId, payload);
    const all = await getDepartments();
    const idx = all.findIndex(d => d.id === deptId);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...result };
      await departmentStore.setItem('all', all);
    }
    toast.success("Department head updated");
    return result;
  } catch (err) {
    toast.error("Failed to update department head");
    throw err;
  }
}

export async function uploadDepartmentStamp(deptId, file) {
  try {
    const result = await deptAPI.uploadStamp(deptId, file);
    toast.success("Department stamp updated");
    return result;
  } catch (err) {
    toast.error("Failed to upload stamp");
    throw err;
  }
}

export async function uploadUserSignature(userId, file) {
  try {
    const result = await userAPI.uploadSignature(userId, file);
    toast.success("Signature updated");
    return result;
  } catch (err) {
    toast.error("Failed to upload signature");
    throw err;
  }
}

// ── Offline-safe write helpers ────────────────────────────────────────────────
// Returns true when the error is a network failure (not a 4xx validation error).
const isNetworkError = (err) => {
  const status = err?.response?.status;
  if (status && status >= 400) return false;
  return true;
};

async function queueOfflineAction(type, reqId, payload) {
  const queue = (await syncQueueStore.getItem('pending')) || [];
  queue.push({ type, reqId, payload, clientId: generateClientId(), retryCount: 0, nextAttemptAt: Date.now(), lastError: null });
  await syncQueueStore.setItem('pending', queue);
  toast('Offline: Action queued — will sync when reconnected.');
}

export async function forwardRequisition(reqId, { targetDepartmentId, note, returnToSender }) {
  try {
    return await forwardAPI.forward(reqId, { targetDepartmentId, note, returnToSender });
  } catch (err) {
    if (isNetworkError(err)) {
      await queueOfflineAction('forward', reqId, { targetDepartmentId, note, returnToSender });
      return null;
    }
    throw err;
  }
}

export async function finalApproveRequisition(reqId, note = '') {
  try {
    return await vettingAPI.finalApprove(reqId, note);
  } catch (err) {
    if (isNetworkError(err)) {
      await queueOfflineAction('finalApprove', reqId, { note });
      return null;
    }
    throw err;
  }
}

export async function reapproveRequisition(reqId, note = '') {
  return vettingAPI.reapprove(reqId, note);
}

export async function forwardForReapproval(reqId) {
  return vettingAPI.forwardForReapproval(reqId);
}

export async function sendToVettingRequisition(reqId, vettingDeptId) {
  try {
    return await vettingAPI.sendToVetting(reqId, vettingDeptId);
  } catch (err) {
    if (isNetworkError(err)) {
      await queueOfflineAction('sendToVetting', reqId, { vettingDeptId });
      return null;
    }
    throw err;
  }
}

export async function vettingActionRequisition(reqId, { action, comment, nextDeptId, file, vetted, amountDisbursed, treatmentType, treatmentReason } = {}) {
  try {
    return await vettingAPI.vettingAction(reqId, { action, comment, nextDeptId, file, vetted, amountDisbursed, treatmentType, treatmentReason });
  } catch (err) {
    if (!isNetworkError(err)) throw err;

    if (file) {
      if (file.size > OFFLINE_FILE_SIZE_LIMIT) {
        toast.error('File too large to queue offline (max 50 MB)');
        throw new Error('Offline — file exceeds 50 MB limit');
      }
      const fileKey = await storeFileBlob(file);
      const queue = (await syncQueueStore.getItem('pending')) || [];
      queue.push({
        type: 'vettingActionWithFile',
        clientId: generateClientId(),
        reqId,
        fileKey,
        payload: { action, comment, nextDeptId, amountDisbursed, treatmentType, treatmentReason },
        retryCount: 0,
        nextAttemptAt: Date.now(),
        lastError: null
      });
      await syncQueueStore.setItem('pending', queue);
      toast('Offline: Vetting action with file queued — will sync when reconnected.');
      return null;
    }

    await queueOfflineAction('vettingAction', reqId, { action, comment, nextDeptId, amountDisbursed, treatmentType, treatmentReason });
    return null;
  }
}

export const convertRequisitionToCash = (reqId, { amount, comment }) =>
  vettingAPI.convertToCash(reqId, { amount, comment });

export const kivRequisition = (id, note) => kivAPI.kiv(id, note);
export const unKivRequisition = (id) => kivAPI.unKiv(id);

export const saveAuditOverride  = (reqId, payload) => auditAPI.saveOverride(reqId, payload);
export const clearAuditOverride = (reqId)          => auditAPI.clearOverride(reqId);

export const iccComment  = (reqId, comment) => iccAPI.comment(reqId, comment);
export const iccFreeze   = (reqId, note)    => iccAPI.freeze(reqId, note);
export const iccUnfreeze = (reqId)          => iccAPI.unfreeze(reqId);

export const iccVetForward = (reqId, comment) => iccAPI.vetForward(reqId, comment);
export const iccVetReturn  = (reqId, payload) => iccAPI.vetReturn(reqId, payload);

// ── HR offline-safe read functions ────────────────────────────────────────────
// Each follows NetworkFirst: try the server, fall back to the local cache.
// Write operations (create/update/delete) still go through hrAPI directly
// since they require a live server — they are not queued offline.

export async function getHRStats() {
  try {
    const data = await hrAPI.getHRStats();
    await hrStatsStore.setItem('latest', data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR stats', err);
    return (await hrStatsStore.getItem('latest')) || { employees: 0, pendingLeaves: 0, attendanceRate: 0, openPositions: 0 };
  }
}

export async function getHREmployees() {
  try {
    const remote = await hrAPI.getEmployees();
    const data = Array.isArray(remote) ? remote : (remote?.results || []);
    await hrEmployeeStore.setItem('all', data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR employees', err);
    return (await hrEmployeeStore.getItem('all')) || [];
  }
}

export async function getHRLeaves(params = {}) {
  const cacheKey = Object.keys(params).length ? JSON.stringify(params) : 'all';
  try {
    const remote = await hrAPI.getLeaves(params);
    const data = Array.isArray(remote) ? remote : (remote?.results || []);
    await hrLeaveStore.setItem(cacheKey, data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR leaves', err);
    return (await hrLeaveStore.getItem(cacheKey)) || (await hrLeaveStore.getItem('all')) || [];
  }
}

export async function getHRAttendance(params = {}) {
  const cacheKey = `${params.year ?? 'cur'}-${params.month ?? 'cur'}`;
  try {
    const remote = await hrAPI.getAttendance(params);
    const data = Array.isArray(remote) ? remote : (remote?.results || []);
    await hrAttendanceStore.setItem(cacheKey, data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR attendance', err);
    return (await hrAttendanceStore.getItem(cacheKey)) || [];
  }
}

export async function getHRPayroll(params = {}) {
  const cacheKey = `${params.year ?? 'cur'}-${params.month ?? 'cur'}`;
  try {
    const remote = await hrAPI.getPayroll(params);
    const data = Array.isArray(remote) ? remote : (remote?.results || []);
    await hrPayrollStore.setItem(cacheKey, data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR payroll', err);
    return (await hrPayrollStore.getItem(cacheKey)) || [];
  }
}

export async function getHRJobs() {
  try {
    const remote = await hrAPI.getJobs();
    const data = Array.isArray(remote) ? remote : (remote?.results || []);
    await hrJobStore.setItem('jobs', data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR jobs', err);
    return (await hrJobStore.getItem('jobs')) || [];
  }
}

export async function getHRApplicants(jobId) {
  const cacheKey = `applicants-${jobId}`;
  try {
    const remote = await hrAPI.getApplicants(jobId);
    const data = Array.isArray(remote) ? remote : (remote?.results || []);
    await hrJobStore.setItem(cacheKey, data);
    return data;
  } catch (err) {
    console.warn('Offline: Using cached HR applicants for job', jobId, err);
    return (await hrJobStore.getItem(cacheKey)) || [];
  }
}
