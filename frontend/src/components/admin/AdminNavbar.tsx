'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/useAdminAuth';
import { cn } from '@/lib/utils';

// ============================================
// NAVIGATION STRUCTURE
// ============================================
type NavItem = {
  label: string;
  href: string;
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    items: [{ label: 'Dashboard', href: '/admin/dashboard' }],
  },
  {
    id: 'recruitment',
    label: 'Recruitment',
    icon: '📋',
    items: [
      { label: 'รอบรับสมัคร', href: '/admin/rounds' },
      { label: 'ใบสมัคร', href: '/admin/applications' },
      
    ],
  },
  {
    id: 'form-builder',
    label: 'Form Builder',
    icon: '🧩',
    items: [
      { label: 'Templates', href: '/admin/templates' },
      { label: 'Field Library', href: '/admin/fields' },
    ],
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: '🏢',
    items: [
      { label: 'หน่วยงาน', href: '/admin/organizations' },
      { label: 'Job Family', href: '/admin/job-families' },
      { label: 'Position Level', href: '/admin/position-levels' },
      { label: 'Positions', href: '/admin/positions' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: '⚙️',
    items: [
      { label: 'จัดการผู้ใช้งาน', href: '/admin/users' },
      { label: 'Audit Logs', href: '/admin/audit-logs' },
    ],
  },




];

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

  // Find active sub-item
  const activeItem = group.items.find(item => pathname === item.href || pathname.startsWith(item.href + '/'));

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
// MOBILE DRAWER
// ============================================
function MobileDrawer({ 
  isOpen, 
  onClose, 
  pathname 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  pathname: string;
}) {
  const router = useRouter();
  const { logout } = useAdminAuth();

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
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
        
        <nav className="p-3 space-y-1">
          {NAV_GROUPS.map((group) => {
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

        <div className="p-3 border-t border-slate-700 mt-4">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium"
          >
            ออกจากระบบ
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
  const { logout } = useAdminAuth();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Close drawer on route change
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
  };

  return (
    <>
      <nav className="bg-slate-800 text-white shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Mobile menu button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-md text-slate-300 hover:bg-slate-700 hover:text-white md:hidden"
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
              {NAV_GROUPS.map((group) => {
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

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="hidden md:block px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </nav>

      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} pathname={pathname} />
    </>
  );
}
