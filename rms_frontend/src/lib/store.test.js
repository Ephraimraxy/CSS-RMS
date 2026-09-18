import { describe, it, expect } from 'vitest';
import { isMemoRecord, isOperationalRequisition, computeDashboardStats } from './store.jsx';

describe('isMemoRecord', () => {
  it('matches memo/memorandum type strings, case-insensitively', () => {
    expect(isMemoRecord('Memo')).toBe(true);
    expect(isMemoRecord('memorandum')).toBe(true);
    expect(isMemoRecord({ type: 'MEMO' })).toBe(true);
  });

  it('does not match cash/material types', () => {
    expect(isMemoRecord('Cash')).toBe(false);
    expect(isMemoRecord('Material Request')).toBe(false);
    expect(isMemoRecord(undefined)).toBe(false);
  });
});

describe('isOperationalRequisition', () => {
  it('matches cash and material type strings', () => {
    expect(isOperationalRequisition('Cash')).toBe(true);
    expect(isOperationalRequisition('cash requisition')).toBe(true);
    expect(isOperationalRequisition('Material')).toBe(true);
    expect(isOperationalRequisition('material request')).toBe(true);
  });

  it('does not match memo types', () => {
    expect(isOperationalRequisition('Memo')).toBe(false);
    expect(isOperationalRequisition(undefined)).toBe(false);
  });
});

describe('computeDashboardStats', () => {
  it('returns zeroed stats when there is no logged-in user', () => {
    expect(computeDashboardStats([], null).pending).toBe(0);
  });

  it("counts a Global Admin's pending actions across every department, not just their own deptId", () => {
    // This is the exact historical bug: Super Admin's login is backed by a real Department
    // row, so userDeptId is never null/falsy for admin — gating "is this admin" on
    // `!userDeptId` silently fell through to the narrow per-department filter and made
    // every admin dashboard stat read zero, even with real pending requisitions in the system.
    const adminUser = { role: 'global_admin', deptId: 99, departmentName: 'Super Admin' };
    const all = [
      { type: 'Cash', status: 'pending', finalApprovalStatus: 'none', targetDepartmentId: 5 },
      { type: 'Material', status: 'pending', finalApprovalStatus: 'vetting', targetDepartmentId: 7, currentVettingDeptId: 7 },
      { type: 'Cash', status: 'approved', finalApprovalStatus: 'treated', amount: 50000 },
    ];
    const stats = computeDashboardStats(all, adminUser);
    expect(stats.pending).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.totalSpent).toBe(50000);
  });

  it('a regular department user only sees pending items actually targeted at their own department', () => {
    const deptUser = { role: 'department', deptId: 5, departmentName: 'ICT' };
    const all = [
      { type: 'Cash', status: 'pending', finalApprovalStatus: 'none', targetDepartmentId: 5 },
      { type: 'Cash', status: 'pending', finalApprovalStatus: 'none', targetDepartmentId: 7 }, // someone else's desk
    ];
    const stats = computeDashboardStats(all, deptUser);
    expect(stats.pending).toBe(1);
  });

  it('a department user with no deptId and no admin role gets zeroed stats, not a crash', () => {
    const stats = computeDashboardStats([{ type: 'Cash', status: 'pending' }], { role: 'department' });
    expect(stats).toEqual({ pending: 0, approved: 0, rejected: 0, totalSpent: 0, memos: 0, memoPending: 0, memoPublished: 0, approvedByMe: 0, treated: 0 });
  });

  it('separates memo counts from operational (cash/material) counts', () => {
    const adminUser = { role: 'global_admin', deptId: 1 };
    const all = [
      { type: 'Memo', status: 'pending', finalApprovalStatus: 'none' },
      { type: 'Memo', status: 'pending', finalApprovalStatus: 'published' },
      { type: 'Cash', status: 'rejected' },
    ];
    const stats = computeDashboardStats(all, adminUser);
    expect(stats.memos).toBe(2);
    expect(stats.memoPublished).toBe(1);
    expect(stats.rejected).toBe(1);
  });
});
