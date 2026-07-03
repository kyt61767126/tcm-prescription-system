import type { CSSProperties } from 'react';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
}

// 底部主导航项 - App.tsx 与 Preview.tsx 共享，避免重复定义漂移
export const navItems: NavItem[] = [
  { path: '/', label: '处方', icon: '📝' },
  { path: '/prescriptions', label: '历史', icon: '📋' },
  { path: '/preview', label: '预览', icon: '📄' },
  { path: '/medicines', label: '药品', icon: '💊' },
  { path: '/profile', label: '设置', icon: '⚙️' },
];

// 操作栏按钮统一样式
export const actionBarBtnStyle = (variant: 'grey' | 'green'): CSSProperties => ({
  flex: 1,
  minHeight: '40px',
  fontSize: '13px',
  padding: '6px 4px',
  whiteSpace: 'nowrap',
  background: variant === 'green' ? '#008000' : '#c0c0c0',
  color: variant === 'green' ? 'white' : 'inherit',
  border: variant === 'green' ? '2px solid #006000' : '2px solid #808080',
  cursor: 'pointer',
  fontWeight: 'bold',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
});

// 底部导航项按钮统一样式
export const navBtnStyle = (isActive: boolean, isExit = false): CSSProperties => ({
  flex: 1,
  padding: '8px 2px',
  textAlign: 'center',
  cursor: 'pointer',
  fontSize: '11px',
  minHeight: '50px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
  background: isActive ? '#000080' : 'transparent',
  color: isExit ? '#8b0000' : isActive ? 'white' : 'inherit',
  border: 'none',
});
