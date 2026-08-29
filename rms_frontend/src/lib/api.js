import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // send HttpOnly auth cookie on every request
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    // 422 from AI refine is an expected "blocked" response — don't log as error
    if (error.response?.status !== 422) {
      console.error("API Error Response:", error);
    }
    const originalRequest = error.config || {};
    const status = error.response?.status;
    const errorMessage = String(error.response?.data?.error || error.response?.data?.message || '');
    
    // Prevent infinite loops on authenticating/refresh requests
    if (originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/dept-login') || originalRequest.url?.includes('/auth/refresh')) {
      return Promise.reject(error);
    }

    if (status === 403 && /session is invalid|session.*expired/i.test(errorMessage)) {
      localStorage.removeItem('rms_user');
      window.location.reload();
      return Promise.reject(error);
    }

    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        // Server rotates the HttpOnly cookie and returns updated user data
        const refreshResponse = await api.post('/auth/refresh');
        if (refreshResponse?.user) {
          localStorage.setItem('rms_user', JSON.stringify(refreshResponse.user));
        }
        // Re-fire original request — new cookie is sent automatically
        return await api(originalRequest);
      } catch (refreshErr) {
        console.warn('Silent refresh failed, terminating session.', refreshErr);
        localStorage.removeItem('rms_user');
        window.location.reload();
      }
    } else if (status === 401) {
      localStorage.removeItem('rms_user');
      window.location.reload();
    }
    
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: async (email, password) => {
    return api.post('/auth/login', { email, password });
  },
  deptLogin: async (departmentName, accessCode, mfaCode, turnstileToken) => {
    const data = await api.post('/auth/dept-login', { departmentName, accessCode, mfaCode, turnstileToken });
    if (data?.requiresActivation) {
      const err = new Error('REQUIRES_ACTIVATION');
      err.activationToken = data.activationToken;
      err.activationDeptName = data.deptName;
      err.isSubAccount = !!data.isSubAccount;
      err.headName  = data.headName  || '';
      err.headTitle = data.headTitle || '';
      err.headEmail = data.headEmail || '';
      err.response = { status: 200 }; // prevent AuthContext offline handler from catching this
      throw err;
    }
    return data;
  },
  async checkSession() {
    return api.get('/auth/me');
  },
  
  async logout() {
    try {
      await api.post('/auth/logout'); // server clears the HttpOnly cookie
    } catch {
      // Server unreachable — still clear local session
    }
    localStorage.removeItem('rms_user');
  },
  async getFullProfile() {
    return api.get('/auth/me/full');
  },
  async updateProfile(data) {
    return api.put('/auth/me', data);
  },
  async changePassword(data) {
    return api.put('/auth/me/password', data);
  },
  async getSseTicket() {
    return api.post('/events/ticket');
  }
};

export const workflowAPI = {
  async getStages() {
    return api.get('/workflow-stages');
  },
  async updateStages(stages) {
    return api.post('/workflow-stages', stages);
  }
};

export const typeAPI = {
  getTypes: async () => {
    return api.get('/requisition-types');
  },
  addType: async (data) => {
    return api.post('/requisition-types', data);
  },
  deleteType: async (id) => {
    return api.delete(`/requisition-types/${id}`);
  }
};

export const notificationAPI = {
  async getNotifications() {
    return api.get('/notifications');
  },
  async markRead(id) {
    return api.put(`/notifications/${id}/read`);
  },
  async markAllRead() {
    return api.put('/notifications/read-all');
  },
  async clearAll() {
    return api.delete('/notifications/clear-all');
  }
};

export const deptAPI = {
  async getDepartments() {
    return api.get('/departments');
  },
  async getDepartment(id) {
    return api.get(`/departments/${id}`);
  },
  async checkActivation(id) {
    return api.get(`/departments/${id}/activation`);
  },
  async addDepartment(dept) {
    return api.post('/departments', dept);
  },
  async deleteDepartment(id) {
    return api.delete(`/departments/${id}`);
  },
  async uploadStamp(deptId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/departments/${deptId}/stamp`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  async updateHead(deptId, payload) {
    return api.put(`/departments/${deptId}/head`, payload);
  },
  async updateDepartment(deptId, payload) {
    return api.put(`/departments/${deptId}`, payload);
  },
  async resetAccessCode(deptId, accessCode) {
    return api.put(`/departments/${deptId}/access-code`, { accessCode });
  },
  // One-click security reset: regenerates the access code, force-logs-out every active
  // session on every device, and notifies the department by SMS + email — distinct from
  // resetAccessCode above, which requires typing a code and does none of that.
  async securityReset(deptId) {
    return api.post(`/departments/${deptId}/security-reset`);
  },
  async changeDeptAccessCode(currentCode, newCode, confirmCode) {
    return api.put('/department/access-code', { currentCode, newCode, confirmCode });
  },
  async toggleDisable(deptId) {
    return api.patch(`/departments/${deptId}/toggle-disable`);
  }
};

export const forwardAPI = {
  async forward(requisitionId, { targetDepartmentId, note, returnToSender }) {
    return api.post(`/requisitions/${requisitionId}/forward`, {
      targetDepartmentId: targetDepartmentId || null,
      note: note || '',
      returnToSender: !!returnToSender
    });
  },
  async creatorComment(requisitionId, comment) {
    return api.post(`/requisitions/${requisitionId}/creator-comment`, { comment });
  }
};

export const auditAPI = {
  async getAuditLogs() {
    return api.get('/audit-logs');
  },
  async getMyActivity() {
    return api.get('/audit-logs?mine=true');
  },
  async saveOverride(reqId, payload) {
    return api.post(`/requisitions/${reqId}/audit-override`, payload);
  },
  async clearOverride(reqId) {
    return api.delete(`/requisitions/${reqId}/audit-override`);
  }
};

export const iccAPI = {
  comment:  (reqId, comment)  => api.post(`/requisitions/${reqId}/icc-comment`,  { comment }),
  freeze:   (reqId, note)     => api.post(`/requisitions/${reqId}/icc-freeze`,   { note }),
  unfreeze: (reqId)           => api.post(`/requisitions/${reqId}/icc-unfreeze`),
  // ICC Vets Protocol — Account forwards Cash/Material requests to ICC before treating
  vetForward: (reqId, comment)              => api.post(`/requisitions/${reqId}/icc-vet-forward`, { comment }),
  vetReturn:  (reqId, { comment, overrideItems, overrideComment } = {}) =>
    api.post(`/requisitions/${reqId}/icc-vet-return`, { comment, overrideItems, overrideComment }),
};

export const settingsAPI = {
  async get(key) {
    return api.get(`/system-settings/${key}`);
  },
  async set(key, value) {
    return api.put(`/system-settings/${key}`, { value });
  },
  async getRefPattern() {
    return api.get('/settings/ref-pattern');
  },
  async setRefPattern(data) {
    return api.patch('/settings/ref-pattern', data);
  },
};

// Manual attendance corrections for the desktop client — see
// GET/POST /api/attendance-corrections in serve.js.
export const attendanceCorrectionsAPI = {
  async list() {
    return api.get('/attendance-corrections');
  },
  async add(staffId, date, times) {
    return api.post('/attendance-corrections', { staffId, date, times });
  },
};

// Staff -> Department correlation for the desktop client — the ZKTeco
// device itself never stores Department, only ID + Role, so this mapping
// (typed in one at a time or bulk-imported) is the only source Department
// ever comes from on the desktop side. See GET/PATCH/DELETE/import
// /api/staff-departments in serve.js.
export const staffDepartmentsAPI = {
  async list() {
    return api.get('/staff-departments');
  },
  async update(staffId, department) {
    return api.patch(`/staff-departments/${encodeURIComponent(staffId)}`, { department });
  },
  async remove(staffId) {
    return api.delete(`/staff-departments/${encodeURIComponent(staffId)}`);
  },
  async importFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/staff-departments/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const reqAPI = {
  async getSseTicket() {
    return api.post('/events/ticket');
  },
  async getRequisitions(params = {}) {
    return api.get('/requisitions', { params });
  },
  async getRequisition(id) {
    return api.get(`/requisitions/${id}`);
  },
  async addRequisition(data) {
    return api.post('/requisitions', data);
  },
  async updateRequisition(id, data) {
    return api.put(`/requisitions/${id}`, data);
  },
  async deleteRequisition(id) {
    return api.delete(`/requisitions/${id}`);
  },
  async deleteMultipleRequisitions(ids) {
    return api.post('/requisitions/bulk-delete', { ids });
  },
  async approveRequisition(id, remarks) {
    return api.post(`/requisitions/${id}/approve`, { remarks });
  },
  async rejectRequisition(id, remarks) {
    return api.post(`/requisitions/${id}/reject`, { remarks });
  },
  async getSignedPdf(id) {
    return api.get(`/requisitions/${id}/signed-pdf`, { responseType: 'blob' });
  },
  async getDynamicPdf(id, upToEventId = null) {
    const params = upToEventId ? `?upToEventId=${encodeURIComponent(upToEventId)}` : '';
    return api.get(`/requisitions/${id}/dynamic-pdf${params}`, { responseType: 'blob' });
  },
  async getDeptProfile() {
    return api.get('/department/profile');
  },
  async updateDeptProfile(data) {
    return api.put('/department/profile', data);
  },
  async uploadDeptSignature(file) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/department/signature', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  async adminUploadDeptSignature(deptId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/departments/${deptId}/signature`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  async deleteAttachment(attachmentId) {
    return api.delete(`/attachments/${attachmentId}`);
  },
  async uploadAttachments(reqId, files) {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    return api.post(`/requisitions/${reqId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  async getRequisitionTags(id) {
    return api.get(`/requisitions/${id}/tags`);
  },
  async tagRequisitionDepts(id, deptIds) {
    return api.post(`/requisitions/${id}/tag`, { deptIds });
  },
  async setSubAccountVisibility(id, payload) {
    return api.patch(`/requisitions/${id}/sub-account-visibility`, payload);
  },
  async getSubVisibility(id) {
    return api.get(`/requisitions/${id}/sub-visibility`);
  }
};

export const storeAPI = {
  async list(params = {})          { return api.get('/store-records', { params }); },
  async carriedForward(deptId)     { return api.get('/store-records/carried-forward', { params: { deptId } }); },
  async subAccounts(params = {})   { return api.get('/store-records/sub-accounts', { params }); },
  async create(data)               { return api.post('/store-records', data); },
  async get(id)                    { return api.get(`/store-records/${id}`); },
  async update(id, data)           { return api.put(`/store-records/${id}`, data); },
  async remove(id)                 { return api.delete(`/store-records/${id}`); },
};

export const userAPI = {
  async uploadSignature(userId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/users/${userId}/signature`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};

export const vettingAPI = {
  async finalApprove(reqId, note = '') {
    return api.post(`/requisitions/${reqId}/final-approve`, { note });
  },
  async sendToVetting(reqId, vettingDeptId) {
    return api.post(`/requisitions/${reqId}/send-to-vetting`, { vettingDeptId });
  },
  async reapprove(reqId, note = '') {
    return api.post(`/requisitions/${reqId}/reapprove`, { note });
  },
  async forwardForReapproval(reqId) {
    return api.post(`/requisitions/${reqId}/forward-for-reapproval`);
  },
  async vettingAction(reqId, { action, comment, nextDeptId, file, vetted, amountDisbursed, treatmentType, treatmentReason }) {
    const formData = new FormData();
    formData.append('action', action);
    if (comment) formData.append('comment', comment);
    if (nextDeptId) formData.append('nextDeptId', String(nextDeptId));
    if (file) formData.append('file', file);
    formData.append('vetted', vetted ? 'true' : 'false');
    if (amountDisbursed != null) formData.append('amountDisbursed', String(amountDisbursed));
    if (treatmentType) formData.append('treatmentType', treatmentType);
    if (treatmentReason) formData.append('treatmentReason', treatmentReason);
    return api.post(`/requisitions/${reqId}/vetting-action`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};

export const adminAPI = {
  getDeletedRecords: () => api.get('/admin/deleted-records'),
  purgeDeletedRecord: (id) => api.delete(`/admin/deleted-records/${id}`),
  getPrintSettings: () => api.get('/admin/print-settings'),
  savePrintSettings: (canPrintIds, showStamp, showSignature, requireGovernance) => api.post('/admin/print-settings', { canPrintIds, showStamp, showSignature, requireGovernance }),
  hardReset: (options) => api.post('/admin/hard-reset', options),
  getSmsBalance: () => api.get('/admin/sms-balance'),
  getArchitectureDoc: () => api.get('/admin/architecture-doc'),
  getVpsGuide: () => api.get('/admin/vps-guide'),
  getDeployHistory: () => api.get('/admin/deploy-history'),
  getPm2Logs: (type = 'out', lines = 150) => api.get(`/admin/pm2-logs?type=${type}&lines=${lines}`),
  getMigrationsLogbook: () => api.get('/admin/migrations'),
  getAiCaps: () => api.get('/admin/ai-caps'),
  saveAiCaps: (caps) => api.post('/admin/ai-caps', caps),
};

export const kivAPI = {
  kiv: (id, note) => api.post(`/requisitions/${id}/kiv`, { note }),
  unKiv: (id) => api.post(`/requisitions/${id}/un-kiv`),
};

export const printSettingsAPI = {
  getAccess: () => api.get('/settings/print-access'),
};

export const memoAPI = {
  publish:   (reqId, { startAt, endAt } = {}) =>
    api.post(`/requisitions/${reqId}/publish-memo`, {
      publishStartAt: startAt || null,
      publishEndAt:   endAt   || null,
    }),
  unpublish: (reqId) => api.post(`/requisitions/${reqId}/unpublish-memo`),
  returnToCreator: (reqId, note = '') =>
    api.post(`/requisitions/${reqId}/forward`, {
      targetDepartmentId: null,
      note,
      returnToSender: true,
    }),
};

export const hrAPI = {
  // Dashboard
  async getHRStats() {
    return api.get('/hr/stats');
  },

  // Employees
  async getEmployees(params = {}) {
    return api.get('/hr/employees', { params });
  },
  async getEmployee(id) {
    return api.get(`/hr/employees/${id}`);
  },
  async createEmployee(data) {
    return api.post('/hr/employees', data);
  },
  async updateEmployee(id, data) {
    return api.put(`/hr/employees/${id}`, data);
  },
  async deleteEmployee(id) {
    return api.delete(`/hr/employees/${id}`);
  },
  async uploadEmployeePhoto(id, file) {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/hr/employees/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },

  // Leave
  async getLeaves(params = {}) {
    return api.get('/hr/leaves', { params });
  },
  async createLeave(data) {
    return api.post('/hr/leaves', data);
  },
  async approveLeave(id, remarks = '') {
    return api.post(`/hr/leaves/${id}/approve`, { remarks });
  },
  async rejectLeave(id, remarks = '') {
    return api.post(`/hr/leaves/${id}/reject`, { remarks });
  },
  async getLeaveBalances(employeeId) {
    return api.get(`/hr/employees/${employeeId}/leave-balances`);
  },

  // Attendance — monthly manual grid
  async getAttendance(params = {}) {
    return api.get('/hr/attendance', { params });
  },
  async markAttendance(data) {
    return api.post('/hr/attendance', data);
  },
  async updateAttendance(id, data) {
    return api.put(`/hr/attendance/${id}`, data);
  },

  // Attendance — biometric daily view
  async getDailyAttendance(params = {}) {
    return api.get('/hr/attendance/daily', { params });
  },

  // ZKTeco status & punch log
  async getZKTecoStatus() {
    return api.get('/hr/zkteco/status');
  },
  async getZKTecoPunches(params = {}) {
    return api.get('/hr/zkteco/punches', { params });
  },

  // Payroll
  async getPayroll(params = {}) {
    return api.get('/hr/payroll', { params });
  },
  async processPayroll(month, year) {
    return api.post('/hr/payroll/process', { month, year });
  },
  async markPayslipPaid(id) {
    return api.put(`/hr/payroll/${id}/mark-paid`);
  },
  async getPayslipData(employeeId, month, year) {
    return api.get(`/hr/payroll/payslip`, { params: { employeeId, month, year } });
  },

  // Recruitment
  async getJobs() {
    return api.get('/hr/jobs');
  },
  async createJob(data) {
    return api.post('/hr/jobs', data);
  },
  async updateJob(id, data) {
    return api.put(`/hr/jobs/${id}`, data);
  },
  async closeJob(id) {
    return api.put(`/hr/jobs/${id}/close`);
  },
  async deleteJob(id) {
    return api.delete(`/hr/jobs/${id}`);
  },
  async getApplicants(jobId) {
    return api.get(`/hr/jobs/${jobId}/applicants`);
  },
  async createApplicant(jobId, data) {
    return api.post(`/hr/jobs/${jobId}/applicants`, data);
  },
  async updateApplicantStage(applicantId, stage) {
    return api.put(`/hr/applicants/${applicantId}/stage`, { stage });
  },
};

export const aiAPI = {
  async refineDraft(rawDescription, mode = 'auto') {
    try {
      return await api.post('/ai/refine-requisition', { rawDescription, mode });
    } catch (err) {
      // 422 = AI blocked the content — return the body as a normal value so callers can read res.blocked
      if (err?.response?.status === 422 && err?.response?.data?.blocked) {
        return err.response.data;
      }
      throw err;
    }
  },
  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    return api.post('/ai/transcribe', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000
    });
  }
};

export const subAccountAPI = {
  list: (parentId) => api.get('/sub-accounts', { params: parentId ? { parentId } : {} }),
  create: (name, parentId, extra = {}) => api.post('/sub-accounts', { name, ...(parentId ? { parentId } : {}), ...extra }),
  update: (id, data) => api.patch(`/sub-accounts/${id}`, data),
  toggle: (id) => api.patch(`/sub-accounts/${id}/toggle`),
  move: (id, direction, parentId) => api.patch(`/sub-accounts/${id}/move`, { direction, ...(parentId ? { parentId } : {}) }),
  resetCode: (id) => api.post(`/sub-accounts/${id}/reset-code`),
  listUsers: (id) => api.get(`/sub-accounts/${id}/users`),
  assignUser: (id, userId) => api.post(`/sub-accounts/${id}/users`, { userId }),
  removeUser: (id, userId) => api.delete(`/sub-accounts/${id}/users/${userId}`),
  availableUsers: (parentId) => api.get('/sub-accounts/available-users', { params: parentId ? { parentId } : {} }),
  setPrivilege: (id, payload) => api.put(`/sub-accounts/${id}/privilege`, payload),
  delete: (id) => api.delete(`/sub-accounts/${id}`),
  reactivate: (id) => api.post(`/sub-accounts/${id}/reactivate`),
  getRequisitions: (id) => api.get(`/sub-accounts/${id}/requisitions`),
  batchUpload: (file, parentId) => {
    const formData = new FormData();
    formData.append('file', file);
    if (parentId) formData.append('parentId', parentId);
    return api.post('/sub-accounts/batch-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000
    });
  },
};

export default api;
