import type { CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { navItems, navBtnStyle } from './navItems';

interface BottomNavProps {
  // fixed: 主应用底部固定；static: 全屏预览内联
  position?: 'fixed' | 'static';
  // 强制激活的路径（用于 Preview 全屏场景下高亮 /preview）
  activePath?: string;
}

export function BottomNav({ position = 'fixed', activePath }: BottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const current = activePath ?? location.pathname;

  const wrapperStyle: CSSProperties = position === 'fixed'
    ? {
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#c0c0c0',
        borderTop: '2px solid #808080',
        zIndex: 200,
      }
    : {
        background: '#c0c0c0',
        borderTop: '2px solid #808080',
        zIndex: 200,
      };

  return (
    <nav style={wrapperStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        {navItems.map((item, index) => {
          const isActive = current === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                ...navBtnStyle(isActive),
                borderRight: index < navItems.length - 1 ? '1px solid #808080' : 'none',
              }}
            >
              <span style={{ fontSize: '18px', display: 'block' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          style={navBtnStyle(false, true)}
          onClick={() => {
            useAuthStore.getState().logout();
            navigate('/login');
          }}
        >
          <span style={{ fontSize: '18px', display: 'block' }}>🚪</span>
          <span>退出</span>
        </button>
      </div>
    </nav>
  );
}
