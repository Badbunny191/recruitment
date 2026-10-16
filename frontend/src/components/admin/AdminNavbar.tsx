'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/useAdminAuth';
import { useRole } from '@/lib/useRole';
import { ROLE_BADGE } from '@/types/user';
import { cn } from '@/lib/utils';

// ============================================
// NAVIGATION STRUCTURE (RBAC v1)
// ============================================
// Final role model: SUPER_ADMIN, ADMIN, VIEWER.
// - SUPER_ADMIN: เห็นทุกเมนู
// - ADMIN: เห็น Dashboard, Recruitment, Applications, Form Builder,
//          Organizations, Positions, Reports (ไม่เห็น System)
// - VIEWER (read-only): เห็น Dashboard, Recruitment Rounds, Applications,
//                       Reports (ไม่เห็น Form Builder / Organizations / Positions / System)
type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

type NavItem = {
  label: string;
  href: string;
  /** Roles ที่สามารถเห็นเมนูนี้ได้ (allow-list). ถ้าว่าง = ทุก role ที่ผ่าน minRole ของ group เห็น */
  minRole: AdminRole;
  /** Roles ที่ห้ามเข้าถึง (deny-list). มีลำดับสูงกว่า minRole */
  excludeRoles?: AdminRole[];
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  /** Min role required to see this group (ตัวกรองหลัก). */
  minRole: AdminRole;
  items: NavItem[];
};

const ROLE_RANK: Record<AdminRole, number> = {
  VIEWER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

function canSeeNav(
  minRole: AdminRole,
  role: AdminRole | null,
  excludeRoles: AdminRole[] = []
): boolean {
  if (!role) return false;
  if (excludeRoles.includes(role)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    minRole: 'VIEWER',
    items: [{ label: 'Dashboard', href: '/admin/dashboard', minRole: 'VIEWER' }],
  },
  {
    id: 'recruitment',
    label: 'Recruitment',
    icon: '📋',
    minRole: 'VIEWER',
    items: [
      // Applications ทั้ง ADMIN และ VIEWER เห็น
      { label: 'ใบสมัคร', href: '/admin/applications', minRole: 'VIEWER' },
      // รอบรับสมัคร: VIEWER เห็น แต่ VIEWER เป็น read-only อยู่แล้ว
      { label: 'รอบรับสมัคร', href: '/admin/rounds', minRole: 'VIEWER' },
    ],
  },
  {
    id: 'form-builder',
    label: 'Form Builder',
    icon: '🧩',
    minRole: 'ADMIN',
    // ADMIN + SUPER_ADMIN เท่านั้น (VIEWER ห้ามเข้า)
    items: [
      { label: 'Templates', href: '/admin/templates', minRole: 'ADMIN' },
      { label: 'Field Library', href: '/admin/fields', minRole: 'ADMIN' },
    ],
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: '🏢',
    minRole: 'ADMIN',
    // ADMIN + SUPER_ADMIN เท่านั้น (VIEWER ห้ามเข้า)
    items: [
      { label: 'หน่วยงาน', href: '/admin/organizations', minRole: 'ADMIN' },
      { label: 'Job Family', href: '/admin/job-families', minRole: 'ADMIN' },
      { label: 'Position Level', href: '/admin/position-levels', minRole: 'ADMIN' },
      { label: 'Positions', href: '/admin/positions', minRole: 'ADMIN' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: '📈',
    minRole: 'VIEWER',
    // ทั้ง ADMIN และ VIEWER เข้าถึงได้ (VIEWER เป็น read-only)
    items: [
      { label: 'รายงาน', href: '/admin/reports', minRole: 'VIEWER' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: '⚙️',
    minRole: 'SUPER_ADMIN',
    // SUPER_ADMIN เท่านั้น (ADMIN และ VIEWER ห้ามเข้าถึง)
    items: [
      { label: 'จัดการผู้ใช้งาน', href: '/admin/users', minRole: 'SUPER_ADMIN' },
      { label: 'Audit Logs', href: '/admin/audit-logs', minRole: 'SUPER_ADMIN' },
    ],
  },
];

// ============================================
// ROLE BADGE (มุมขวาบน)
// ============================================
function RoleBadge({ role }: { role: AdminRole }) {
  if (role === 'SUPER_ADMIN') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border bg-red-500 text-white border-red-600">
        🛡️ SUPER_ADMIN
      </span>
    );
  }
  if (role === 'ADMIN') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border bg-blue-500 text-white border-blue-600">
        👤 ADMIN
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border bg-slate-500 text-white border-slate-600">
      👁️ VIEWER
    </span>
  );
}

// ============================================
// NAV GROUP DROPDOWN (Desktop)
// ============================================
function NavGroupDropdown({
  group,
  isActive,
  pathname
}: {
  group: NavGroup;
  isActive: boolean;
  pathname: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Single-item group (Dashboard) → direct link
  if (group.items.length === 1) {
    return (
      <a
        href={group.items[0].href}
        className={cn(
          "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
          isActive
            ? "bg-slate-700 text-white"
            : "text-slate-300 hover:bg-slate-700/50 hover:text-white"
        )}
      >
        <span>{group.icon}</span>
        <span>{group.label}</span>
      </a>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
          isActive
            ? "bg-slate-700 text-white"
            : "text-slate-300 hover:bg-slate-700/50 hover:text-white"
        )}
      >
        <span>{group.icon}</span>
        <span>{group.label}</span>
        <svg
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden z-50">
          <div className="py-1">
            {group.items.map((item) => {
              const isItemActive = pathname === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block px-4 py-2 text-sm transition-colors",
                    isItemActive
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {item.label}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// USER MENU (Top-right dropdown)
// ============================================
function UserMenu({
  email,
  role,
  onLogout,
}: {
  email: string;
  role: AdminRole;
  onLogout: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const badge = ROLE_BADGE[role];

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleProfile = () => {
    setOpen(false);
    router.push('/admin/profile');
  };

  const handleChangePassword = () => {
    setOpen(false);
    router.push('/admin/change-password');
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-700/50 transition-colors"
        aria-label="User menu"
      >
        <RoleBadge role={role} />
        <span className="hidden lg:inline text-sm text-slate-200 truncate max-w-[180px]" title={email}>
          {email}
        </span>
        <svg
          className={cn("h-4 w-4 text-slate-300 transition-transform", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden z-50">
          {/* User Identity Header */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{badge.emoji}</span>
              <RoleBadge role={role} />
            </div>
            <p className="text-xs text-slate-700 truncate font-medium" title={email}>
              {email}
            </p>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <button
              type="button"
              onClick={handleProfile}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              โปรไฟล์
            </button>
            <button
              type="button"
              onClick={handleChangePassword}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              เปลี่ยนรหัสผ่าน
            </button>
            <div className="border-t border-slate-100 my-1" />
            <button
              type="button"
              onClick={onLogout}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// MOBILE DRAWER
// ============================================
function MobileDrawer({
  isOpen,
  onClose,
  pathname,
  visibleGroups
}: {
  isOpen: boolean;
  onClose: () => void;
  pathname: string;
  visibleGroups: NavGroup[];
}) {
  const router = useRouter();
  const { user, logout } = useAdminAuth();
  const email = user?.email || '';

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
  };

  const handleProfile = () => {
    onClose();
    router.push('/admin/profile');
  };

  const handleChangePassword = () => {
    onClose();
    router.push('/admin/change-password');
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed top-0 left-0 h-full w-72 bg-slate-800 text-white z-50 transform transition-transform md:hidden overflow-y-auto",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            <h2 className="font-bold">SAO Admin</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* User Identity (mobile) */}
        {user?.role && (
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-900/40">
            <RoleBadge role={user.role} />
            <p className="text-xs text-slate-300 mt-1.5 truncate" title={email}>
              {email}
            </p>
          </div>
        )}

        <nav className="p-3 space-y-1">
          {visibleGroups.map((group) => {
            const isGroupActive = group.items.some(item => pathname === item.href || pathname.startsWith(item.href + '/'));
            return (
              <div key={group.id} className="space-y-0.5">
                <div className={cn(
                  "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5",
                  isGroupActive ? "text-blue-300" : "text-slate-500"
                )}>
                  <span>{group.icon}</span>
                  <span>{group.label}</span>
                </div>
                {group.items.map((item) => {
                  const isItemActive = pathname === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "block pl-8 pr-3 py-2 rounded-md text-sm transition-colors",
                        isItemActive
                          ? "bg-slate-700 text-white font-medium"
                          : "text-slate-300 hover:bg-slate-700/50 hover:text-white"
                      )}
                    >
                      {item.label}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-700 mt-4 space-y-1">
          <button
            onClick={handleProfile}
            className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-700/50"
          >
            👤 โปรไฟล์
          </button>
          <button
            onClick={handleChangePassword}
            className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-700/50"
          >
            🔑 เปลี่ยนรหัสผ่าน
          </button>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium"
          >
            🚪 ออกจากระบบ
          </button>
        </div>
      </div>
    </>
  );
}

// ============================================
// MAIN NAVBAR
// ============================================
export function AdminNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAdminAuth();
  const { role } = useRole();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Close drawer on route change
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
  };

  // Filter groups by role (centralized — no hardcoded duplicates).
  const visibleGroups = React.useMemo(
    () => NAV_GROUPS.filter((g) =>
      canSeeNav(g.minRole, role, /* excludeRoles */ undefined) &&
      // Ensure at least one item in the group is visible for the role
      g.items.some((item) => canSeeNav(item.minRole, role, item.excludeRoles))
    ),
    [role]
  );

  return (
    <>
      <nav className="bg-slate-800 text-white shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Mobile menu button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-md text-slate-300 hover:bg-slate-700 hover:text-white md:hidden"
              aria-label="Open menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Logo */}
            <div className="flex items-center gap-2">
              <span className="text-lg">🏛️</span>
              <h1 className="text-base font-bold hidden sm:block">SAO Recruitment</h1>
            </div>

            {/* Desktop Nav Groups */}
            <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
              {visibleGroups.map((group) => {
                const isGroupActive = group.items.some(item => pathname === item.href || pathname.startsWith(item.href + '/'));
                return (
                  <NavGroupDropdown
                    key={group.id}
                    group={group}
                    isActive={isGroupActive}
                    pathname={pathname}
                  />
                );
              })}
            </div>

            {/* Spacer for mobile */}
            <div className="md:hidden w-9" />

            {/* Right: User Identity (Desktop only) */}
            {role && user?.email ? (
              <div className="hidden md:block">
                <UserMenu
                  email={user.email}
                  role={role}
                  onLogout={handleLogout}
                />
              </div>
            ) : (
              <button
                onClick={handleLogout}
                className="hidden md:block px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium"
              >
                ออกจากระบบ
              </button>
            )}
          </div>
        </div>
      </nav>

      <MobileDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pathname={pathname}
        visibleGroups={visibleGroups}
      />
    </>
  );
}
